# Statement Ledger

Statement Ledger is a local-first Bun + Next.js app for turning credit card and bank statement PDFs into editable expense rows, then saving approved rows into a Notion data source.

The current flow is intentionally simple:

1. Upload a PDF statement.
2. Extract statement metadata and expense rows.
3. Review and edit the rows in the table.
4. Select approved rows.
5. Save selected rows to Notion.

## Current Status

- Working local app at `http://127.0.0.1:3000`.
- OpenRouter is the primary extraction path.
- Text-bearing PDF fallback is implemented for cases where OpenRouter returns metadata but no rows.
- Notion save is wired to a data source through `NOTION_DATA_SOURCE_ID`.
- Categories are managed by the app, can be imported from a Notion category data source, and can be disabled without being deleted.
- Reviewer categorization notes are saved in browser localStorage and sent to OpenRouter with each extraction.
- Uploaded PDFs and extraction artifacts are persisted under `/tmp/statement-ledger/uploads/<upload-id>/`.

## Stack

- Bun for package management and scripts.
- Next.js App Router for the UI and server routes.
- OpenRouter chat completions with PDF file input and JSON schema output.
- Notion REST API with `data_source_id` page creation.
- `pdftotext` from Poppler as a local fallback when the LLM returns statement metadata but no transaction rows.

## Project Layout

- `components/StatementWorkspace.tsx` - main upload, review, edit, and save UI.
- `app/api/categories/route.ts` - category catalog read and enabled/disabled updates.
- `app/api/categories/import/route.ts` - Notion category data source import route.
- `app/api/extract/route.ts` - PDF upload/extraction route.
- `app/api/notion/save/route.ts` - selected-expense save route.
- `lib/categoryStore.ts` - local category catalog persistence.
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
bun run dev --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`.

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

The fallback parser expects `pdftotext` from Poppler to be available on the host. On many Linux systems this is provided by `poppler-utils`.

## Notion Data Source

The app uses its local category catalog during extraction. The catalog starts with built-in defaults and can import category rows from the Notion data source configured by `NOTION_CATEGORY_DATA_SOURCE_ID`. Imported and built-in categories stay in the catalog when disabled; disabled categories are not offered to the LLM for new extraction rows.

The expense save path uses the expense data source's existing title column and writes generated categories to `Expense Category` if `Category` is already used for a relation.

Expected writable properties:

| Property | Type |
| --- | --- |
| Name | Title |
| Date | Date |
| Merchant | Text |
| Description | Text |
| Subcategory | Text |
| Expense Category | Select |
| Amount | Number |
| Currency | Select |
| Payment Method | Select |
| Section | Select |
| Statement | Select |
| Account | Text |
| Institution | Text |
| Statement Period | Text |
| Source File | Text |
| Confidence | Number |
| Notes | Text |

If the data source is missing optional expense columns, the app adds them before saving rows. It does not delete or overwrite existing columns. An existing `Category` relation can stay in place; the app leaves it alone.

## Extraction Artifacts

Every upload creates a directory like:

```text
/tmp/statement-ledger/uploads/2026-06-12T07-22-09-272Z-b60e64de/
```

Files may include:

- Original uploaded PDF.
- `upload.json` with upload metadata.
- `extraction.json` with OpenRouter provider response and normalized extraction.
- `extraction.json` also records reviewer categorization notes submitted with the upload.
- `fallback.json` when the local text fallback was used.
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

Useful replay command for a saved PDF:

```bash
curl -s -o /tmp/statement-ledger-route-replay.json \
  -F statementPdf=@/tmp/statement-ledger/uploads/<upload-id>/<file>.pdf \
  http://127.0.0.1:3000/api/extract
```

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
