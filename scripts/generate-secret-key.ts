/**
 * Prints a fresh STATEMENT_LEDGER_SECRET_KEY.
 *
 *   bun run scripts/generate-secret-key.ts
 *
 * Rotating this key makes every stored Notion token unreadable, so each user
 * has to paste their integration token again. Set it once per deployment.
 */
import { generateSecretKey } from "@/lib/secrets";

console.log(generateSecretKey());
