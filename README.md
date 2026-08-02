# Statement Ledger

Statement Ledger is a Bun + Next.js app for turning credit card and bank statement PDFs or CSVs into editable expense rows, then saving approved rows into a Notion data source. It runs locally and deploys to Vercel, so statements can be uploaded from a phone.

The current flow is intentionally simple:

1. Upload a PDF or CSV statement.
2. Extract statement metadata and expense rows.
3. Review and edit the rows in the table.
4. Select approved rows.
5. Save selected rows to Notion.

## Current Status

- Working local app at `http://127.0.0.1:3000`, deployable to Vercel.
- Months and the category catalog live in Postgres (Neon), so the ledger survives on a serverless host.
- Every route is behind a WorkOS AuthKit session.
- OpenRouter is the primary extraction path.
- CSV uploads are extracted by OpenRouter from the uploaded CSV text.
- Text-bearing PDF fallback is implemented for PDF cases where OpenRouter returns metadata but no rows.
- Notion save is wired to a data source through `NOTION_DATA_SOURCE_ID`.
- Categories are managed by the app, can be imported from a Notion category data source, and can be disabled without being deleted. Category reads fall back to the built-in defaults if the database is unreachable, so extraction and Notion saves keep working.
- Reviewer categorization notes are saved in browser localStorage and sent to OpenRouter with each extraction.
- Uploaded statement files and extraction artifacts are persisted under `/tmp/statement-ledger/uploads/<upload-id>/`.

## Stack

- Bun for package management and scripts.
- Next.js App Router for the UI and server routes.
- OpenRouter chat completions with PDF file input or CSV text input and JSON schema output.
- Notion REST API with `data_source_id` page creation.
- Neon Postgres via `@neondatabase/serverless` for months and the category catalog.
- WorkOS AuthKit (`@workos-inc/authkit-nextjs`) for the session gate.
- `unpdf` for PDF text, rendered onto a character grid so column gaps survive for the fallback parser.

## Project Layout

- `components/StatementWorkspace.tsx` - main upload, review, edit, and save UI.
- `app/api/categories/route.ts` - category catalog read and enabled/disabled updates.
- `app/api/categories/import/route.ts` - Notion category data source import route.
- `app/api/extract/route.ts` - statement upload/extraction route.
- `app/api/notion/save/route.ts` - selected-expense save route.
- `lib/categoryStore.ts` - category catalog persistence.
- `lib/db.ts` - lazy Neon client and column coercion helpers.
- `lib/schema.sql` - months, statements, expenses, and category catalog tables.
- `lib/monthStore.ts` - month document reads and whole-month transactional writes.
- `proxy.ts` - WorkOS session gate over every route except the sign-in flow.
- `scripts/migrate.ts` - applies `lib/schema.sql`.
- `scripts/import-local-months.ts` - imports `data/months/*.json` into Postgres.
- `lib/openrouter.ts` - OpenRouter request and JSON parsing.
- `lib/fallbackExtractor.ts` - deterministic `pdftotext` fallback for Amex-style `New Charges Details` tables.
- `lib/artifacts.ts` - upload/debug artifact persistence under `/tmp`.
- `lib/notion.ts` - Notion schema reconciliation and page creation.
- `lib/extractionSchema.ts` - structured-output JSON schema.
- `lib/categories.ts` - app category and enum vocabulary.

## Setup

```bash
bun install
cp .env.example .env.local
bun run scripts/migrate.ts    # creates the tables; safe to re-run
bun run dev --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`.

To load an existing file-backed ledger into Postgres once:

```bash
bun run scripts/import-local-months.ts
```

On this machine, the sandbox may block binding to localhost. Running the dev server may require approval/escalation.

## Environment

```bash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6
OPENROUTER_PDF_ENGINE=cloudflare-ai
OPENROUTER_HTTP_REFERER=http://localhost:3000

NOTION_API_KEY=
NOTION_DATA_SOURCE_ID=
NOTION_CATEGORY_DATA_SOURCE_ID=
STATEMENT_LEDGER_ARTIFACT_DIR=/tmp/statement-ledger
```

`.env.local` is ignored by git and contains the real local credentials. Do not commit API keys.

`OPENROUTER_PDF_ENGINE=cloudflare-ai` is the no-cost parser. Use `mistral-ocr` for scanned statements if extraction quality is poor.

PDF text extraction runs in-process via `unpdf`, so no Poppler install is needed and it works unchanged on Vercel. `lib/pdfText.ts` reconstructs a `pdftotext -layout`-style character grid from the text coordinates, because the `New Charges Details` fallback parser matches on multi-space column gaps.

