# Spec: Month-Scoped Statements

Status: ready-for-agent

## Problem Statement

I upload two statements at a time — one credit card, one bank — because together they
represent a single month of my spending. The app already shows both statements' rows
together in one review table, with combined totals and cash flow graphs, and that part
works well.

The problem is that the review draft never ends. Every upload appends to the same pile.
When next month arrives and I upload that month's two statements, their rows land on top
of last month's rows. The table, the totals, the Sankey, and the pie chart all become a
running lifetime sum instead of a picture of a month. My only recourse is to remove last
month's statements by hand before uploading, and if I forget, every number on screen is
silently wrong — it looks like a normal month, it just isn't one.

I also lose last month entirely when I do that. Removing a statement to clear the decks
deletes its rows outright. There is no way to look back at June once I have started July.

I do not want to manage this. I should not have to remember to close a month, press a save
button, or clean up before uploading. Uploading a statement is the only action I take, and
the app should already know which month that statement belongs to.

## Solution

A statement's month is determined automatically at upload time, and the workspace shows one
month at a time.

When a statement is extracted, the app decides which calendar month it belongs to and files
it there. The workspace switches to that month and shows only that month's statements, rows,
selection, totals, and graphs. Uploading my credit card statement puts me in June with one
statement; uploading my bank statement leaves me in June with both, exactly as the review
table behaves today. When August comes around, the first upload moves me to August with a
clean table — no cleanup, no button, no decision.

Months I have already filled are still there. A `‹ June 2026 ›` control above the statements
list steps between the months that have statements in them. Landing on a past month gives me
the same fully-functional workspace I had when it was current: the same table, the same
inline edits, the same bulk recategorize, the same graphs. Nothing is frozen or read-only.

Because the automatic rule cannot be right for every billing cycle, each statement's month is
a field I can change. Changing it moves that statement and its rows into the month I chose.

The archive lives on disk rather than in browser storage, so it survives clearing site data
and is the same whether I open the app on my phone or my laptop.

## User Stories

1. As a statement reviewer, I want an uploaded statement to be assigned to a month
   automatically, so that I never have to file it myself.
2. As a statement reviewer, I want the month to be derived from the statement's own period
   dates, so that the assignment reflects the statement rather than when I happened to upload
   it.
3. As a statement reviewer, I want a statement whose period straddles two calendar months to
   be filed under the month covering most of its days, so that a credit card cycle running
   mid-month to mid-month lands with the bank statement it belongs beside.
4. As a statement reviewer, I want my card statement and my bank statement to land in the same
   month even though their periods differ, so that I keep seeing them together the way I do
   today.
5. As a statement reviewer, I want the app to fall back to my transaction dates when the
   statement period is missing or unparseable, so that a poor extraction still gets filed
   correctly.
6. As a statement reviewer, I want to be asked to pick a month only when both the period and
   the transaction dates are unusable, so that I am interrupted rarely and only when the app
   genuinely cannot know.
7. As a statement reviewer, I want the workspace to switch to the uploaded statement's month
   immediately, so that I see the rows I just extracted without hunting for them.
8. As a statement reviewer, I want a second upload for the same month to join the first rather
   than replace it, so that both statements review together as one month.
9. As a statement reviewer, I want an upload belonging to a different month than the one I am
   viewing to move me to that month, so that I am never editing rows I cannot see.
10. As a statement reviewer, I want to be told which month an upload landed in, so that I can
    catch a misfiled statement immediately instead of weeks later.
11. As a statement reviewer, I want the review table to show only the active month's rows, so
    that the rows on screen are the month I am reviewing.
12. As a statement reviewer, I want row counts, selected counts, and the amount total to cover
    only the active month, so that the numbers describe a month rather than my whole history.
13. As a statement reviewer, I want the cash flow Sankey and pie to be built from only the
    active month's rows, so that the graphs answer "where did this month go".
14. As a statement reviewer, I want the statements panel to list only the active month's
    statements, so that it stays two entries long instead of growing forever.
15. As a statement reviewer, I want category filters to apply within the active month, so that
    filtering narrows a month rather than a lifetime.
16. As a statement reviewer, I want the expense chat assistant to see only the active month's
    rows, so that asking about my spending answers for that month.
