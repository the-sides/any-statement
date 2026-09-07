# Agent Context

This project lives at:

```text
/home/jake/repos/any-statement
```

It is a Bun + Next.js app named Statement Ledger. Uploaded statement files are saved locally so
agents can inspect and replay the exact statements.

It is deployed at `https://any-statement.vercel.app` (Vercel project
`thesides-projects/any-statement`, personal account — see `Vercel Account`), so the user can
upload statements from a phone. The published repo is `github.com/the-sides/any-statement`
(renamed from `any-budget`; the old URL still redirects). Vercel's GitHub link keys on the
numeric repo id, so pushing `main` still deploys to production.
Access is limited to the addresses in `STATEMENT_LEDGER_ALLOWED_EMAILS`.

The ledger is multi-tenant. Every row belongs to one WorkOS user, and `user_id` is part of every
primary key, so an unscoped query fails on uniqueness rather than quietly reading someone else's
statements. The owner of the pre-existing data is `user_01KZ07DZ7ZB8MDNWVA4P3ZMZQB`
(jacob.r.sides@gmail.com, GitHub sign-in, WorkOS project `Budget` / environment `Production`).
OpenRouter is the only shared credential; Notion is per-user.

## Rules For Future Agents

- Use Bun, not npm or pnpm.
- Preserve `.env.local`; it contains real local API keys and is ignored by git.
- Do not print API keys or commit secrets.
- Every store function takes a `userId`. If you add one that does not, you have added a
  cross-tenant read. Routes get it from `requireUserId()` in `lib/currentUser.ts`.
- Commit working checkpoints after meaningful changes.
- Inspect real artifacts under `/tmp/statement-ledger/uploads/` before hypothesizing about extraction bugs.
- If the user reports an extraction issue, start from `upload.json`, `extraction.json`, `fallback.json`, and `final-extraction.json`.
- For Next.js work, initialize Next DevTools and use official Next docs through MCP before relying on framework knowledge.
- `next-env.d.ts` is generated and untracked on purpose. `next dev` writes an import of
  `.next/dev/types/routes.d.ts` and `next build` writes `.next/types/routes.d.ts`, so a
  tracked copy flips on every switch between the two. `tsconfig.json` already includes both
  directories directly, and `bun run typecheck` passes with the file absent. Do not re-add it.
- When verifying the UI locally on this machine, Playwright Chrome may be missing. System Chromium is available at `/usr/bin/chromium`.
- Localhost and browser commands may need escalation because the sandbox can block server binds and host networking.
- Vercel commands here run against the personal account, which is now the CLI default. See `Vercel Account`.

## Vercel Account

The Vercel CLI stores one login per global config directory. **The default directory
(`~/.local/share/com.vercel.cli`) holds the personal `the-sides` account** — this project
deploys there, so plain `vercel` commands are already correct and need no `-Q`:

```bash
vercel whoami          # -> the-sides
vercel deploy
```

The `jacob-mergerai` **work** account lives in a separate directory:

```text
~/.vercel-work
```

Select it with `-Q` (`--global-config`) on every command; there is no persistent
"current account" to switch:

```bash
vercel -Q ~/.vercel-work whoami          # -> jacob-mergerai
vercel -Q ~/.vercel-work deploy --scope merger-ai
```

Personal scope is `thesides-projects`; work scope is `merger-ai`. When running
non-interactively the CLI applies no default scope, so pass `--scope` explicitly.

Re-authenticate a store with `vercel login` (personal) or `vercel login -Q ~/.vercel-work`
(work). This is interactive and opens a browser, so the user has to run it.

Never print or commit the contents of either directory; `auth.json` holds a live token.

> Swapped on 2026-08-02. Personal is the default because most new projects are personal;
> before that date the default held the work account and personal lived in
> `~/.vercel-personal`, which no longer exists. Older notes referencing
> `-Q ~/.vercel-personal` are stale.

## Vercel Env Pull Hazard

`vercel env pull` **overwrites `.env.local` wholesale**, dropping any variable not stored on the
Vercel project. `vercel integration add` runs an env pull by default and has already destroyed
the local `OPENROUTER_*` and `NOTION_*` keys once. Notion keys now live in Postgres, so an env
pull can no longer lose them, but `STATEMENT_LEDGER_SECRET_KEY` is stored on the Vercel project
precisely so a pull reproduces it.

