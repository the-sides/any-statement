# Agent Context

This project lives at:

```text
/home/jake/repos/any-statement
```

It is a Bun + Next.js app named Any Statement (it was called Statement Ledger until 2026-09-16; the `statement-ledger:*` localStorage keys and the `STATEMENT_LEDGER_*` environment variables keep the old prefix on purpose, since renaming them would drop every stored preference and break the Vercel project's env). Uploaded statement files are saved locally so
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
- To work on several branches at once, use `bun run wt` (`scripts/worktree.ts`), not a bare
  `git worktree add`. See `Parallel Worktrees` for what is isolated and what is shared.

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

- `.env.local` sets `NEXT_PUBLIC_WORKOS_REDIRECT_URI` to the port the server actually listens
  on, `http://localhost:3000/callback` in the primary checkout. Without it AuthKit sends an
  empty `redirect_uri` and WorkOS answers with its `redirect-uri-invalid` error page.
- That exact URI is registered on the WorkOS environment. `http://localhost:3000/callback`
  through `http://localhost:3005/callback` are registered (added 2026-09-07), so a worktree on
  3001-3005 signs in on its own port; `bun run wt` writes the matching value into the
  worktree's copied `.env.local`. Matches are exact - no trailing slash. A worktree above 3005
  has no registered callback and must borrow the primary checkout's.

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

## Auth-Less Demo Mode

A local-only demo build so a **headless browser can reach the UI without signing in**. A
browser driver cannot complete AuthKit's redirect flow — WorkOS needs a real credential and
an interactive consent — so without this the only page a driver can reach is the sign-in
bounce.

`lib/demoMode.ts` owns the flag and is read in exactly two places, the same two that own auth:

- `proxy.ts` returns `NextResponse.next()` before calling `authkit`, so no session is
  required. It skips authkit entirely rather than tolerating a missing session, because
  `authkit()` still 503s on a missing `WORKOS_API_KEY`.
- `lib/currentUser.ts` `getCurrentUserId()` returns `DEMO_USER_ID`, so every store call below
  it stays tenant-scoped exactly as in the authenticated build.

It is a **tenant swap, not an opened door onto the real data**: `user_id` is part of every
primary key, so the demo tenant (`user_demo_headless`) can only see rows seeded for it, and
the owner's statements remain unreachable.

**Never add `STATEMENT_LEDGER_DEMO_MODE` to the Vercel project.** Turning the gate off also
drops the `STATEMENT_LEDGER_ALLOWED_EMAILS` allowlist, and a deployment URL is public while
being backed by the same `DATABASE_URL` and the shared OpenRouter key. `isDemoMode()`
therefore refuses whenever `process.env.VERCEL` is set — any Vercel build or runtime, not
just production. Keying on `VERCEL_ENV === "production"` alone would fail open twice: a
preview build keeps `VERCEL_ENV=preview` when promoted to the production alias, and a host
exposing no Vercel system variables leaves it undefined. `## Vercel Env Pull Hazard` below is
why a stray copy onto the project is a realistic accident. `lib/demoMode.test.ts` pins the
guard, including the blank/`0`/`VERCEL` cases.

`### Ambient env beats .env.local` applies to this flag more than any other: a supervised
`bun run dev` inherits whatever the launching process held, so a stale `1` turns the auth gate
off and swaps the tenant in a checkout whose `.env.local` never mentions it — the primary
checkout then renders the empty demo ledger and looks like data loss. Confirm with
`tr '\0' '\n' < /proc/<dev-pid>/environ | grep STATEMENT_LEDGER_DEMO_MODE`, and drop it at
launch with `env -u STATEMENT_LEDGER_DEMO_MODE bun run dev` rather than editing the file.

```bash
STATEMENT_LEDGER_DEMO_MODE=1 bun run scripts/seed-demo.ts   # idempotent
bun run dev                                                 # or `bun run wt dev <name>`
```

`scripts/seed-demo.ts` writes three fixed months (2026-06..2026-08) — 2 statements and 21
expenses each, plus incomes. Nothing is random and nothing is copied from the real tenant, so
a screenshot diff is stable across runs. The months are shaped to cover the states the UI
renders differently: saved months (June/July), an overspent month (August, where the Sankey
riser pours in from the top instead of climbing out), and a fully reimbursed row so `NET`
differs from `AMOUNT`. Its header comment lists the states the seed **cannot** reach (the
empty state, the client-only `Pick a month` panel, every upload path, Notion connected,
disabled/notion categories, partial reimbursement, unused enum values, layout stress,
localStorage undo); read it before assuming a headless suite has full coverage.

What is still real and therefore *not* mocked: Postgres (the demo tenant lives in the shared
`DATABASE_URL`, so its rows sit beside the owner's and share migrations), OpenRouter
extraction, and Notion (unconnected for the demo user, so the Notion panel shows
`Not connected`). There is no purge flag; remove the tenant with
`delete from ... where user_id = 'user_demo_headless'`.

## Current Behavior

- `/` renders the upload/review/save workspace, scoped to one month at a time.
- `/documents` is the document manager: every uploaded statement with the rows it produced,
  its totals, and the months it covers. It is read-only - the review table on `/` owns the
  optimistic write path and the undo history - so a month chip links to `/?month=<YYYY-MM>`
  instead of editing in place. The header's `FileStack` button (beside `Extract`) is the way
  in, and the page's back arrow the way out.
  - A multi-month export is *folded back into one card*. Filing splits it into one statement
    per month with id `<id>-<YYYY-MM>` (see `planStatementFiling`), which is storage, not
    what the reviewer uploaded; `documentIdOf` strips that suffix, but only when it names the
    month the segment was filed into, so an id merely ending in digits is left alone. A card
    with several segments also lists a per-month table (period, rows, spend, income) and says
    how many months it was split across.
  - Expanding a card lists that document's expense rows and, when it has any, its income
    rows. Totals are gross, net (gross minus reimbursements), and income.
  - `/?month=<YYYY-MM>` is honoured by `lib/monthsClientStore.ts` `initialize()`, which opens
    that month instead of the most recent one. An unfiled month in the link is ignored rather
    than opening a blank workspace.
- **Every destination is a route, and the nav is the only way between them.**
  `components/AppNav.tsx` owns the list: `WORKSPACE_SECTIONS` maps each `SectionId` to its
  label, its header title, its icon and its `href` - `/` (review), `/cash-flow`, `/income`,
  `/chat`, `/all-months`, `/setup`, `/documents` (Files). Each `app/<section>/page.tsx` is
  four lines: `<StatementWorkspace viewer={await getViewer()} section="…" />`, so the shell
  (header bar, nav, notices, the pick-a-month prompt) is identical on all of them and the
  section prop picks the one branch of content that renders.
  - Routes, not state: the back button, a bookmark, a middle-click and a deep link all
    work on a section now. The previous model kept the active section in localStorage
    (`statement-ledger:section`), which meant Back left the app and "the income table" had
    no URL.
  - `AppNav` is mounted by `StatementWorkspace` *and* `DocumentManager`, marks the active
    item from `usePathname()`, and reads its counts straight from the month store
    (`useSyncExternalStore`) rather than from props - which is what lets `/documents` show
    the same nav without owning any month state.
  - `.app-shell` is a grid of `header / nav / content`. `.app-nav` is **the same markup in
    both layouts**: a sticky 196px column of destinations beside the content above 900px,
    and a fixed bottom tab bar (icon over label, seven thumb targets, `env(safe-area-inset-
    bottom)`) below it. `.docs-shell` keeps the nav lane; collapsing it is what used to
    make the sidebar vanish on Files and leave a back arrow as the only way out.
  - This replaced a single scrolling page whose other controls appeared on their own: a
    rail that faded in from 20px of the left edge on pointer proximity (plus a pin that
    turned it into a layout lane) and two drawers parked off the right edge of the table
    behind vertical tabs, arbitrated by a hover/`temporary`/`pinned` hold model and a
    measured lane that rewrote their `top` on every scroll frame. All of that machinery is
    gone. On a phone it was unusable - the tabs sat off-screen and the page was one 4000px
    column - which is what the bottom bar fixes.
- `.app-header` is a compact three-column grid: the brand lockup (mark, `Any Statement`,
  and the page's title), the month stepper (`.header-month`) centred on the page, and the
  upload lane (file picker, `Extract`, theme, account). It is `position: sticky` and stays
  put; the month control used to translate itself down the page on scroll and drifted over
  the table. Two controls that used to sit in it permanently are now one button each:
  - `components/ThemeToggle.tsx` is a single `.theme-button` showing the current preference
    and cycling system -> light -> dark, not a three-way segmented control.
  - `components/AuthStatus.tsx` is a `.user-button` opening a small menu with the address
    and `Sign out` (still the `signOutAction` server action), closed by an outside click or
    Escape. As a permanent chip the address ran the lockup into the month stepper on a
    laptop and cost a whole row on a phone.
  Under 1100px the month control drops to its own centred row; under 680px the header stops
  being sticky (three stacked rows of chrome is a third of a phone screen, and the nav that
  matters is already fixed to the bottom).
- **The review table is seven columns wide, not nine.** Date leads the row, `Merchant`
  carries the merchant name with the statement chip and the raw statement description on a
  second quieter line, then category, amount (with the reimbursed editor) and notes. That
  folded three columns into one and took the table's `min-width` from 1600px to 860px, so a
  row reads on one screen; row padding, control height and font size all came down with it.
  `TABLE_SORT_COLUMNS` lost its `statement` and `description` keys with those columns, and
  `formatStatementShortLabel` now returns institution initials plus the account's last four
  (`AE 1007`) instead of the first five characters of a masked account, which were `••••`.
- **Phones get cards, not a table.** Below 760px `app/globals.css` turns each `<tr>` into a
  card and each `<td>` into a labelled line, driven by the `data-label` every cell carries -
  same markup, no second render path. The reimbursed line drops its hover-only fade there,
  because a touch screen has no hover. The income table follows the same rule.
- An uploaded statement is filed into the calendar month covering most of its period,
  falling back to its row dates, and the workspace switches to that month. There is no
  save-month action; months are derived. See `specs/month-scoped-statements.md`.
- A statement whose period runs longer than one billing cycle (`SINGLE_CYCLE_DAYS`, 45
  days in `lib/months.ts`) is **split per calendar month** by row date:
  `planStatementFiling` returns one segment per month, each with its own statement id
  (`<id>-<YYYY-MM>`), its rows re-pointed at it, and its period narrowed to that month.
  The workspace files every segment and lands on the busiest one. A bank export covering
  January to May used to file all five months' rows under March, which is what this fixes.
  Rows carrying no date at all fall to that busiest month rather than being dropped.
  A 30-day cycle straddling two months is **not** split - that is what keeps a Jun 12 -
  Jul 11 card cycle filed beside the calendar-month bank statement, which the spec's
  stories 3 and 4 require. Distinct per-month ids matter: filing a statement into a month
  that already holds the same id replaces it and drops its rows.
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
- `All months` is its own route (`/all-months`), not a toggle on the month stepper, and it
  renders `AllMonthsView` in place of the review table. The
  view has two modes (`OverviewMode`, a segmented toggle in its toolbar): `Compare`, the
  default, and `Year`. Clicking a month's name selects that month and routes to `/`, and the
  expense chat's `view.scope` is `all` exactly while this route is open.
  - `Compare` is every filed month's cash flow as its own Sankey, plus totals
    across months. The row scrolls horizontally and each card's width *is* the
    zoom level: `MONTH_CARD_WIDTH` (1040px) times the current stop, so 100%
    renders one month at roughly the size the single-month panel does and the
    other months are reached by scrolling sideways. A card's only chrome is the
    month name, which opens that month; the saved/overspent amount is the riser
    label inside the graph, so a heading would repeat it.
  - `Year` is one Sankey over every transaction in one calendar year — the same
    graph the month panel draws, with `zoom` meaning what it means there. The
    year summary is folded from the year's *rows*, not from its month summaries,
    so a category is one ribbon for the year instead of twelve to add up by eye.
    The year defaults to the current calendar year and falls back to the most
    recent filed year, so it never opens blank; a picker appears only when more
    than one year is filed. The stats strip switches to that year's months,
    income, spend, and saved.
  The zoom stops live in `lib/graphZoom.ts` and are shared with the single-month
  graph's zoom controls, so 100% means the same thing everywhere. Data comes
  from `/api/months/overview`, which folds all month documents through
  `summarizeCashFlow` per month *and* per year (`lib/allMonths.ts`); the view
  flushes pending month writes first so the active month's debounced edits are
  included.
  Under the graphs the overview lists the rows behind them: `timeline.transactions`
  is every filed month's expenses flattened, newest first (undated rows last), and
  the table is scoped to the picked year in `Year` and to the whole ledger in
  `Compare`. It is read-only on purpose — the review table owns the optimistic
  write path and the undo history — so the Month cell is a button that opens the
  row's month instead.
  Clicking a category ribbon or its label filters that table to the category, in
  either mode and across every month. `CashFlowSankey` takes `selectedCategory`
  plus `onSelectCategory`; only allocations whose `source` is `category` are
  clickable, because a manual output has no rows behind it and could only filter
  to nothing. Picking one dims every other ribbon, clicking it again clears it, and
  so does the chip in the table heading. A filter that matches nothing in the
  current scope (switch years while one is set) still renders the heading and its
  chip, so there is always a way back.
- In every Sankey, savings and overspending are not plain output nodes:
  `components/CashFlowSankey.tsx` draws the remainder as a riser ribbon that
  peels off the *top edge* of the trunk (saved at the output end, overspent at
  the input end), turns vertical, and fades out through the top of the frame, so
  saving visibly climbs off the page and overspending pours in from above. The
  remainder takes the top slot at its end of the trunk on purpose: from the
  bottom it had to climb across every category ribbon on the way out.
  `RISER_HEADROOM` is the strip above the page it climbs through, added to the
  viewBox only when a remainder exists, so a break-even month pays no empty
  space. The trunk is scaled to the larger of income/spend so both packed ends
  plus the remainder slot fill it exactly. `fit` + `idPrefix` props exist because
  the all-months row renders many of these on one page.
- The trunk bar is *spending*, not income: it is labelled `Spending` with the month's
  allocated total (a percentage of income, so an overspent month reads over 100%), and
  the column heading that used to say `Income` above it is gone. A saved month cuts the
  bar short by the saved slot at the top, so the bar's height is literally what was
  spent; an overspent month runs the full trunk and fades from `SPEND_COLOR` into
  `OVERSPENT_COLOR` across the slot earnings did not cover, matching the coral riser
  pouring in above it. The fill is an attribute, not a CSS rule: a class-based `fill`
  would win over the gradient reference and silently paint the overspend green.
- Colour carries the meaning, so the three tones are named constants at the top of
  `CashFlowSankey.tsx`: `SPEND_COLOR` (`--cobalt`) for the trunk and the ends of every
  ribbon meeting it, `SAVED_COLOR` (`--positive`) for the saved riser only, and
  `OVERSPENT_COLOR` (`--coral`). Green means kept, not "money"; painting the trunk green
  again would make saving invisible. The saved slot gets its own green segment of the
  trunk column above the blue spending segment, drawn after the ribbons because the riser
  it sits under is translucent, so the column still adds up to what came in.
- The workspace has a light/dark/system theme toggle at the top right of the header, after
  `Extract`. The preference is
  stored in `localStorage` under `statement-ledger:theme` and defaults to the system setting.
  A small inline script in `app/layout.tsx` resolves it onto `<html data-theme>` before first
  paint, so there is no flash of the light theme. Every colour in `app/globals.css` comes from
  a token defined for both themes; a raw hex in a rule breaks dark mode silently.
- Auth state is visible in both headers (`/` and `/documents`): `components/AuthStatus.tsx`
  renders a chip in the brand lockup showing the signed-in address with a `Sign out` button,
  `Demo tenant` in the demo build (no button - there is no session to end), or a `Sign in`
  link when no session exists. Sign-out is a **server action** (`app/authActions.ts`), not a
  `GET /sign-out` route: a GET would be fired by any prefetch and drop the session, and
  `redirect()` inside a POST route handler answers 307, which replays the POST against the
  WorkOS logout URL. The viewer fact comes from `lib/viewer.ts` `getViewer()` on the server
  page, which is why `/` and `/documents` are now server-rendered per request rather than
  prerendered. It lives in the *left* lockup because `.header-month` is centred on the page
  and already runs within ~50px of `.header-upload`, so anything added on the right lands
  underneath it; the chip then sheds the address at 1100px and the button's label at 980px,
  and `.brand-title` truncates so the chip never spills across the upload controls.
- `/api/extract` accepts `statementFile` as multipart form data, with legacy `statementPdf` replays still accepted.
- `/api/extract` saves the original PDF or CSV and extraction artifacts to `/tmp/statement-ledger/uploads/<upload-id>/`.
- OpenRouter is the primary extraction path.
- Categories are app-managed, persisted one row per user in the `category_catalog` Postgres table,
  and disabled categories remain in the catalog. Catalog *reads* fall back to the built-in defaults
  if the database is unreachable, so a database outage cannot break extraction or the Notion save
  that only resolves category names; writes still surface their errors.
- The built-in defaults **seed** a user's first catalog and nothing more. A stored catalog is
  read back as-is, never re-merged with the defaults, because merging would resurrect every
  default the reviewer deleted. Adding a default in code therefore reaches existing users only
  through a manual add.
- When the user's connection has a category data source ID, the first catalog load imports the
  Notion categories and stores `importedAt`. Later loads reuse the stored catalog, so categories
  turned off by the reviewer are never resurrected; `Import` re-runs it on demand. If the
  import fails, the catalog falls back to built-ins and retries on the next load.
- A category's `source` is `app` (built-in default), `custom` (the reviewer created it), or
  `notion` (imported). Every source can be turned off or removed. `app` and `custom` can also
  be renamed and re-described (`isEditableCategory`); `notion` cannot, because Notion owns
  those names and the next `Import` would overwrite the edit. A removed Notion category comes
  back on the next `Import`; a removed built-in stays gone.
- Renaming carries the expense rows with it. `/api/categories` PATCH calls
  `renameStoredExpenseCategory` (every stored month, one `update`) and the workspace flushes
  pending month writes *first*, then renames the in-memory active month, so a debounced flush
  cannot write the old name back. Deleting does not touch rows: they keep the old name, which
  `categoryOptionsForItem` still offers so the select is not silently rewritten.
- Only built-in (`app`) categories are hidden while at least one enabled `notion` category
  exists. Turning off every Notion category, or ticking the `APP categories` checkbox,
  brings the built-ins back. Custom categories are never hidden that way - a reviewer's own
  category disappearing because Notion is connected would be a bug. `lib/categories.ts` owns
  that rule and both the workspace and `/api/extract` use it.
- Custom category names have no Notion counterpart, so the Notion save leaves their rows'
  `Category` relation empty and reports the name in `unmatchedCategories`, the same as any
  other unmatched name.
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
  reimbursed editor lives *inside* the Amount cell rather than in a column of
  its own: a second line under the gross amount holds a compact `reimb` input
  and, once a reimbursement exists, `net $X`. That line always reserves its
  height and only fades in on row hover or `:focus-within`, so revealing it
  never reflows the table; a row that already carries a reimbursement keeps it
  visible. There is still a Net stat above the table, and the Notion save
  writes a `Reimbursed` number property
  (`lib/migrations/004_expense_reimbursements.sql`).
- Bank statements also carry income: extraction returns an `incomes` array
  (payroll, interest, other deposits; never own-account transfers) alongside
  expenses, stored in the `incomes` table (`lib/migrations/005_income_rows.sql`)
  and reviewed in the Income section. Notion save still covers expenses only.
- Income and Expense chat are **their own nav sections** (`section === "income"` /
  `"chat"`), so both are ordinary panels that own the content area while they are open.
  They used to be drawers parked off the right edge of the review table behind vertical
  tabs; that is gone, along with `data-hold`, `DRAWER_IDS`, the measured tab lane and the
  `pointer-events` juggling it needed. A panel no longer slides over the table on cursor
  drift, and on a phone both are a tap on the bottom bar instead of a tab off-screen.
  - Expense chat can also *propose row edits*. `/api/expense-chat` loads every
    filed month itself (`listStoredMonthDocuments`), so a question sees the
    whole ledger, not just the rows on screen; the request carries only the
    view pointer (`month` or `all`, plus the active month) so the model can ask
    a follow-up when a request is ambiguous about scope. The reply comes back
    as strict JSON (`expense_chat_reply` schema): an answer, up to 200
    field-level edit proposals, and up to 12 `newCategories`.
    `resolveExpenseChatEdits` drops anything unsafe
    - unknown row ids, category names that are not in the catalog, unparseable
    amounts, no-op changes - before the client ever sees them. Each proposal
    renders as an approval card (`ExpenseChatEditList`) with Approve/Dismiss
    per card and Approve all/Dismiss all; nothing writes until a button is
    clicked. An approval goes through `applyExpenseEdits`
    (`lib/monthsClientStore.ts`): the active month takes the optimistic
    path, other months are fetched, patched, and PUT back whole-document, and
    the whole operation runs serialized so two quick approvals cannot race.
    `lib/expenseEdits.ts` owns the editable-field list, the edit type, and the
    row patcher; chat approvals deliberately do not write undo history.
  - Chat can also *propose new categories*, so "make a Coffee Runs category and
    move those rows into it" is one answer instead of a manual catalog edit
    followed by a second question. The prompt carries the whole catalog -
    name, source, description, and whether each is selectable or disabled -
    because a bare name list made every near-duplicate look like a gap; that
    same block is what the model reads off when asked what categories exist.
    `resolveExpenseChatCategories` drops blank, over-long
    (`MAX_CATEGORY_NAME_LENGTH`), and duplicate names, matching disabled ones
    too, since creating one would 409 and a disabled category comes back by
    ticking it. A category proposed in a reply is a legal target for that same
    reply's `category` edits, and approving a batch creates the categories
    (`POST /api/categories`) *before* applying the row edits; a creation that
    fails returns its card to pending rather than claiming `Added`. Dismissing
    the category but approving the moves leaves rows on a name the catalog
    does not hold, which the row select still offers, the same as a deleted
    category.
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

### 3D spending calendar

- `3D Calendar` is an additional graph option beside Flow and Pie in the single-month panel.
  All mode offers Compare and Year only. `components/SpendingCalendar.tsx` projects stacked 3D prisms into SVG,
  initially isometric, with pointer orbit, Space + drag panning, keyboard camera controls,
  zoom, and reset. Panning uses screen-aligned coordinates; Reset view resets its offset too.
- Every day has the same tower footprint; segment height is linear in gross positive spending
  for its category. The “Hide Rent” toggle starts enabled and excludes Rent from blocks, totals,
  and scaling (case-insensitive); turning it off restores Rent throughout the calendar.
  Each calendar scales against its largest daily spending or income total and labels that amount. A Volume scale slider
  multiplies tower heights by 25–300%, keeping footprints and spending proportions fixed;
  Reset scale returns to 100%. Camera zoom remains independent.
  Recognized income is grouped by actual date and shown as green blocks beneath the day tiles,
  using the same dollars-to-volume scale as spending. Day details list deposit sources and totals.
  Amount labels are projected onto spending caps and visible income faces, with no badge.
  Small blocks use detached labels with leaders; overlapping detached labels move outward.
  The overview includes dated income rows from the same tenant-scoped month documents.
  Category colors are keyed by name and use theme tokens. Selecting a day shows its breakdown;
  selecting a category highlights that category without changing the volume scale.
  Selecting a day also filters the expense table below in the month view, combined
  with category filters. Click the day again, select All days, or clear the date chip to reset.
- `lib/spendingCalendar.ts` validates actual transaction dates and aggregates charges. Invalid,
  out-of-month, zero, and negative rows are not plotted and are disclosed. Reimbursements are
  not subtracted. The single-month view uses the active document's rows; the All view groups
  every loaded row by transaction date, including dates outside a statement's filing month.
  These views are read-only and do not introduce a new data or persistence path.

## Important Files

- `components/StatementWorkspace.tsx` - client UI state, upload, row editing, and save flow.
- `components/CashFlowSankey.tsx` - the Sankey renderer shared by the month view and the
  all-months row, including the saved/overspent riser shapes.
- `components/AllMonthsView.tsx` - the All view: fetches `/api/months/overview` and renders
  either one Sankey card per month (`Compare`) or one Sankey for a whole calendar year
  (`Year`), plus the read-only transactions table and its category filter.
- `components/DocumentManager.tsx` - the `/documents` page: fetches `/api/documents` and
  renders one expandable card per uploaded statement (`app/documents/page.tsx` mounts it).
- `lib/documents.ts` - the pure fold behind it: `listLedgerDocuments` groups every filed
  statement segment back into the file it came from, with per-segment and per-document
  totals, and `documentIdOf` is the split-suffix rule; `lib/documents.test.ts` covers both.
  `app/api/documents/route.ts` serves it.
- `lib/allMonths.ts` - per-month cash flow summaries, per-year rollups (`summarizeYears`),
  the flattened transaction list (`listTransactions`), and cross-month totals;
  `lib/allMonths.test.ts` covers it. `app/api/months/overview/route.ts` serves it.
- `lib/chartFormat.ts` / `lib/currency.ts` - chart colour/label helpers and the shared
  currency formatter, extracted so both chart components use one copy.
- `lib/graphZoom.ts` - the zoom stops and stepping shared by the single-month
  graph and the all-months row.
- `lib/theme.ts` - theme preference storage, resolution, and the pre-paint init script;
  `components/ThemeToggle.tsx` is the segmented light/dark/system control.
- `lib/months.ts` - month determination, filing, reassignment, listing, and legacy draft
  migration as pure transforms; `lib/months.test.ts` covers it.
- `lib/monthsClientStore.ts` - client-side month store: load, debounced writes, unload flush,
  and the `?month=` deep link the document manager uses.
- `lib/monthStore.ts` - server-side month document persistence in Postgres.
- `lib/db.ts` - lazy Neon client (no Proxy wrapper) plus numeric/text column coercion.
- `lib/migrations/*.sql` - schema history, applied in filename order and tracked in
  `schema_migrations`.
- `lib/currentUser.ts` - `requireUserId()`, the tenant key every store call needs. In local
  demo mode it answers with the demo tenant instead of a session's user.
- `lib/viewer.ts` - the *display* answer to "whose ledger is this": `getViewer()` plus the
  pure `describeViewer` (demo wins over any session), covered by `lib/viewer.test.ts`. It
  grants nothing; access stays in `proxy.ts` and the tenant key in `requireUserId()`.
- `components/AuthStatus.tsx` / `app/authActions.ts` - the header auth chip and the
  `signOutAction` server action behind its `Sign out` button.
- `lib/notionConnection.ts` - per-user Notion credentials.
- `lib/secrets.ts` - AES-256-GCM encryption for stored credentials.
- `lib/apiErrors.ts` - shared 401/503 responses for missing sessions and unreadable credentials.
- `proxy.ts` - WorkOS AuthKit gate over every route except the sign-in flow, static assets,
  and local demo mode.
- `app/callback/route.ts` - AuthKit callback. `handleAuth`'s default answer to a missing PKCE
  cookie, a missing `code`/`state`, or a state mismatch is a bare JSON 500, which strands the
  user with no way back into the flow; those three codes are recoverable, so `onError` restarts
  sign-in instead. A 120s `HttpOnly` cookie bounds it to one retry, because `/sign-in` bounces
  through WorkOS and a query-string marker would not survive the round trip. Any other failure
  is a real fault and still surfaces.
- `lib/accessControl.ts` - email allowlist decision. A WorkOS session only proves *someone*
  signed in; without the allowlist anyone able to sign up would reach the ledger. Unset
  `STATEMENT_LEDGER_ALLOWED_EMAILS` denies everyone rather than falling open.
- `lib/demoMode.ts` - the auth-less demo decision: `isDemoMode()`, `DEMO_USER_ID`, and the
  pure `decideDemoMode` it delegates to. Refused on every Vercel deployment. See
  `## Auth-Less Demo Mode`.
- `app/api/months/route.ts` and `app/api/months/[month]/route.ts` - month list and
  read/write/delete of one month document.
- `app/api/categories/route.ts` - category catalog: GET read, POST create a custom category,
  PATCH enable/rename/re-describe (renames also cascade to stored expense rows), DELETE remove.
- `app/api/categories/import/route.ts` - Notion category import route.
- `app/api/extract/route.ts` - upload validation, artifact persistence, OpenRouter extraction, fallback application.
- `app/api/notion/save/route.ts` - Notion save route.
- `lib/categoryStore.ts` - category catalog persistence in Postgres, plus the create/update/
  delete rules and `CategoryRequestError`, whose `status` the route returns verbatim.
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
- `scripts/seed-demo.ts` - seeds three fixed months for the demo tenant; idempotent, and its
  header lists the UI states the seed cannot reach.
- `scripts/refile-multi-month-statements.ts` - re-files already stored statements that
  cover several months, using the same `planStatementFiling`. Dry run unless `--apply`;
  skips statements whose month was set by hand. Used once to split the ledger's
  January-May rows out of 2026-03.
- `lib/openrouter.ts` - OpenRouter request, prompt, response parsing, debug payload.
- `lib/fallbackExtractor.ts` - deterministic PDF text fallback.
- `lib/artifacts.ts` - `/tmp` artifact persistence.
- `lib/notion.ts` - Notion data source schema and page creation.
- `lib/extractionSchema.ts` - structured JSON schema used with OpenRouter.
- `lib/expenseEdits.ts` - the fields expense chat may propose, the edit shape,
  the `CategoryProposal` shape, and the row patcher shared by the chat route
  and the client store.

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

### Dev server

The dev server is a **supervised omp process named `dev`**, never a foreground `bash` command.
A foreground `bun run dev` blocks the tool call until it is killed by the 300s timeout, and its
output belongs to that one chat.

Start it (idempotent per project: a live `dev` must be stopped or restarted first):

```jsonc
// hub op:"start"
{
  "name": "dev",
  "application": "bun",
  "args": ["run", "dev", "--hostname", "127.0.0.1", "--port", "3000"],
  "env": { "BUN_INSTALL": "/tmp/bun-install", "BUN_TMPDIR": "/tmp/bun-tmp" },
  "persist": true,
  "restart": "on-failure",
  "ready": { "log": "Ready in", "port": 3000, "timeout": 90 }
}
```

Why this shape:

- **Not chat-scoped.** The first process op starts a detached broker on a private socket under
  `~/.omp/run/daemons/<project-hash>/`, and *every* omp instance in this directory shares the
  same names, logs and state. A new chat, a `/new`, or a second terminal sees the same `dev`
  through `hub op:"ps"` — nothing to hand over.
- **`persist: true`.** Without it the broker stops the process when the *last* omp instance
  exits. With it the server survives quitting omp entirely.
- **Not `detached: true`.** Detached survives even broker shutdown, but it forces `pty: false`
  and disables stdin. `persist` already covers closing chats, so keep the PTY.
- **`restart: "on-failure"`** with bounded backoff, so a crash from a bad edit comes back.
- **`--hostname 127.0.0.1`** matches `next.config.ts`'s `allowedDevOrigins`, so HMR is not
  blocked as cross-origin. A blocked `/_next/webpack-hmr` still serves HTML but never
  hydrates, which looks exactly like a broken component: clicks do nothing.

Reading it later, from any chat:

```jsonc
{ "op": "ps" }                                                  // is it alive, restarts, uptime
{ "op": "logs", "name": "dev", "lines": 80 }                    // tail
{ "op": "logs", "name": "dev", "grep": "error|⨯|Error" }        // failures only
{ "op": "logs", "name": "dev", "follow": true, "cursor": 1842 } // stream past a cursor
{ "op": "restart", "name": "dev" }                              // reuses the launch spec
{ "op": "stop", "name": "dev" }                                 // graceful tree kill
```

The broker keeps a 25 MiB current log plus one rotated log, so the logs outlive the chat that
started the server. Never `kill` a dev PID found through `ps`; use `hub op:"stop"`.

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

## Parallel Worktrees

Three or more instances of this app can run at once, one per git worktree. `scripts/worktree.ts`
(`bun run wt`) owns the paradigm; do not hand-roll `git worktree add`, because a bare worktree
cannot run the app: `.env.local` and `node_modules` are untracked, and a second `next dev` just
collides on port 3000.

```bash
bun run wt new frontend-a          # worktree + branch + env copy + install + port
bun run wt list                    # name, branch, kind, port, dev running, ahead/dirty
bun run wt adopt . --name harness  # make an externally created worktree runnable
bun run wt dev frontend-a          # next dev on that worktree's own port ("." or no arg = cwd)
bun run wt rm frontend-a [--force] [--delete-branch]
```

What `new` does, and why each step exists:

- Creates `.claude/worktrees/<name>` on branch `worktree-<name>` (the layout the first two
  worktrees already used). `.claude/**` is ignored by git, by `eslint.config.mjs`, by tsconfig
  globs (which skip dot directories), and by `bun test` (same reason), so nested checkouts never
  double-count tests or lint errors in the primary checkout.
- **Copies** `.env.local` rather than symlinking it. A symlink would let `vercel env pull` inside
  a worktree rewrite the primary checkout's secrets — see `Vercel Env Pull Hazard`. The copy is a
  snapshot: add a variable to the primary `.env.local` and existing worktrees keep the old file.
- Runs `bun install` (~2s; Bun hardlinks from its global cache, so per-worktree `node_modules` is
  cheap and correct — do not share one across checkouts).
- Claims the first free port in 3001-3019 and records it in `.worktree.json`, so `list`/`dev` are
  deterministic and two worktrees never pick the same port. Port 3000 stays reserved for the
  primary checkout. `.worktree.json` is in `.gitignore` and also in `.git/info/exclude`, which
  the script writes once because `info/exclude` lives in the common git dir and therefore covers
  branches predating the `.gitignore` entry.
- Points the copied `.env.local` at `http://localhost:<port>/callback` when that port is
  registered with WorkOS (3001-3005). See `Sign-in` below.

### Worktrees created elsewhere

`new` is the only command tied to `.claude/worktrees`. Everything else operates on *any* worktree
of this repo, because the `omp` harness creates its own — `~/.omp/wt/<id>` on branch
`wt/<stamp>`, outside the checkout — and a bare `git worktree add` is still possible. `list`
shows those with `KIND external`, and they are addressed by directory name, by an alias recorded
with `adopt --name`, by path, or as `.`/no argument for the worktree the caller is standing in.

`adopt` and `dev` heal whatever is missing, idempotently: port claim, `.env.local` copy,
dependency install, redirect URI. The harness already copies `.env.local` and installs, so in
practice adopting one only claims a port (its absence means two instances can pick the same
port) and rewrites the redirect URI.

`rm` refuses an external worktree without `--force`: the directory belongs to whatever created
it, and deleting it out from under the harness is not this script's call.

Things that are shared and will bite:

- **Sign-in.** Registered callbacks cover `localhost:3000`-`3005` only, and that list cannot be
  written by CLI (see `Local Sign-In (WorkOS)`). `wt` rewrites `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
  in the worktree's `.env.local` to its own port when the port is registered, so the first five
  worktrees sign in standalone. Ports 3006-3019 fall back to the primary checkout's callback,
  which still works because cookies are *not* port-scoped (RFC 6265 §8.5): a session minted on
  `localhost:3000` is sent to `localhost:3001` and up, and every worktree seals it with the same
  `WORKOS_COOKIE_PASSWORD`. Practical rule for those: keep a dev server on 3000 while signing
  in. Verified locally by setting a cookie on one localhost port and reading it back on another.
- **The database.** Every worktree copies one `DATABASE_URL`, so all instances read and write the
  same Neon rows as the same user. Month writes are whole-document and transactional, so two
  instances editing the same month is last-write-wins, not a merge: the second flush overwrites
  the first instance's rows. Frontend-only work in parallel is safe; put schema or store changes
  in one worktree at a time, and remember `bun run scripts/migrate.ts` migrates the shared
  database for all of them at once.
- **Upload artifacts.** `/tmp/statement-ledger/uploads/` is shared, but ids are unique per
  upload, so instances interleave without colliding.

`next.config.ts` pins `turbopack.root` to the checkout's own directory. Worktrees made by `new`
live *inside* the primary checkout, so Turbopack's default upward lockfile search rooted a
worktree's dev server at the parent repo (it logged `Detected additional lockfiles`). Do not
remove that pin; external worktrees do not need it but are not harmed by it.

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