17. As a statement reviewer, I want to step to the previous month with one tap, so that
    checking last month is quick on my phone.
18. As a statement reviewer, I want to step forward to the next month the same way, so that I
    can get back to where I was.
19. As a statement reviewer, I want the month stepper to skip months I never uploaded, so that
    I never land on an empty screen.
20. As a statement reviewer, I want the stepper's arrows disabled at the oldest and newest
    months, so that it is obvious when I have reached the end of my history.
21. As a statement reviewer, I want the current month's name always visible, so that I always
    know which month the numbers on screen describe.
22. As a statement reviewer, I want to be able to upload a statement no matter which month I
    am currently viewing, so that starting a new month never requires navigating anywhere
    first.
23. As a statement reviewer, I want a past month to be fully editable, so that fixing a
    miscategorized row from June does not require re-uploading June.
24. As a statement reviewer, I want bulk recategorize and its undo to work inside a past month,
    so that every editing tool I have works everywhere.
25. As a statement reviewer, I want to change a statement's month by hand, so that I can
    overrule the automatic rule when it disagrees with how I think about that bill.
26. As a statement reviewer, I want changing a statement's month to carry its rows with it, so
    that both months' totals stay correct afterwards.
27. As a statement reviewer, I want moving the last statement out of a month to leave no empty
    month behind, so that my stepper only walks through months with real content.
28. As a statement reviewer, I want removing a statement to affect only its own month, so that
    cleanup never touches a month I am not looking at.
29. As a statement reviewer, I want my months stored on disk rather than in browser storage, so
    that clearing site data on my phone does not destroy my history.
30. As a statement reviewer, I want the same months whether I open the app on my phone or my
    laptop, so that there is one archive rather than one per browser.
31. As a statement reviewer, I want my edits to feel instant while still being written to disk,
    so that typing in the table is not gated on a network round-trip.
32. As a statement reviewer, I want my edits persisted without me pressing save, so that
    closing the tab mid-review does not lose work.
33. As a statement reviewer, I want the review draft I already have in my browser migrated into
    its correct month the first time I load the new version, so that I do not lose the
    statements I am part-way through reviewing.
34. As a statement reviewer, I want saving to Notion to keep working exactly as it does now, so
    that adding months does not change the part of the flow I already trust.
35. As a statement reviewer, I want saving to Notion to send the active month's selected rows,
    so that a save corresponds to a month.
36. As a statement reviewer, I want to know when the app had to guess a statement's month from
    transaction dates instead of its period, so that I know to double-check that one.
37. As a statement reviewer, I want a clear empty state when I have no months at all, so that a
    first run tells me to upload rather than showing a broken stepper.

## Implementation Decisions

### Months are derived, never saved

There is no "save month", "close month", or "archive" action anywhere in the UI. A month is a
consequence of uploading a statement, not a thing the user creates. This was the central
correction during design: the user does not want a lifecycle to manage.

### Month determination rule

The month for a statement is the calendar month covering the greatest number of days of the
statement's period, inclusive of both endpoints. A period of Jun 12 – Jul 11 is 19 days in
June and 11 in July, so it files under June. A period of Jun 1 – Jun 30 files under June.
This is what keeps a mid-month credit card cycle and a calendar-month bank statement in the
same bucket, which is the entire point of the feature.

Ties go to the earlier month.

If the period is unusable — either endpoint missing, unparseable, or inverted — the rule falls
back to the calendar month containing the most of the statement's extracted expense row dates.
This fallback matters because extraction is known to return empty period strings in some cases,
and the deterministic PDF fallback parser derives dates per row without a period header.

If both the period and the row dates are unusable, the upload prompts the user to choose a
month. Nothing is filed until they choose.

A month is identified by a `YYYY-MM` key. This key sorts lexicographically, which the stepper
relies on.

The determined month is recorded on the statement, not recomputed on read. Recomputing would
silently overwrite a manual override.

### One domain module owns the logic

A new months domain module owns every rule above plus filing, reassignment, month listing, and
migration of the legacy review draft — all as pure transforms over plain data, with no
filesystem or network access. It follows the shape of the existing review draft module: create,
parse, and normalize functions with defensive parsing of anything read back from storage.

