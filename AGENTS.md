# Agent Context

This project lives at:

```text
/home/jake/repos/any-statement
```

It is a Bun + Next.js app named Statement Ledger. The user is testing it from a phone against localhost and expects uploaded statement files to be saved locally so agents can inspect and replay the exact statements.

## Rules For Future Agents

- Use Bun, not npm or pnpm.
- Preserve `.env.local`; it contains real local API keys and is ignored by git.
- Do not print API keys or commit secrets.
- Commit working checkpoints after meaningful changes.
- Inspect real artifacts under `/tmp/statement-ledger/uploads/` before hypothesizing about extraction bugs.
- If the user reports an extraction issue, start from `upload.json`, `extraction.json`, `fallback.json`, and `final-extraction.json`.
- For Next.js work, initialize Next DevTools and use official Next docs through MCP before relying on framework knowledge.
- When verifying the UI locally on this machine, Playwright Chrome may be missing. System Chromium is available at `/usr/bin/chromium`.
- Localhost and browser commands may need escalation because the sandbox can block server binds and host networking.

## Current Behavior

- `/` renders the upload/review/save workspace, scoped to one month at a time.
- An uploaded statement is filed into the calendar month covering most of its period,
  falling back to its row dates, and the workspace switches to that month. There is no
  save-month action; months are derived. See `specs/month-scoped-statements.md`.
- Month documents live on disk in `./data/months/<YYYY-MM>.json` (gitignored) rather than
  in the `/tmp` artifact directory, which has been wiped before.
- The workspace edits the active month optimistically and flushes to the server on a
  ~500ms debounce, forced on page unload. The cash flow plan, undo history, categorization
  notes, and the app-category preference stay in browser localStorage and stay global.
- `/api/extract` accepts `statementFile` as multipart form data, with legacy `statementPdf` replays still accepted.
- `/api/extract` saves the original PDF or CSV and extraction artifacts to `/tmp/statement-ledger/uploads/<upload-id>/`.
- OpenRouter is the primary extraction path.
- Categories are app-managed, persisted locally, and disabled categories remain in the catalog.
- When `NOTION_CATEGORY_DATA_SOURCE_ID` is set, the first catalog load imports the Notion
  categories and stores `importedAt`. Later loads reuse the stored catalog, so categories
  turned off by the reviewer are never resurrected; `Import` re-runs it on demand. If the
  import fails, the catalog falls back to built-ins and retries on the next load.
- Built-in (`app`) categories are hidden while at least one enabled `notion` category
  exists. Turning off every Notion category, or ticking the `APP categories` checkbox,
  brings the built-ins back. `lib/categories.ts` owns that rule and both the workspace and
  `/api/extract` use it.
- Reviewer categorization notes are saved in browser localStorage, submitted with `/api/extract`, and included in OpenRouter prompt/debug artifacts.
- CSV uploads are extracted through OpenRouter from uploaded CSV text.
- If OpenRouter returns PDF statement metadata but zero rows, `lib/fallbackExtractor.ts` uses `pdftotext -layout` to parse Amex-style `New Charges Details` tables.
- `/api/notion/save` saves selected reviewed rows to Notion.
- `lib/notion.ts` reconciles missing optional Notion properties before creating pages and writes
  the existing `Category` relation. It titles each row with the merchant (or description) and never
  repeats the date there, and it never writes the legacy `Expense Category` select.
- Category relations are matched by name against existing rows in the category data source. Names
  with no match are never created in Notion; the row saves with an empty `Category` and the save
  result returns `unmatchedCategories` so the workspace can name them in the save notice.

## Important Files

- `components/StatementWorkspace.tsx` - client UI state, upload, row editing, and save flow.
- `lib/months.ts` - month determination, filing, reassignment, listing, and legacy draft
  migration as pure transforms; `lib/months.test.ts` covers it.
- `lib/monthsStore.ts` - client-side month store: load, debounced writes, unload flush.
- `lib/monthStore.ts` - server-side month document persistence under `./data/months/`.
- `app/api/months/route.ts` and `app/api/months/[month]/route.ts` - month list and
  read/write/delete of one month document.
- `app/api/categories/route.ts` - category catalog read and enabled/disabled updates.
- `app/api/categories/import/route.ts` - Notion category import route.
- `app/api/extract/route.ts` - upload validation, artifact persistence, OpenRouter extraction, fallback application.
- `app/api/notion/save/route.ts` - Notion save route.
- `lib/categoryStore.ts` - local category catalog persistence.
- `lib/openrouter.ts` - OpenRouter request, prompt, response parsing, debug payload.
- `lib/fallbackExtractor.ts` - deterministic PDF text fallback.
- `lib/artifacts.ts` - `/tmp` artifact persistence.
- `lib/notion.ts` - Notion data source schema and page creation.
- `lib/extractionSchema.ts` - structured JSON schema used with OpenRouter.

## Commands

Install:

```bash
bun install
```

Run dev server:

```bash
BUN_INSTALL=/tmp/bun-install BUN_TMPDIR=/tmp/bun-tmp bun run dev --hostname 127.0.0.1
```

Verify:

```bash
bun run typecheck
bun run lint
BUN_INSTALL=/tmp/bun-install BUN_TMPDIR=/tmp/bun-tmp bun run build
```

Replay a saved statement file through the live extraction route:

```bash
curl -s -o /tmp/statement-ledger-route-replay.json \
  -F statementFile=@/tmp/statement-ledger/uploads/<upload-id>/<file>.pdf \
  http://127.0.0.1:3000/api/extract
```

Summarize replay output:

```bash
jq '{rows: (.extraction.expenses | length), total: (.extraction.expenses | map(.amount) | add), artifact: .artifact.dir}' /tmp/statement-ledger-route-replay.json
```

## Known Proven Case

Saved artifact:

```text
/tmp/statement-ledger/uploads/2026-06-12T07-14-39-765Z-d666dbf1/
```

The OpenRouter response extracted American Express metadata but returned `expenses: []`. The PDF text contained `New Charges Details`; the fallback parser found 41 rows totaling `$2,614.97`, matching `Total New Charges`.

Successful replay artifact:

```text
/tmp/statement-ledger/uploads/2026-06-12T07-22-09-272Z-b60e64de/
```

## Git Checkpoints

- `f7f2eb9` - initial app baseline.
- `1cde5d0` - persisted upload/extraction artifacts.
- `7257a4e` - fallback parser for statement charges.
