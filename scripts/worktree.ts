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
 *   bun run wt dev <name>
 *   bun run wt rm <name> [--force] [--delete-branch]
 *
 * Layout matches what already existed by hand: worktree at
 * `.claude/worktrees/<name>` on branch `worktree-<name>`. `.claude/**` is
 * ignored by git, eslint, and tsconfig globs, and `bun test` skips dot
 * directories, so nested checkouts never leak into the main repo's tooling.
 *
 * Node APIs only, deliberately: the repo has `@types/node` but no `@types/bun`
 * (see `types/bun-test.d.ts`), so `Bun.*` here would fail `bun run typecheck`.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { access, copyFile, readFile, writeFile } from "node:fs/promises";

const WORKTREE_SUBDIR = ".claude/worktrees";
const BRANCH_PREFIX = "worktree-";
const PORT_MIN = 3001;
const PORT_MAX = 3019;
const META_FILE = ".worktree.json";
const ENV_FILE = ".env.local";

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

type Entry = { name: string; dir: string; branch: string; meta: Meta | null };

async function listWorktrees(root: string): Promise<Entry[]> {
  const prefix = `${root}/${WORKTREE_SUBDIR}/`;
  const entries: Entry[] = [];
  let dir = "";
  let branch = "";

  const flush = async () => {
    if (dir.startsWith(prefix)) {
      const name = dir.slice(prefix.length);
      entries.push({ name, dir, branch, meta: await readMeta(dir) });
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

async function pickPort(root: string, requested?: number): Promise<number> {
  const claimed = new Set(
    (await listWorktrees(root)).map((entry) => entry.meta?.port).filter((port) => port !== undefined)
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

  console.log(`worktree ${name}`);
  console.log(`  dir     ${dir}`);
  console.log(`  branch  ${branch}${branchExists ? " (existing)" : ` (new, from ${base})`}`);
  console.log(`  port    ${port}`);
  console.log(`  deps    ${skipInstall ? "skipped (--no-install)" : "installed"}`);
  console.log("");
  console.log(`  bun run wt dev ${name}      # http://localhost:${port}`);
  console.log("");
  console.log("  Sign-in: WorkOS only knows http://localhost:3000/callback, so the");
  console.log("  callback lands on the primary checkout. Cookies ignore port, so a");
  console.log("  session created there is sent to every localhost port. Keep a dev");
  console.log("  server on 3000 while signing in.");
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
      const ahead = git(["rev-list", "--count", `main..${entry.branch}`], root);
      const dirty = git(["status", "--porcelain"], entry.dir).length > 0;
      const port = entry.meta?.port;
      return {
        name: entry.name,
        branch: entry.branch,
        port: port === undefined ? "-" : String(port),
        dev: port !== undefined && !(await isPortFree(port)) ? "running" : "stopped",
        state: `${ahead} ahead${dirty ? ", dirty" : ""}`
      };
    })
  );

  const columns: { key: keyof (typeof rows)[number]; header: string }[] = [
    { key: "name", header: "NAME" },
    { key: "branch", header: "BRANCH" },
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

async function cmdDev(args: string[]): Promise<void> {
  const name = assertName(args[0]);
  const root = mainCheckout();
  const dir = `${root}/${WORKTREE_SUBDIR}/${name}`;
  if (!(await exists(`${dir}/package.json`))) fail(`no worktree "${name}"; run \`bun run wt list\``);

  // Worktrees created by hand (before this script existed) carry no port, no
  // env file, and no dependencies. Heal them in place rather than making the
  // user delete and recreate the checkout they are working in.
  let meta = await readMeta(dir);
  if (!meta) {
    meta = {
      name,
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"], dir),
      port: await pickPort(root),
      base: "unknown",
      createdAt: new Date().toISOString()
    };
    await writeFile(`${dir}/${META_FILE}`, `${JSON.stringify(meta, null, 2)}\n`);
    await ensureExcluded(root);
    console.log(`claimed port ${meta.port} for pre-existing worktree ${name}`);
  }

  if (!(await exists(`${dir}/${ENV_FILE}`))) {
    if (!(await exists(`${root}/${ENV_FILE}`))) {
      fail(`${root}/${ENV_FILE} is missing; cannot run a worktree without it`);
    }
    await copyFile(`${root}/${ENV_FILE}`, `${dir}/${ENV_FILE}`);
    console.log(`copied ${ENV_FILE} into ${name}`);
  }

  if (!(await exists(`${dir}/node_modules/next/package.json`))) {
    console.log(`installing dependencies in ${name}`);
    await install(dir);
  }

  if (!(await isPortFree(meta.port))) {
    fail(`port ${meta.port} is already in use; ${name} may already be running`);
  }

  console.log(`${name} -> http://localhost:${meta.port}`);
  const child = spawn("bun", ["run", "dev", "--hostname", "127.0.0.1", "--port", String(meta.port)], {
    cwd: dir,
    stdio: "inherit"
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function cmdRm(args: string[]): Promise<void> {
  const name = assertName(args[0]);
  const force = args.includes("--force");
  const deleteBranch = args.includes("--delete-branch");
  const root = mainCheckout();
  const entry = (await listWorktrees(root)).find((candidate) => candidate.name === name);
  if (!entry) fail(`no worktree "${name}"; run \`bun run wt list\``);

  if (!force) {
    if (git(["status", "--porcelain"], entry.dir)) {
      fail(`${name} has uncommitted changes; commit them or pass --force`);
    }
    const unmerged = git(["rev-list", "--count", `main..${entry.branch}`], root);
    if (unmerged !== "0") {
      fail(`${entry.branch} has ${unmerged} commit(s) not in main; merge them or pass --force`);
    }
  }

  git(["worktree", "remove", ...(force ? ["--force"] : []), entry.dir], root);
  git(["worktree", "prune"], root);
  if (deleteBranch) git(["branch", force ? "-D" : "-d", entry.branch], root);
  console.log(`removed ${name}${deleteBranch ? ` and branch ${entry.branch}` : ""}`);
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
  case "dev":
    await cmdDev(rest);
    break;
  case "rm":
  case "remove":
    await cmdRm(rest);
    break;
  default:
    console.log("usage: bun run wt <new|list|dev|rm> [name] [flags]");
    console.log("  new <name> [--base main] [--port N] [--no-install]");
    console.log("  list");
    console.log("  dev <name>");
    console.log("  rm <name> [--force] [--delete-branch]");
    if (command) process.exit(1);
}