The existing review draft module's role narrows. Its statement and expense normalization,
parsing, and ID generation are reused by the month document rather than duplicated; the month
document is the new top-level container that a draft used to be.

### Storage: one document per month, on disk

Months are persisted server-side, one JSON document per month, in a gitignored repo-local data
directory (`./data/months/<YYYY-MM>.json`). This was chosen over the existing artifact
directory because that directory defaults to `/tmp`, which has already been wiped on this
machine at least once — the category catalog is currently missing as a result. Uploaded
statement files and debug extraction artifacts continue to go to the artifact directory under
`/tmp`, where being wiped is acceptable and desirable.

One document per month rather than a single combined file keeps each write small, keeps a
corrupted month from taking the archive with it, and makes a month trivially inspectable.

A month document contains its month key, its statements (summary, source filename, imported
timestamp), its expense rows, the selected row IDs, and the active statement ID. It carries a
version field and is parsed defensively, discarding rows that fail validation, in the same
manner as the current review draft parsing.

### Storage: the server is the only store for month data

The month currently being edited is not special. It lives in the same place, in the same
format, as every other month. There is no separate live-vs-archive distinction and therefore
no synchronization between two stores.

Edits update client state immediately and flush to the server on a debounce of roughly 500ms,
so that typing in a description field or bulk-recategorizing forty rows produces one write
rather than many. A pending flush must be forced on page unload.

Consequence accepted: first paint gains a loading state the app does not have today, because
month data can no longer be read synchronously.

### Storage: what stays in browser storage

Only the review draft moves to the server. The cash flow plan, the bulk-recategorize undo
history, the categorization notes, and the app-category visibility preference all remain in
browser local storage and remain global rather than per-month. This is a deliberate scope
boundary, not an oversight.

Consequence accepted for the cash flow plan: revisiting June renders its Sankey and pie
against the user's current income entries. Changing income in September retroactively changes
June's graphs. The user accepted this explicitly; storing a per-month snapshot of the plan was
considered and rejected as unnecessary for a personal tool.

### API surface

A new months route exposes: list the available month keys with enough summary to render the
stepper; read one month document by key; write one month document by key. Writes are
whole-document replacements rather than patches, which keeps the contract small and matches
the debounced-flush model.

Filing an upload into a month is a client-side operation using the domain module, followed by
a write of the resulting month document. The extraction route is not changed. Keeping
determination on the client means the same pure function serves upload, manual reassignment,
and migration.

### Navigation

A stepper sits above the statements panel showing `‹ <Month> <Year> ›`. It steps only through
month keys that have at least one statement, sorted by key. Arrows are disabled at the
boundaries. There is no dropdown and no month list panel; the user chose the thumb-friendly
minimum for phone use.

The active month key is client state. On load, the app selects the newest month that has
statements. When no months exist at all, the workspace shows its empty state with the upload
control available.

The upload control is available regardless of which month is being viewed, which is what makes
"only months that have statements" navigable — a month that does not exist yet is reached by
uploading into it, not by stepping to it.

### Statement reassignment

Each statement in the statements panel exposes its month as an editable field. Changing it
moves the statement and all of its rows out of the source month document and into the target
month document, creating the target if it does not exist and deleting the source if it becomes
empty. Selection state for the moved rows travels with them.

### Migration of the existing review draft

On first load after this ships, if the legacy review draft key is present in browser storage,
the app parses it, applies the determination rule to each of its statements, distributes its
rows into the resulting month documents, writes them, and then removes the legacy key. Rows
whose statement cannot be resolved are dropped, consistent with how the current draft parser
already discards orphaned rows.

Migration runs once and is written so it can be deleted in a later change.

### Notion save

The Notion save path is untouched. It continues to send the currently selected rows, which are
now naturally scoped to the active month because only that month's rows are loaded.

No month property is written to Notion. Notion rows already carry a Date, which supports
grouping and filtering there natively; a second month field would duplicate that and would
disagree with it whenever a statement's determined month differs from its rows' dates.

## Testing Decisions

### What makes a good test here

Tests assert externally observable behavior of the months domain module: given statements and
rows in, which month key comes out, which documents exist afterwards, and what each contains.
They must not assert on internal helper structure, intermediate shapes, or the order in which
transforms are applied. A test that would fail after a pure refactor of the module's internals
is a bad test.

