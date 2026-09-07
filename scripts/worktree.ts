#!/usr/bin/env bun
/**
 * Worktree manager for parallel work on this app.
 *
 * A fresh `git worktree add` cannot run the app: `.env.local` and `node_modules`
 * are untracked, and a second `next dev` on port 3000 just collides with the
 * first. This script closes those three gaps and records the port it handed out
 * so the next worktree does not reuse it.
 *
 *   bun run wt new <name> [--base main] [--port 3001] [--no-install]
 *   bun run wt list
 *   bun run wt adopt [dir|.] [--name alias] [--port N]
 *   bun run wt dev [name|dir|.]
 *   bun run wt rm <name> [--force] [--delete-branch]
 *
 * `new` places the worktree at `.claude/worktrees/<name>` on branch
 * `worktree-<name>`, the layout that already existed by hand. `.claude/**` is
 * ignored by git, eslint, and tsconfig globs, and `bun test` skips dot
 * directories, so nested checkouts never leak into the main repo's tooling.
 *
 * Every other command works on *any* worktree of this repo, wherever it lives:
 * the `omp` harness creates its own under `~/.omp/wt/<id>` on `wt/<stamp>`, and
 * those need the same port claim, env copy, and install as a hand-made one.
 * They are addressed by directory name, by an alias recorded with `adopt`, by
 * path, or as `.` for the worktree the caller is standing in.
 *
 * Node APIs only, deliberately: the repo has `@types/node` but no `@types/bun`
 * (see `types/bun-test.d.ts`), so `Bun.*` here would fail `bun run typecheck`.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";

const WORKTREE_SUBDIR = ".claude/worktrees";
const BRANCH_PREFIX = "worktree-";
const PORT_MIN = 3001;
const PORT_MAX = 3019;
const META_FILE = ".worktree.json";
const ENV_FILE = ".env.local";
const REDIRECT_URI_VAR = "NEXT_PUBLIC_WORKOS_REDIRECT_URI";
/**
 * WorkOS has `http://localhost:3000/callback` through `:3005/callback`
 * registered, and that list can only be edited in the dashboard (the `workos`
 * CLI's `redirect-uris set` fails with `graphql_error`). A worktree on a
 * registered port therefore signs in on its own; above it, the copied
 * `.env.local` keeps pointing at 3000 and sign-in has to round-trip through the
 * primary checkout.
 */
const REDIRECT_PORT_MAX = 3005;

type Meta = {
  name: string;
  branch: string;
  port: number;
  base: string;
  createdAt: string;
};

type Run = { code: number; stdout: string; stderr: string };

function run(cmd: string[], cwd?: string): Run {
  const [command, ...args] = cmd;
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return {
    code: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim()
  };
}

function fail(message: string): never {
  console.error(`worktree: ${message}`);
  process.exit(1);
}