- Always pass `--no-env-pull` to `vercel integration add`.
- Back the file up before any env pull: `cp .env.local .env.local.bak`.
- The durable fix is to store every secret on the Vercel project too, so a pull reproduces a
  complete file instead of a partial one.

## Local Sign-In (WorkOS)

Localhost and production share one WorkOS environment (`Budget` / `Production`,
`environment_01KZ04MTVKKZQMHWJB0A4GWVT1`) and therefore one user pool. `.env.local` and the
Vercel project carry the same `WORKOS_CLIENT_ID`, so signing in at `localhost:3000` lands on
the same `user_01KZ07DZ7ZB8MDNWVA4P3ZMZQB` that owns the deployed data. There is no second
app, no second pool, and nothing to keep in sync.

Two things must be true for local sign-in to work, and neither is inferred:

- `.env.local` sets `NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback`. Without
  it AuthKit sends an empty `redirect_uri` and WorkOS answers with its
  `redirect-uri-invalid` error page.
- `http://localhost:3000/callback` is registered as a redirect URI on the WorkOS environment.
  It matches exactly - no trailing slash.

The `workos` CLI (`bun add -g workos`) reads that config but **cannot write it**:
`workos authkit redirect-uris set` validates under `--dry-run` and then fails with
`{"error":{"code":"graphql_error"}}` for any payload, including re-setting the existing list.
`workos authkit cors set` writes fine, so it is that one mutation, not auth or permissions.
Add redirect URIs in the WorkOS Dashboard.

### Ambient env beats `.env.local`

Next never overrides a variable already present in `process.env`, so a stale value inherited
from the launching process silently wins and no edit to `.env.local` has any effect. This cost
an hour once: the harness broker held `STATEMENT_LEDGER_ALLOWED_EMAILS` from an older read of
`.env.local`, every supervised `bun run dev` inherited it, and sign-in kept returning
`403 This account is not allowed to access this ledger.` while the file on disk was correct.

Confirm what the server actually sees before editing anything else:

```bash
tr '\0' '\n' < /proc/<dev-pid>/environ | grep STATEMENT_LEDGER_ALLOWED_EMAILS
```

If a stale value is inherited, drop it at launch rather than editing the file again:

```bash
env -u STATEMENT_LEDGER_ALLOWED_EMAILS bun run dev --hostname 127.0.0.1 --port 3000
```

## Current Behavior

- `/` renders the upload/review/save workspace, scoped to one month at a time.
- An uploaded statement is filed into the calendar month covering most of its period,
  falling back to its row dates, and the workspace switches to that month. There is no
  save-month action; months are derived. See `specs/month-scoped-statements.md`.
- Month documents live in Postgres (Neon), in relational `months` / `statements` / `expenses`
  tables defined by the migrations in `lib/migrations/`, keyed by `(user_id, month)`. Writes are whole-month and transactional, matching the
  file-per-month semantics the app was built around. `./data/months/<YYYY-MM>.json` is now
  only a legacy import source; see `scripts/import-local-months.ts`.
- The workspace edits the active month optimistically and flushes to the server on a
  ~500ms debounce, forced on page unload. The AI categorization notes are a per-user row in
  the `user_settings` Postgres table, written the same way; undo history and the
  app-category preference are still browser localStorage and stay global.
- The cash flow panel keeps its Sankey and pie (`Cash flow` / `Where it went`, with the
  Flow/Pie toggle and the graph zoom controls); only the manual input/output editor was
  removed. `summarizeCashFlow` therefore drives both the graphs and the expense chat's
  cash-flow context, but nothing in the UI writes `cashFlowEntries` any more: inputs come
  from recognized income and outputs from the month's category spend, so a stored entry stays
  at whatever the `user_settings` row already holds.
- The workspace has a light/dark/system theme toggle in the brand lockup. The preference is
  stored in `localStorage` under `statement-ledger:theme` and defaults to the system setting.
  A small inline script in `app/layout.tsx` resolves it onto `<html data-theme>` before first
  paint, so there is no flash of the light theme. Every colour in `app/globals.css` comes from
  a token defined for both themes; a raw hex in a rule breaks dark mode silently.
