# Statement Ledger

A Bun + Next.js app for turning credit card and bank statement PDFs into editable expense rows, then saving approved rows into a Notion data source.

## Stack

- Bun for package management and scripts
- Next.js App Router for the UI and server routes
- OpenRouter chat completions with PDF file input and JSON schema output
- Notion REST API with `data_source_id` page creation
- `pdftotext` as a local fallback when the LLM returns statement metadata but no transaction rows

## Setup

```bash
bun install
cp .env.example .env.local
bun run dev
```

Open `http://localhost:3000`.

The fallback parser expects `pdftotext` from Poppler to be available on the host. On many Linux systems this is provided by `poppler-utils`.

## Environment

```bash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=google/gemini-3.1-flash-lite
OPENROUTER_PDF_ENGINE=cloudflare-ai
OPENROUTER_HTTP_REFERER=http://localhost:3000

NOTION_API_KEY=
NOTION_DATA_SOURCE_ID=
```

`OPENROUTER_PDF_ENGINE=cloudflare-ai` is the no-cost parser. Use `mistral-ocr` for scanned statements if extraction quality is poor.

## Notion Data Source

Create or share a Notion data source. The app uses the data source's existing title column and writes generated categories to `Expense Category` if `Category` is already used for a relation.

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

Share the data source with your Notion integration and copy its data source ID into `.env.local`.

If the data source is missing optional expense columns, the app will add them before saving rows. It will not delete or overwrite existing columns. An existing `Category` relation can stay in place; the app leaves it alone.

## Flow

1. Pick a statement PDF.
2. Extract expenses with OpenRouter.
3. Edit statement metadata and expense rows.
4. Select approved rows.
5. Save selected rows to Notion.

The UI starts with sample rows so review and editing can be exercised before credentials are configured.

Uploads are saved to `/tmp/statement-ledger/uploads/<upload-id>/` with the original PDF, OpenRouter response, fallback output when used, and the final extraction JSON.
