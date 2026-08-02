/**
 * Moves the deployment-wide NOTION_* environment variables into the per-user
 * `notion_connections` row they were replaced by.
 *
 *   STATEMENT_LEDGER_LEGACY_USER_ID=user_... bun run scripts/import-notion-connection.ts
 *
 * Reads NOTION_API_KEY, NOTION_DATA_SOURCE_ID and NOTION_CATEGORY_DATA_SOURCE_ID
 * from the environment and stores them encrypted against that user. Run it once;
 * after that the connection is edited in the app, and the NOTION_* variables can
 * be deleted from the deployment.
 */
import {
  readNotionConnectionStatus,
  writeNotionConnection
} from "@/lib/notionConnection";
import { isSecretKeyConfigured, SECRET_KEY_ENV } from "@/lib/secrets";

const userId = process.env.STATEMENT_LEDGER_LEGACY_USER_ID;

if (!userId) {
  console.error(
    "Set STATEMENT_LEDGER_LEGACY_USER_ID to the WorkOS user id that owns this Notion workspace."
  );
  process.exit(1);
}

if (!isSecretKeyConfigured()) {
  console.error(
    `Set ${SECRET_KEY_ENV} first: bun run scripts/generate-secret-key.ts`
  );
  process.exit(1);
}

const apiKey = process.env.NOTION_API_KEY || "";

if (!apiKey) {
  console.error("NOTION_API_KEY is not set; there is nothing to import.");
  process.exit(1);
}

await writeNotionConnection(userId, {
  apiKey,
  dataSourceId: process.env.NOTION_DATA_SOURCE_ID || "",
  categoryDataSourceId: process.env.NOTION_CATEGORY_DATA_SOURCE_ID || ""
});

const status = await readNotionConnectionStatus(userId);

console.log(`Stored a Notion connection for ${userId}:`);
console.log(`  integration token: ${status.hasApiKey ? "stored" : "missing"}`);
console.log(`  expenses data source: ${status.dataSourceId || "missing"}`);
console.log(
  `  category data source: ${status.categoryDataSourceId || "missing"}`
);
console.log(`  ready to save: ${status.ready}`);