- `/api/extract` accepts `statementFile` as multipart form data, with legacy `statementPdf` replays still accepted.
- `/api/extract` saves the original PDF or CSV and extraction artifacts to `/tmp/statement-ledger/uploads/<upload-id>/`.
- OpenRouter is the primary extraction path.
- Categories are app-managed, persisted one row per user in the `category_catalog` Postgres table,
  and disabled categories remain in the catalog. Catalog *reads* fall back to the built-in defaults
  if the database is unreachable, so a database outage cannot break extraction or the Notion save
  that only resolves category names; writes still surface their errors.
- When the user's connection has a category data source ID, the first catalog load imports the
  Notion categories and stores `importedAt`. Later loads reuse the stored catalog, so categories
  turned off by the reviewer are never resurrected; `Import` re-runs it on demand. If the
  import fails, the catalog falls back to built-ins and retries on the next load.
- Built-in (`app`) categories are hidden while at least one enabled `notion` category
  exists. Turning off every Notion category, or ticking the `APP categories` checkbox,
  brings the built-ins back. `lib/categories.ts` owns that rule and both the workspace and
  `/api/extract` use it.
- Reviewer categorization notes are stored per user in `user_settings`, submitted with
  `/api/extract`, and included in OpenRouter prompt/debug artifacts.
- CSV uploads are extracted through OpenRouter from uploaded CSV text.
- The file picker accepts multiple files. The workspace extracts them one
  request at a time (per-file artifacts and failures; the 12 MB check skips
  oversized files with a notice), and statements whose month cannot be
  determined queue up in the Pick a month panel instead of overwriting each
  other. The `/api/extract` contract is unchanged: one statement per request.
- Payment rows, `AUTO PAYMENT REVERSAL` rows, and transfers between the user's
  own accounts (for example `USAA FUNDS TRANSFER CR/DB` between checking and
  savings) are excluded. A reversal is not new spending: its charges were
  already ledgered as expenses in the month they posted. An own-account
  transfer is neither spending nor income, on either side of the move.
  `lib/openrouter.ts` prompts exclude them and `lib/internalTransfers.ts` is
  the deterministic backstop applied in `lib/normalize.ts` to expenses and
  incomes (the model once returned savings deposits as income despite its own
  notes admitting they were internal transfers).
- Expenses carry `reimbursedAmount` (default 0; net = amount − reimbursedAmount,
  derived, never stored — partial reimbursements are just a smaller value). The
  review table edits it per row, shows `net $X` under the gross amount plus a
  Net stat, and the Notion save writes a `Reimbursed` number property
  (`lib/migrations/004_expense_reimbursements.sql`).
- Bank statements also carry income: extraction returns an `incomes` array
  (payroll, interest, other deposits; never own-account transfers) alongside
  expenses, stored in the `incomes` table (`lib/migrations/005_income_rows.sql`)
  and reviewed in the Income drawer. Notion save still covers expenses only.
  The drawer is absolutely positioned inside `.workspace`, parked off its left edge with only
  a 32px vertical `Income` tab showing in the reserved `padding-left` lane, and slides over
  the transaction table on hover or `:focus-within`. `overflow: hidden` on `.workspace` is
  what hides the parked panel: remove it and the income table bleeds over the side panel.
  Below 980px the drawer reverts to a plain stacked panel and the tab is hidden.
- If OpenRouter returns PDF statement metadata but zero rows, `lib/fallbackExtractor.ts` parses
  Amex-style `New Charges Details` tables. PDF text now comes from `unpdf` in-process, not the
  `pdftotext` binary, so it works on hosts without Poppler. `lib/pdfText.ts` reconstructs a
  `pdftotext -layout`-style character grid from text coordinates, because that parser matches on
  multi-space column gaps. Do not replace it with plain text concatenation: the gaps disappear
  and the fallback silently returns zero rows.
- `lib/pdfText.ts` also feeds the *primary* path — `lib/openrouter.ts` sends a cheap text prompt
  instead of the PDF file when the extracted text looks usable, so breaking it degrades normal
  extraction too, not just the fallback.
- `/api/notion/save` saves selected reviewed rows to the signed-in user's Notion workspace.
- `/api/notion/connection` reads, saves, and removes that connection. The integration token is
  encrypted with `STATEMENT_LEDGER_SECRET_KEY` (AES-256-GCM) and never sent back to the browser.
  There is no `NOTION_*` environment fallback: one would silently save a stranger's expenses into
  the deployment owner's Notion.