Every test is a pure function call with plain data in and plain data out. No filesystem, no
fetch, no React, no mocks.

### The seam

A single seam: the months domain module. All determination, filing, reassignment, listing, and
migration logic lives behind it, so all of it is reachable from one test file.

Filesystem I/O and the months API route are deliberately kept thin enough not to warrant their
own tests, matching how the existing category catalog store — the closest prior art for
server-side persistence in this codebase — is treated today. The UI component is not tested;
the codebase has no component tests and this change does not introduce the first.

### Prior art

The existing review draft tests are the direct model to follow: a shared statement extraction
fixture at the top of the file, then focused cases exercising create, parse, and normalize
paths including malformed input. The cash flow plan and review history tests follow the same
pattern for their own domain modules. All use `bun:test` with `describe`/`test`/`expect` and
the `@/` path alias.

Tests run with a bare `bun test`; there is no test script in the package manifest, and adding
one is optional and out of scope.

### Cases that must be covered

- A period fully inside one calendar month files under that month.
- A period straddling two months files under the month holding more days, in both directions.
- A card period of Jun 12 – Jul 11 and a bank period of Jun 1 – Jun 30 file under the same
  month — the motivating case, worth an explicit test.
- A tie between two months resolves to the earlier one.
- A missing, malformed, or inverted period falls back to the majority of row dates.
- A statement with neither a usable period nor usable row dates is reported as undeterminable
  rather than guessed.
- Filing a second statement into an existing month appends rather than replaces, and preserves
  the first statement's rows and selection.
- Reassigning a statement moves its rows, creates the target month when absent, and removes the
  source month when it empties.
- A month document round-trips through parse unchanged.
- Parsing a month document with malformed rows, an unknown version, or orphaned rows discards
  the bad parts without throwing.
- Migrating a legacy review draft distributes its statements across the correct months.
- Migrating a legacy draft containing statements from two different months produces two month
  documents.
- Listing months returns keys in chronological order and omits months with no statements.

## Out of Scope

- **Notion double-save protection.** Because past months stay editable, revisiting June and
  saving to Notion again will create duplicate pages — Notion has no idempotency here and the
  app does not track which rows it has already sent. The user explicitly chose to accept this
  and clean up by hand if it happens. Recording saved row IDs was considered and deferred.
- **Per-month cash flow plans.** Income entries stay global; past months render against
  current income. See the consequence noted above.
- **Cross-month views.** No multi-month comparison, no trends, no "all months" table, no
  year-to-date totals. The stepper shows exactly one month.
- **A months list or dropdown UI.** Prev/next arrows only.
- **Empty or future month navigation.** Only months containing statements are reachable.
- **Read-only or locked past months.** Everything is editable everywhere.
- **A month property in Notion.**
- **Moving the category catalog off `/tmp`.** It is affected by the same wipe problem and is
  worth fixing, but it is a separate change.
- **Multi-user, auth, or concurrent access.** This is a single-user local tool; the last write
  wins and no locking is implemented.
- **Changing extraction, the fallback parser, or the artifact pipeline.**

## Further Notes

The bulk of the work is the persistence rewrite inside the statement workspace component,
which is roughly 3,500 lines and currently uses synchronous browser-storage reads through
`useSyncExternalStore` as the load-bearing mechanism for the review draft, the undo history,
and the cash flow plan. Only the draft moves to an async server-backed store, so the component
will hold a mixed model: one async store alongside three synchronous ones. That is accepted,
but it is where the risk in this change concentrates, and it is worth landing before the UI
work.

The `/tmp` wipe that motivated the storage decision is not hypothetical. At the time this spec
was written the artifact directory did not exist on the machine, meaning the imported category
catalog had already been lost once.

The determination rule will be wrong for some billing cycles by design — a Jun 28 – Jul 27
cycle files as July under majority-of-days even though a user may think of it as June's bill.
Manual reassignment is the intended remedy, which is why it is in scope rather than deferred.

The user is the only user of this tool, which is why a gitignored repo-local data directory is
acceptable. If that changes, the data location is the first decision to revisit.
