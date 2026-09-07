import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Pin the Turbopack root to this checkout. Parallel worktrees live at
 * `.claude/worktrees/<name>`, i.e. *inside* the primary checkout, so
 * Turbopack's default upward search for a lockfile picks the parent repo and
 * roots a worktree's dev server at the wrong tree. See the parallel worktrees
 * section of AGENTS.md.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url))
  }
};

export default nextConfig;