function git(args: string[], cwd?: string): string {
  const result = run(["git", ...args], cwd);
  if (result.code !== 0) {
    fail(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Always operate from the primary checkout, even when invoked inside a
 * worktree: `--show-toplevel` would answer with the worktree itself and we
 * would nest worktrees inside worktrees.
 */
function mainCheckout(): string {
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return commonDir.replace(/\/\.git\/?$/, "");
}

function assertName(name: string | undefined): string {
  if (!name) fail("a worktree name is required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    fail(`invalid name "${name}": use lowercase letters, digits, and dashes`);
  }
  return name;
}

/** A bind probe, not a connect probe: it also rejects ports held by a listener that never answers. */
function isPortFree(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const server = createServer();
  server.once("error", () => resolve(false));
  server.once("listening", () => server.close(() => resolve(true)));
  server.listen(port, "127.0.0.1");
  return promise;
}

async function readMeta(dir: string): Promise<Meta | null> {
  try {
    return JSON.parse(await readFile(`${dir}/${META_FILE}`, "utf8")) as Meta;
  } catch {
    return null;
  }
}

/**
 * `managed` is a worktree this script created under `.claude/worktrees`;
 * `external` is any other worktree of the repo (the `omp` harness's, or a bare
 * `git worktree add`). The distinction only changes naming and how careful `rm`
 * is — running one is identical work.
 */
type Entry = {
  name: string;
  dir: string;
  branch: string;
  kind: "managed" | "external";
  meta: Meta | null;
};

async function listWorktrees(root: string): Promise<Entry[]> {
  const prefix = `${root}/${WORKTREE_SUBDIR}/`;
  const entries: Entry[] = [];
  let dir = "";
  let branch = "";

  const flush = async () => {
    // Every worktree counts except the primary checkout itself.
    if (dir && dir !== root) {
      const managed = dir.startsWith(prefix);
      const meta = await readMeta(dir);
      entries.push({
        name: managed ? dir.slice(prefix.length) : (meta?.name ?? basename(dir)),
        dir,
        branch,
        kind: managed ? "managed" : "external",
        meta
      });
    }
    dir = "";
    branch = "";
  };

  for (const line of git(["worktree", "list", "--porcelain"], root).split("\n")) {
    if (line.startsWith("worktree ")) {
      await flush();
      dir = line.slice("worktree ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      branch = line.slice("branch refs/heads/".length);
    } else if (line === "detached") {
      branch = "(detached)";
    }
  }
  await flush();
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function currentWorktree(): string {
  return git(["rev-parse", "--path-format=absolute", "--show-toplevel"]);
}

/**
 * Accepts a name, an alias recorded in `.worktree.json`, a path, or `.`/nothing
 * for the worktree the caller is standing in — the harness drops an agent
 * inside a worktree it never named, so requiring a name would lock it out.
 */
async function resolveEntry(root: string, token: string | undefined): Promise<Entry> {
  const entries = await listWorktrees(root);
  if (token === undefined || token === ".") {
    const here = currentWorktree();
    const match = entries.find((entry) => entry.dir === here);
    if (!match) {
      fail(
        here === root
          ? "this is the primary checkout, not a worktree; name one or run `bun run wt list`"
          : `${here} is not a worktree of this repo`
      );
    }
    return match;
  }

  const wanted = resolvePath(token);
  const matches = entries.filter((entry) => entry.name === token || entry.dir === wanted);
  if (matches.length === 0) fail(`no worktree "${token}"; run \`bun run wt list\``);
  if (matches.length > 1) {
    fail(`"${token}" matches several worktrees:\n${matches.map((entry) => `  ${entry.dir}`).join("\n")}`);
  }
  return matches[0];
}

/** `selfDir` keeps a worktree's own recorded port from reading as someone else's claim. */
async function pickPort(root: string, requested?: number, selfDir?: string): Promise<number> {
  const claimed = new Set(
    (await listWorktrees(root))
      .filter((entry) => entry.dir !== selfDir)
      .map((entry) => entry.meta?.port)
      .filter((port) => port !== undefined)
  );

  if (requested !== undefined) {
    if (!Number.isInteger(requested)) fail(`--port ${requested} is not a port number`);
    if (claimed.has(requested)) fail(`port ${requested} is already claimed by another worktree`);
    if (!(await isPortFree(requested))) fail(`port ${requested} is already in use`);
    return requested;
  }

  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    if (!claimed.has(port) && (await isPortFree(port))) return port;
  }
  return fail(`no free port in ${PORT_MIN}-${PORT_MAX}; remove a stale worktree first`);
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} needs a value`);
  return value;
}

async function install(dir: string): Promise<void> {
  const installed = run(["bun", "install"], dir);
  if (installed.code !== 0) fail(`bun install failed in ${dir}:\n${installed.stderr}`);
}

/**
 * `.gitignore` only covers branches that contain the entry, so on an older
 * branch the generated `.worktree.json` reads as an uncommitted change and
 * blocks `wt rm`. `info/exclude` lives in the common git dir and therefore
 * applies to every worktree regardless of which commit it has checked out.
 */
async function ensureExcluded(root: string): Promise<void> {
  const path = `${git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root)}/info/exclude`;
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch {
    // No exclude file yet; write one.
  }
  if (current.split("\n").includes(META_FILE)) return;
  await writeFile(path, `${current}${current.endsWith("\n") || !current ? "" : "\n"}${META_FILE}\n`);
}

/**
 * Point the worktree's copied `.env.local` at its own callback. Without this
 * every worktree sends users to `localhost:3000/callback`, so signing in
 * requires a second dev server on the primary checkout; ports 3000-3005 are
 * registered with WorkOS, so the first five worktrees can stand alone.
 * Returns the redirect URI in effect.
 */
async function syncRedirectUri(dir: string, port: number): Promise<string> {
  const path = `${dir}/${ENV_FILE}`;
  const current = await readFile(path, "utf8");
  const line = current.split("\n").find((entry) => entry.startsWith(`${REDIRECT_URI_VAR}=`));
  const existing = line?.slice(`${REDIRECT_URI_VAR}=`.length) ?? "";

  if (port > REDIRECT_PORT_MAX) return existing;

  const wanted = `http://localhost:${port}/callback`;
  if (existing === wanted) return wanted;

  const next = line
    ? current.replace(line, `${REDIRECT_URI_VAR}=${wanted}`)
    : `${current}${current.endsWith("\n") || !current ? "" : "\n"}${REDIRECT_URI_VAR}=${wanted}\n`;
  await writeFile(path, next);
  console.log(`pointed ${REDIRECT_URI_VAR} at ${wanted}`);
  return wanted;
}

/**
 * Bring a worktree up to what `new` guarantees: a claimed port recorded in
 * `.worktree.json`, its own copy of `.env.local`, and installed dependencies.
 * Worktrees made by hand or by the `omp` harness arrive with some subset of
 * those, so every step is conditional and the whole thing is idempotent.
 */
async function ensureRunnable(
  root: string,
  entry: Entry,
  options: { alias?: string; port?: number } = {}
): Promise<Meta> {
  const { dir } = entry;
  let meta = entry.meta;

  if (!meta || options.alias !== undefined || options.port !== undefined) {
    const port =
      options.port !== undefined
        ? await pickPort(root, options.port, dir)
        : (meta?.port ?? (await pickPort(root)));
    const next: Meta = {
      name: options.alias ?? meta?.name ?? entry.name,
      branch: entry.branch,
      port,
      base: meta?.base ?? "unknown",
      createdAt: meta?.createdAt ?? new Date().toISOString()
    };
    await writeFile(`${dir}/${META_FILE}`, `${JSON.stringify(next, null, 2)}\n`);
    await ensureExcluded(root);
    if (meta?.port !== next.port) console.log(`claimed port ${next.port} for ${next.name}`);
    meta = next;
  }

  if (!(await exists(`${dir}/${ENV_FILE}`))) {
    if (!(await exists(`${root}/${ENV_FILE}`))) {
      fail(`${root}/${ENV_FILE} is missing; cannot run a worktree without it`);
    }
    // Copy, never symlink: see the note in `cmdNew`.
    await copyFile(`${root}/${ENV_FILE}`, `${dir}/${ENV_FILE}`);
    console.log(`copied ${ENV_FILE} into ${meta.name}`);
  }

  if (!(await exists(`${dir}/node_modules/next/package.json`))) {
    console.log(`installing dependencies in ${meta.name}`);
    await install(dir);
  }

  await syncRedirectUri(dir, meta.port);
  return meta;
}

async function cmdNew(args: string[]): Promise<void> {
  const name = assertName(args[0]);
  const base = flagValue(args, "--base") ?? "main";
  const portFlag = flagValue(args, "--port");
  const root = mainCheckout();
  const dir = `${root}/${WORKTREE_SUBDIR}/${name}`;
  const branch = `${BRANCH_PREFIX}${name}`;

  if (await exists(`${dir}/package.json`)) {
    fail(`${dir} already exists; use \`bun run wt rm ${name}\` first`);
  }
  if (!(await exists(`${root}/${ENV_FILE}`))) {
    fail(`${root}/${ENV_FILE} is missing; a worktree cannot run without it`);
  }

  const port = await pickPort(root, portFlag === undefined ? undefined : Number(portFlag));
  const branchExists = run(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], root).code === 0;

  git(branchExists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, base], root);

  // Copy rather than symlink: `vercel env pull` inside a worktree would
  // otherwise rewrite the primary checkout's secrets through the link.
  await copyFile(`${root}/${ENV_FILE}`, `${dir}/${ENV_FILE}`);

  const meta: Meta = { name, branch, port, base, createdAt: new Date().toISOString() };
  await writeFile(`${dir}/${META_FILE}`, `${JSON.stringify(meta, null, 2)}\n`);
  await ensureExcluded(root);

  const skipInstall = args.includes("--no-install");
  if (!skipInstall) await install(dir);

  const redirectUri = await syncRedirectUri(dir, port);
  const ownCallback = redirectUri === `http://localhost:${port}/callback`;

  console.log(`worktree ${name}`);
  console.log(`  dir     ${dir}`);
  console.log(`  branch  ${branch}${branchExists ? " (existing)" : ` (new, from ${base})`}`);
  console.log(`  port    ${port}`);
  console.log(`  deps    ${skipInstall ? "skipped (--no-install)" : "installed"}`);
  console.log(`  signin  ${redirectUri}`);
  console.log("");
  console.log(`  bun run wt dev ${name}      # http://localhost:${port}`);
  console.log("");
  if (ownCallback) {
    console.log("  Sign-in works here directly: this callback is registered with WorkOS.");
  } else {
    console.log(`  Sign-in: WorkOS only knows ports up to ${REDIRECT_PORT_MAX}, so this worktree's`);
    console.log("  callback lands on the primary checkout. Cookies ignore port, so a session");
    console.log("  created there is sent to every localhost port. Keep a dev server on 3000");
    console.log("  while signing in.");
  }
  console.log("  Database: every worktree shares DATABASE_URL. Month writes are");
  console.log("  whole-document, so two instances editing one month is last-write-wins.");
}

