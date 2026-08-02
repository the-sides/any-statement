/**
 * Applies the SQL files in lib/migrations in filename order, recording each one
 * in `schema_migrations` so re-running only applies what is new.
 *
 *   bun run scripts/migrate.ts
 *
 * Set STATEMENT_LEDGER_LEGACY_USER_ID to claim rows written before the ledger
 * became multi-tenant. Those rows carry an empty `user_id`; the claim step
 * assigns them to that WorkOS user id and is a no-op once there is nothing left
 * unclaimed.
 *
 * Statements run one at a time rather than inside a transaction: the Neon HTTP
 * driver sends each statement as its own request, so a failure halfway through a
 * file leaves that file unrecorded and the next run re-applies it. Every
 * statement is written to tolerate that (`if not exists`, `drop ... if exists`).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getSql } from "@/lib/db";

const migrationsDir = path.join(process.cwd(), "lib", "migrations");
const sql = getSql();

await sql`
  create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`;

const applied = new Set(
  (
    (await sql`select name from schema_migrations`) as Array<{ name: string }>
  ).map((row) => row.name)
);
const files = (await readdir(migrationsDir))
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

let appliedCount = 0;

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip ${file} (already applied)`);
    continue;
  }

  const statements = splitStatements(
    await readFile(path.join(migrationsDir, file), "utf8")
  );

  console.log(`apply ${file} (${statements.length} statements)`);

  for (const statement of statements) {
    const [summary] = statement.split("\n");
    process.stdout.write(`  ${summary.slice(0, 70)}\n`);
    await sql.query(statement);
  }

  await sql`insert into schema_migrations (name) values (${file})`;
  appliedCount += 1;
}

console.log(`\nApplied ${appliedCount} migration(s).`);

await claimLegacyRows();

/**
 * Months are claimed first and on purpose: statements and expenses reference
 * (user_id, month) with `on update cascade`, so rewriting a month's owner
 * carries its rows along instead of orphaning them.
 */
async function claimLegacyRows() {
  const userId = process.env.STATEMENT_LEDGER_LEGACY_USER_ID;

  if (!userId) {
    console.log(
      "STATEMENT_LEDGER_LEGACY_USER_ID is not set; leaving unclaimed rows alone."
    );
    return;
  }

  const months = (await sql`
    update months set user_id = ${userId} where user_id = '' returning month
  `) as unknown[];
  const catalogs = (await sql`
    update category_catalog set user_id = ${userId} where user_id = ''
    returning user_id
  `) as unknown[];

  console.log(
    `Claimed ${months.length} month(s) and ${catalogs.length} category ` +
      `catalog(s) for ${userId}.`
  );
}

function splitStatements(source: string) {
  return source
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
