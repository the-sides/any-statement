/**
 * Re-files statements that cover more than one calendar month.
 *
 *   STATEMENT_LEDGER_LEGACY_USER_ID=user_... bun run scripts/refile-multi-month-statements.ts [--apply]
 *
 * Statements were filed whole, under the single month covering most of their
 * period, so a bank export spanning January to May buried four months of rows
 * in the fifth. `planStatementFiling` now splits such a statement per calendar
 * month; this applies the same plan to what is already stored.
 *
 * It only touches statements the planner splits into more than one month, and
 * never one whose month was set by hand (`monthSource: "manual"`), so an
 * override the reviewer made is not undone. Dry run by default.
 */
import {
  createMonthDocument,
  fileStatementIntoMonth,
  planStatementFiling,
  summarizeMonthDocument,
  type MonthDocument
} from "@/lib/months";
import { listStoredMonthDocuments, writeStoredMonth } from "@/lib/monthStore";

const userId = process.env.STATEMENT_LEDGER_LEGACY_USER_ID;

if (!userId) {
  console.error(
    "Set STATEMENT_LEDGER_LEGACY_USER_ID to the WorkOS user id whose months to re-file."
  );
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const documents = await listStoredMonthDocuments(userId);
// null means "this month is now empty", which writeStoredMonth deletes.
const rebuilt = new Map<string, MonthDocument | null>(
  documents.map((document) => [document.month, document])
);
let splitCount = 0;

for (const document of documents) {
  for (const statement of document.statements) {
    const expenses = document.expenses.filter(
      (expense) => expense.statementId === statement.id
    );
    const incomes = document.incomes.filter(
      (income) => income.statementId === statement.id
    );
    const plan = planStatementFiling({
      statement,
      expenses,
      incomes,
      selectedIds: document.selectedIds
    });

    if (statement.monthSource === "manual" || plan.segments.length < 2) {
      continue;
    }

    splitCount += 1;
    console.log(
      `${document.month}: ${statement.sourceFileName || statement.id} ` +
        `(${expenses.length} expenses, ${incomes.length} incomes) -> ` +
        plan.segments
          .map(
            (segment) =>
              `${segment.month} (${segment.expenses.length}/${segment.incomes.length})`
          )
          .join(", ")
    );

    const source = rebuilt.get(document.month) || null;

    if (source) {
      const remaining = source.statements.filter(
        (candidate) => candidate.id !== statement.id
      );

      rebuilt.set(
        document.month,
        remaining.length
          ? createMonthDocument({
              month: source.month,
              statements: remaining,
              expenses: source.expenses.filter(
                (expense) => expense.statementId !== statement.id
              ),
              incomes: source.incomes.filter(
                (income) => income.statementId !== statement.id
              ),
              selectedIds: source.selectedIds,
              activeStatementId: source.activeStatementId
            })
          : null
      );
    }

    for (const segment of plan.segments) {
      rebuilt.set(
        segment.month,
        fileStatementIntoMonth(rebuilt.get(segment.month) || null, segment)
      );
    }
  }
}

if (splitCount === 0) {
  console.log("No multi-month statements found.");
  process.exit(0);
}

const months = [...rebuilt.keys()].sort();

console.log("");

for (const month of months) {
  const document = rebuilt.get(month) || null;
  const before = documents.find((candidate) => candidate.month === month);

  if (document && before && sameDocument(before, document)) {
    continue;
  }

  const summary = document ? summarizeMonthDocument(document) : null;

  console.log(
    `${apply ? "write" : "would write"} ${month}: ` +
      (summary
        ? `${summary.statementCount} statements, ${summary.expenseCount} expenses ` +
          `($${summary.amount.toFixed(2)}), ${summary.incomeCount} incomes ` +
          `($${summary.incomeTotal.toFixed(2)})`
        : "empty (deleted)")
  );

  if (apply) {
    await writeStoredMonth(
      userId,
      document ||
        createMonthDocument({
          month,
          statements: [],
          expenses: [],
          incomes: [],
          selectedIds: []
        })
    );
  }
}

console.log(
  apply
    ? `\nRe-filed ${splitCount} multi-month statement(s).`
    : `\n${splitCount} multi-month statement(s) would be re-filed. Re-run with --apply.`
);

function sameDocument(before: MonthDocument, after: MonthDocument) {
  const first = summarizeMonthDocument(before);
  const second = summarizeMonthDocument(after);

  return (
    first.statementCount === second.statementCount &&
    first.expenseCount === second.expenseCount &&
    first.incomeCount === second.incomeCount &&
    first.amount === second.amount &&
    first.incomeTotal === second.incomeTotal
  );
}
