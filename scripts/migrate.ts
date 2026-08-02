/**
 * Applies lib/schema.sql. Every statement is `if not exists`, so this is safe
 * to re-run against an existing database.
 *
 *   bun run scripts/migrate.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSql } from "@/lib/db";

const schemaPath = path.join(process.cwd(), "lib", "schema.sql");
const schema = await readFile(schemaPath, "utf8");

const statements = schema
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const sql = getSql();

for (const statement of statements) {
  const [summary] = statement.split("\n");
  process.stdout.write(`${summary.slice(0, 72)}\n`);
  await sql.query(statement);
}

console.log(`\nApplied ${statements.length} statements.`);