## Notion Data Source

The app uses its local category catalog during extraction. The catalog starts with built-in defaults and can import category rows from the Notion data source configured by `NOTION_CATEGORY_DATA_SOURCE_ID`. Imported and built-in categories stay in the catalog when disabled; disabled categories are not offered to the LLM for new extraction rows.

The expense save path titles each row with the merchant (or description, when there is no merchant) and writes the row's category to the existing `Category` relation. The relation should point at the category data source configured by `NOTION_CATEGORY_DATA_SOURCE_ID`. Categories are matched to existing rows by name, case-insensitively. A category with no matching row is never created in Notion: the expense saves with an empty `Category`, and the save response lists those names so the reviewer sees which rows need a category picked in Notion.

Expected writable properties:

| Property | Type |
| --- | --- |
| Name | Title |
| Date | Date |
| Merchant | Text |
| Description | Text |
| Subcategory | Text |
| Category | Relation |
| Amount | Number |
| Account | Text |
| Institution | Text |
| Source File | Text |
| Confidence | Number |
| Notes | Text |

If the expense data source is missing optional expense columns, the app adds them before saving rows. It does not delete or overwrite existing columns. The app expects `Category` to already be a Notion relation and uses it directly.

## Deployment

The app is linked to the Vercel project `merger-ai/any-statement`.

1. Provision Postgres: `vercel integration add neon --name statement-ledger-db`.
2. Set the remaining secrets for each environment with `vercel env add`: the `OPENROUTER_*`, `NOTION_*`, and `WORKOS_*` values from `.env.example`.
3. In the WorkOS dashboard under **Redirects**, register `https://<domain>/callback` as a redirect URI and `https://<domain>/sign-in` as the sign-in URL.
4. Pull the provisioned values locally and create the tables against the deployed database:

```bash
vercel env pull .env.local --yes
bun run scripts/migrate.ts
bun run scripts/import-local-months.ts   # first deploy only
```

5. Deploy: `vercel deploy --prod`.

Notes:

- `proxy.ts` protects every route, so an anonymous request never reaches statement data. It also
  enforces `STATEMENT_LEDGER_ALLOWED_EMAILS`: a WorkOS session alone only proves someone signed
  in, so without an allowlist anyone able to sign up would reach the ledger. An unset allowlist
  denies everyone.
- Reviewer categorization notes, review history, and the cash flow plan live in browser `localStorage`, not the database. They do not follow you between devices, so a phone starts without the notes that tune extraction.
- Upload and debug artifacts still go to `/tmp`, which is per-instance and ephemeral on Vercel. They are written and read within a single request, so extraction is unaffected; only after-the-fact debugging is lost.

## Extraction Artifacts

Every upload creates a directory like:

```text
/tmp/statement-ledger/uploads/2026-06-12T07-22-09-272Z-b60e64de/
```

Files may include:

- Original uploaded statement file.
- `upload.json` with upload metadata.
- `extraction.json` with OpenRouter provider response and normalized extraction.
- `extraction.json` also records reviewer categorization notes submitted with the upload.
- `fallback.json` when the local PDF text fallback was used.
- `final-extraction.json` with the payload returned to the UI.
- `error.json` if extraction fails.

For the reproduced American Express statement bug, the fallback parser found 41 rows totaling `$2,614.97`, matching the statement's `Total New Charges`.

## Verification

Run before committing:

```bash
bun run typecheck
bun run lint
BUN_INSTALL=/tmp/bun-install BUN_TMPDIR=/tmp/bun-tmp bun run build
```

Useful replay command for a saved statement file:

```bash
curl -s -o /tmp/statement-ledger-route-replay.json \
  -F statementFile=@/tmp/statement-ledger/uploads/<upload-id>/<file>.pdf \
  http://127.0.0.1:3000/api/extract
```

Use the same `statementFile` field for `.csv` artifacts.

Then summarize:

```bash
jq '{rows: (.extraction.expenses | length), total: (.extraction.expenses | map(.amount) | add), artifact: .artifact.dir}' /tmp/statement-ledger-route-replay.json
```

## Git Checkpoints

Current checkpoint commits:

- `f7f2eb9` - initial app baseline.
- `1cde5d0` - persisted upload/extraction artifacts.
- `7257a4e` - fallback parser for statement charges.

Continue committing small, working checkpoints after meaningful changes.
