/**
 * One-shot import of the local file-backed ledger into Postgres.
 *
 *   STATEMENT_LEDGER_LEGACY_USER_ID=user_... bun run scripts/import-local-months.ts [dataDir]
 *
 * The ledger is per-user, and these files predate that, so the importer has to
 * be told whose months they are rather than guessing.
 *
 * Re-runnable: writeStoredMonth replaces a month wholesale, so importing the
 * same file twice leaves the same rows.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isMonthKey, parseMonthDocument, summarizeMonthDocument } from "@/lib/months";
import { writeStoredMonth } from "@/lib/monthStore";

const userId = process.env.STATEMENT_LEDGER_LEGACY_USER_ID;

if (!userId) {
  console.error(
    "Set STATEMENT_LEDGER_LEGACY_USER_ID to the WorkOS user id that owns these months."
  );
  process.exit(1);
}

const dataDir =
  process.argv[2] || path.join(process.cwd(), "data", "months");

const entries = (await readdir(dataDir)).filter((entry) =>
  entry.endsWith(".json")
);

if (entries.length === 0) {
  console.log(`No month files found in ${dataDir}.`);
  process.exit(0);
}

let imported = 0;

for (const entry of entries.sort()) {
  const month = entry.slice(0, -".json".length);

  if (!isMonthKey(month)) {
    console.warn(`skip ${entry} (not a YYYY-MM month file)`);
    continue;
  }

  const document = parseMonthDocument(
    JSON.parse(await readFile(path.join(dataDir, entry), "utf8"))
  );

  if (!document) {
    console.warn(`skip ${entry} (not a valid month document)`);
    continue;
  }

  await writeStoredMonth(userId, document);

  const summary = summarizeMonthDocument(document);
  console.log(
    `imported ${summary.month}: ${summary.statementCount} statements, ` +
      `${summary.expenseCount} expenses, ${summary.amount.toFixed(2)}`
  );
  imported += 1;
}

console.log(`\nImported ${imported} month(s).`);
