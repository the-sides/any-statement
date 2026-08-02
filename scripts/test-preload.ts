import { mock } from "bun:test";

/**
 * `server-only` throws on import unless the bundler resolves it under React's
 * `react-server` condition, which `bun test` does not do. Route tests import
 * modules that reach it through `@workos-inc/authkit-nextjs`, so it is stubbed
 * out here rather than kept out of the import graph. Next.js still applies the
 * real guard at build time.
 */
mock.module("server-only", () => ({}));