async function cmdList(): Promise<void> {
  const root = mainCheckout();
  const entries = await listWorktrees(root);
  if (entries.length === 0) {
    console.log("no worktrees; create one with `bun run wt new <name>`");
    return;
  }

  const rows = await Promise.all(
    entries.map(async (entry) => {
      // `main..HEAD` inside the worktree, not `main..<branch>`: it also answers
      // for a detached checkout, which an externally created worktree may be.
      const ahead = git(["rev-list", "--count", "main..HEAD"], entry.dir);
      const dirty = git(["status", "--porcelain"], entry.dir).length > 0;
      const port = entry.meta?.port;
      return {
        name: entry.name,
        branch: entry.branch,
        kind: entry.kind,
        port: port === undefined ? "-" : String(port),
        dev: port !== undefined && !(await isPortFree(port)) ? "running" : "stopped",
        state: `${ahead} ahead${dirty ? ", dirty" : ""}`
      };
    })
  );

  const columns: { key: keyof (typeof rows)[number]; header: string }[] = [
    { key: "name", header: "NAME" },
    { key: "branch", header: "BRANCH" },
    { key: "kind", header: "KIND" },
    { key: "port", header: "PORT" },
    { key: "dev", header: "DEV" },
    { key: "state", header: "STATE" }
  ];
  const widths = columns.map(({ key, header }) =>
    Math.max(header.length, ...rows.map((row) => row[key].length))
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();

  console.log(line(columns.map(({ header }) => header)));
  for (const row of rows) console.log(line(columns.map(({ key }) => row[key])));
}

async function cmdAdopt(args: string[]): Promise<void> {
  const root = mainCheckout();
  const token = args[0]?.startsWith("--") ? undefined : args[0];
  const alias = flagValue(args, "--name");
  const portFlag = flagValue(args, "--port");
  const entry = await resolveEntry(root, token);
  const meta = await ensureRunnable(root, entry, {
    alias: alias === undefined ? undefined : assertName(alias),
    port: portFlag === undefined ? undefined : Number(portFlag)
  });

  console.log(`adopted ${meta.name} (${entry.kind})`);
  console.log(`  dir     ${entry.dir}`);
  console.log(`  branch  ${entry.branch}`);
  console.log(`  port    ${meta.port}`);
  console.log(
    `  signin  ${
      meta.port <= REDIRECT_PORT_MAX
        ? `http://localhost:${meta.port}/callback (registered; signs in here)`
        : `http://localhost:3000/callback (port ${meta.port} is not registered; sign in on 3000 first)`
    }`
  );
  console.log("");
  console.log(`  bun run wt dev ${meta.name}      # http://localhost:${meta.port}`);
}

async function cmdDev(args: string[]): Promise<void> {
  const root = mainCheckout();
  const entry = await resolveEntry(root, args[0]);
  const meta = await ensureRunnable(root, entry);

  if (!(await isPortFree(meta.port))) {
    fail(`port ${meta.port} is already in use; ${meta.name} may already be running`);
  }

  console.log(`${meta.name} -> http://localhost:${meta.port}`);
  const child = spawn("bun", ["run", "dev", "--hostname", "127.0.0.1", "--port", String(meta.port)], {
    cwd: entry.dir,
    stdio: "inherit"
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function cmdRm(args: string[]): Promise<void> {
  const force = args.includes("--force");
  const deleteBranch = args.includes("--delete-branch");
  const root = mainCheckout();
  const entry = await resolveEntry(root, args[0]?.startsWith("--") ? undefined : args[0]);

  if (!force) {
    // An external worktree belongs to whatever created it; deleting the
    // directory out from under the harness is not this script's call to make.
    if (entry.kind === "external") {
      fail(
        `${entry.name} lives outside ${root}/${WORKTREE_SUBDIR} (${entry.dir}) and is owned by ` +
          "whatever created it; remove it there, or pass --force to delete the directory anyway"
      );
    }
    if (git(["status", "--porcelain"], entry.dir)) {
      fail(`${entry.name} has uncommitted changes; commit them or pass --force`);
    }
    const unmerged = git(["rev-list", "--count", "main..HEAD"], entry.dir);
    if (unmerged !== "0") {
      fail(`${entry.branch} has ${unmerged} commit(s) not in main; merge them or pass --force`);
    }
  }

  git(["worktree", "remove", ...(force ? ["--force"] : []), entry.dir], root);
  git(["worktree", "prune"], root);
  if (deleteBranch) git(["branch", force ? "-D" : "-d", entry.branch], root);
  console.log(`removed ${entry.name}${deleteBranch ? ` and branch ${entry.branch}` : ""}`);
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "new":
    await cmdNew(rest);
    break;
  case "list":
  case "ls":
    await cmdList();
    break;
  case "adopt":
    await cmdAdopt(rest);
    break;
  case "dev":
    await cmdDev(rest);
    break;
  case "rm":
  case "remove":
    await cmdRm(rest);
    break;
  default:
    console.log("usage: bun run wt <new|list|adopt|dev|rm> [name|dir|.] [flags]");
    console.log("  new <name> [--base main] [--port N] [--no-install]");
    console.log("  list");
    console.log("  adopt [dir|.] [--name alias] [--port N]");
    console.log("  dev [name|dir|.]");
    console.log("  rm <name> [--force] [--delete-branch]");
    if (command) process.exit(1);
}
