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
  /**
   * `next dev` prints `Local: http://localhost:3000`, but agents and scripts
   * browse `http://127.0.0.1:3000`. Next treats that as a cross-origin dev
   * request and blocks `/_next/webpack-hmr`, which leaves the page served but
   * never hydrated - clicks do nothing and the failure looks like a bug in the
   * component. Same machine, dev only.
   */
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url))
  }
};

export default nextConfig;
