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
 */

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
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim()
  };
}

function git(args: string[], cwd?: string): string {
  const result = run(["git", ...args], cwd);
  if (result.code !== 0) {
    fail(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function fail(message: string): never {
  console.error(`worktree: ${message}`);
  process.exit(1);
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

function isPortFree(port: number): boolean {
  try {
    const server = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("") });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(dir: string): Promise<Meta | null> {
  const file = Bun.file(`${dir}/${META_FILE}`);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as Meta;
  } catch {
    return null;
  }
}

type Entry = { name: string; dir: string; branch: string; meta: Meta | null };

async function listWorktrees(root: string): Promise<Entry[]> {
  const porcelain = git(["worktree", "list", "--porcelain"], root);
  const entries: Entry[] = [];
  let dir = "";
  let branch = "";

  const flush = async () => {
    if (!dir) return;
    if (dir.startsWith(`${root}/${WORKTREE_SUBDIR}/`)) {
      const name = dir.slice(`${root}/${WORKTREE_SUBDIR}/`.length);
      entries.push({ name, dir, branch, meta: await readMeta(dir) });
    }
    dir = "";
    branch = "";
  };

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      await flush();
      dir = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      branch = line.slice("branch refs/heads/".length);
    } else if (line === "detached") {
      branch = "(detached)";
    }
  }
  await flush();
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

async function pickPort(root: string, requested?: number): Promise<number> {
  const claimed = new Set<number>(
    (await listWorktrees(root)).map((entry) => entry.meta?.port).filter((port): port is number => !!port)
  );

  if (requested) {
    if (claimed.has(requested)) fail(`port ${requested} is already claimed by another worktree`);
    if (!isPortFree(requested)) fail(`port ${requested} is already in use`);
    return requested;
  }

  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    if (!claimed.has(port) && isPortFree(port)) return port;
  }
  return fail(`no free port in ${PORT_MIN}-${PORT_MAX}; remove a stale worktree first`);
}

async function cmdNew(args: string[]): Promise<void> {
  const name = assertName(args[0]);
  const base = flagValue(args, "--base") ?? "main";
  const portFlag = flagValue(args, "--port");
  const install = !args.includes("--no-install");
  const root = mainCheckout();
  const dir = `${root}/${WORKTREE_SUBDIR}/${name}`;
  const branch = `${BRANCH_PREFIX}${name}`;

  if (await Bun.file(`${dir}/package.json`).exists()) {
    fail(`${dir} already exists; use \`bun run wt rm ${name}\` first`);
  }

  const env = Bun.file(`${root}/${ENV_FILE}`);
  if (!(await env.exists())) {
    fail(`${root}/${ENV_FILE} is missing; a worktree cannot run without it`);
  }

  const port = await pickPort(root, portFlag ? Number(portFlag) : undefined);
  const branchExists = run(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], root).code === 0;

  git(
    branchExists
      ? ["worktree", "add", dir, branch]
      : ["worktree", "add", "-b", branch, dir, base],
    root
  );

  // Copy rather than symlink: `vercel env pull` inside a worktree would
  // otherwise rewrite the primary checkout's secrets through the link.
  await Bun.write(`${dir}/${ENV_FILE}`, env);

  const meta: Meta = { name, branch, port, base, createdAt: new Date().toISOString() };
  await Bun.write(`${dir}/${META_FILE}`, `${JSON.stringify(meta, null, 2)}\n`);

  if (install) {
    const installed = run(["bun", "install"], dir);
    if (installed.code !== 0) fail(`bun install failed in ${dir}:\n${installed.stderr}`);
  }

  console.log(`worktree ${name}`);
  console.log(`  dir     ${dir}`);
  console.log(`  branch  ${branch}${branchExists ? " (existing)" : ` (new, from ${base})`}`);
  console.log(`  port    ${port}`);
  console.log(`  deps    ${install ? "installed" : "skipped (--no-install)"}`);
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

  const rows = entries.map((entry) => {
    const dirty = git(["status", "--porcelain"], entry.dir).length > 0;
    const ahead = git(["rev-list", "--count", `main..${entry.branch}`], root);
    const port = entry.meta?.port;
    const serving = port ? !isPortFree(port) : false;
    return {
      name: entry.name,
      branch: entry.branch,
      port: port ? String(port) : "-",
      dev: serving ? "running" : "stopped",
      state: `${ahead === "0" ? "0 ahead" : `${ahead} ahead`}${dirty ? ", dirty" : ""}`
    };
  });

  const width = (key: keyof (typeof rows)[number], header: string) =>
    Math.max(header.length, ...rows.map((row) => row[key].length));
  const widths = {
    name: width("name", "NAME"),
    branch: width("branch", "BRANCH"),
    port: width("port", "PORT"),
    dev: width("dev", "DEV")
  };

  console.log(
    `${"NAME".padEnd(widths.name)}  ${"BRANCH".padEnd(widths.branch)}  ${"PORT".padEnd(widths.port)}  ${"DEV".padEnd(widths.dev)}  STATE`
  );
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(widths.name)}  ${row.branch.padEnd(widths.branch)}  ${row.port.padEnd(widths.port)}  ${row.dev.padEnd(widths.dev)}  ${row.state}`
    );
  }
}

async function cmdDev(args: string[]): Promise<void> {
  const name = assertName(args[0]);
  const root = mainCheckout();
  const dir = `${root}/${WORKTREE_SUBDIR}/${name}`;
  const meta = await readMeta(dir);
  if (!meta) fail(`no worktree "${name}" (or it has no ${META_FILE}); run \`bun run wt list\``);
  if (!isPortFree(meta.port)) fail(`port ${meta.port} is already in use; ${name} may already be running`);

  console.log(`${name} -> http://localhost:${meta.port}`);
  const child = Bun.spawn(
    ["bun", "run", "dev", "--hostname", "127.0.0.1", "--port", String(meta.port)],
    { cwd: dir, stdio: ["inherit", "inherit", "inherit"] }
  );
  process.exit(await child.exited);
}

async function cmdRm(args: string[]): Promise<void> {
  const name = assertName(args[0]);
  const force = args.includes("--force");
  const deleteBranch = args.includes("--delete-branch");
  const root = mainCheckout();
  const dir = `${root}/${WORKTREE_SUBDIR}/${name}`;
  const entry = (await listWorktrees(root)).find((candidate) => candidate.name === name);
  if (!entry) fail(`no worktree "${name}"; run \`bun run wt list\``);

  if (!force) {
    const dirty = git(["status", "--porcelain"], dir);
    if (dirty) fail(`${name} has uncommitted changes; commit them or pass --force`);
    const unmerged = git(["rev-list", "--count", `main..${entry.branch}`], root);
    if (unmerged !== "0") {
      fail(`${entry.branch} has ${unmerged} commit(s) not in main; merge them or pass --force`);
    }
  }

  git(["worktree", "remove", ...(force ? ["--force"] : []), dir], root);
  git(["worktree", "prune"], root);
  if (deleteBranch) git(["branch", force ? "-D" : "-d", entry.branch], root);
  console.log(`removed ${name}${deleteBranch ? ` and branch ${entry.branch}` : ""}`);
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} needs a value`);
  return value;
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
