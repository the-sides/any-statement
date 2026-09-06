# Spec: Month Result Redesign

Status: wireframe — not ready-for-agent

Wireframe: `specs/wireframes/month-result.png` (source: `specs/wireframes/month-result.excalidraw`)

## Problem Statement

The workspace is built around the act of reviewing an upload, not around the answer the upload
produces. `components/StatementWorkspace.tsx` is 3,686 lines rendering, on one screen: an upload
panel, a Notion connection panel, an AI-notes panel, a category catalog panel, a month stepper,
a statement list, an active-statement card, an 87-row editable table, an expense chat, and a
Sankey/pie cash-flow panel. Six of those are configuration. Configuration is permanently on
screen; the month's result — what I spent, and on what — is assembled by reading a table.

Month-scoped statements already fixed the data model: a month is the unit, and it is derived,
not saved (`specs/month-scoped-statements.md`). The UI never followed. It still presents a
month as "the statements you uploaded and the rows you have not finished reviewing yet."

I open this app to answer one question — *how did September go?* — and every pixel that is not
answering it is in the way.

## Solution

One screen per month, and it opens with the answer.

**The month is the page.** `‹ September 2026 ›` in the top bar is the only navigation. Beneath
it, immediately: total spent, the change versus the previous month, and the plan context that
already exists in `user_settings` (income plan, left over, largest charge). No panel, no
scroll, no interaction required.

**"Where it went" is a sorted bar list, not a diagram.** Six categories descending, each a bar
scaled to the largest, amount on the right, `Everything else` last. This is the job the Sankey
and the pie were doing, done in a form that is readable at a glance and on a phone. Tapping a
bar filters the transaction list. The Sankey and the pie are removed, not relocated.

**Transactions are the detail level, opened on demand.** Four rows are visible with a
`Show all 87 →` affordance. Editing a category happens inline on the row I doubt, which is the
only editing the old review table was ever really used for.

**Uploading is a modal, not a panel.** `+ Add statement` opens a drop target, shows extraction
progress, and files the statement into the month it covers — the rule already implemented in
`lib/months.ts`. There is no review step to complete before the month renders; the month
renders and is corrected in place. The statement stops being a navigational object and becomes
provenance: "2 statements · 87 transactions".

**Setup is a drawer behind the avatar.** Notion connection, category catalog, AI notes, income
plan, theme, and sign-out. All of it is per-user configuration already persisted server-side;
none of it is a fact about September.

**Mobile is the same screen, not a reduced one.** The user uploads from a phone. Total, a
`Summary / Categories / List` segmented control, the same bars, recent rows, and a floating `+`.

## What is removed

| Today | Fate |
| --- | --- |
| Upload panel | `+ Add statement` modal |
| Notion panel | Account drawer |
| AI notes panel | Account drawer |
| Category catalog panel | Account drawer |
| Month stepper panel | Top bar |
| Statement list + active statement card | A line of provenance text under the total |
| Expense chat panel | Behind the full transaction list |
| Cash-flow Sankey + pie | Deleted; the category bars and `Left over` replace them |
| Always-visible 87-row review table | Four rows plus `Show all 87` |

## Open questions

- Does `Left over` mean income plan minus spend, or does it need the plan's own outflow
  entries subtracted first? `summarizeCashFlow` in `lib/cashFlowPlan.ts` already computes a
  number; the wireframe assumes that number is the one to show.
- Month-over-month delta needs the previous month document loaded alongside the active one.
  `/api/months` returns the list; the comparison requires a second read or a stored total.
- Bulk recategorize and undo (`lib/reviewHistory.ts`) have no home in the new layout. They
  belong in the expanded transaction list or they are dropped with the review flow.