- `lib/notion.ts` reconciles missing optional Notion properties before creating pages and writes
  the existing `Category` relation. It titles each row with the merchant (or description) and never
  repeats the date there, and it never writes the legacy `Expense Category` select.
- Category relations are matched by name against existing rows in the category data source. Names
  with no match are never created in Notion; the row saves with an empty `Category` and the save
  result returns `unmatchedCategories` so the workspace can name them in the save notice.

## Important Files

- `components/StatementWorkspace.tsx` - client UI state, upload, row editing, and save flow.
- `lib/theme.ts` - theme preference storage, resolution, and the pre-paint init script;
  `components/ThemeToggle.tsx` is the segmented light/dark/system control.
- `lib/months.ts` - month determination, filing, reassignment, listing, and legacy draft
  migration as pure transforms; `lib/months.test.ts` covers it.
- `lib/monthsClientStore.ts` - client-side month store: load, debounced writes, unload flush.
- `lib/monthStore.ts` - server-side month document persistence in Postgres.
- `lib/db.ts` - lazy Neon client (no Proxy wrapper) plus numeric/text column coercion.
- `lib/migrations/*.sql` - schema history, applied in filename order and tracked in
  `schema_migrations`.
- `lib/currentUser.ts` - `requireUserId()`, the tenant key every store call needs.
- `lib/notionConnection.ts` - per-user Notion credentials.
- `lib/secrets.ts` - AES-256-GCM encryption for stored credentials.
- `lib/apiErrors.ts` - shared 401/503 responses for missing sessions and unreadable credentials.
- `proxy.ts` - WorkOS AuthKit gate over every route except the sign-in flow and static assets.
- `app/callback/route.ts` - AuthKit callback. `handleAuth`'s default answer to a missing PKCE
  cookie, a missing `code`/`state`, or a state mismatch is a bare JSON 500, which strands the
  user with no way back into the flow; those three codes are recoverable, so `onError` restarts
  sign-in instead. A 120s `HttpOnly` cookie bounds it to one retry, because `/sign-in` bounces
  through WorkOS and a query-string marker would not survive the round trip. Any other failure
  is a real fault and still surfaces.
- `lib/accessControl.ts` - email allowlist decision. A WorkOS session only proves *someone*
  signed in; without the allowlist anyone able to sign up would reach the ledger. Unset
  `STATEMENT_LEDGER_ALLOWED_EMAILS` denies everyone rather than falling open.
- `app/api/months/route.ts` and `app/api/months/[month]/route.ts` - month list and
  read/write/delete of one month document.
- `app/api/categories/route.ts` - category catalog read and enabled/disabled updates.
- `app/api/categories/import/route.ts` - Notion category import route.
- `app/api/extract/route.ts` - upload validation, artifact persistence, OpenRouter extraction, fallback application.
- `app/api/notion/save/route.ts` - Notion save route.
- `lib/categoryStore.ts` - category catalog persistence in Postgres.
- `app/api/settings/route.ts` - per-user settings read/write (cash flow entries, AI notes).
- `lib/userSettings.ts` - shared settings shape, defaults, and notes length limit;
  `lib/userSettingsStore.ts` is the Postgres side and `lib/userSettingsClientStore.ts` the
  browser store. Unlike the category catalog, a settings *read* failure is surfaced rather
  than degraded to defaults: the browser writes the whole row back, so answering an outage
  with an empty plan would let the next edit overwrite the real one.
- `scripts/migrate.ts` - applies pending migrations, then claims rows with an empty `user_id` for
  `STATEMENT_LEDGER_LEGACY_USER_ID`; idempotent.
- `scripts/generate-secret-key.ts` - prints a `STATEMENT_LEDGER_SECRET_KEY`.
- `scripts/import-notion-connection.ts` - one-time move of `NOTION_*` env vars into a user's row.
- `scripts/import-local-months.ts` - imports legacy `data/months/*.json` into Postgres.
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

Apply pending migrations (idempotent, needs `DATABASE_URL`):

```bash
bun run scripts/migrate.ts
```

Run the tests (`bunfig.toml` preloads a `server-only` stub so route modules import cleanly):

```bash
bun test
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
