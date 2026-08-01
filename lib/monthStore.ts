import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isMonthKey,
  listMonths,
  parseMonthDocument,
  type MonthDocument,
  type MonthSummary
} from "@/lib/months";

const DATA_ROOT = "data";
const MONTHS_DIRECTORY = "months";

export async function listStoredMonths(): Promise<MonthSummary[]> {
  const documents = await Promise.all(
    (await storedMonthKeys()).map((month) => readStoredMonth(month))
  );

  return listMonths(
    documents.filter((document): document is MonthDocument => Boolean(document))
  );
}

export async function readStoredMonth(
  month: string
): Promise<MonthDocument | null> {
  if (!isMonthKey(month)) {
    return null;
  }

  try {
    const raw = await readFile(monthPath(month), "utf8");

    return parseMonthDocument(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Whole-document replacement. A month left without statements is removed rather
 * than stored, so the stepper never walks an empty month.
 */
export async function writeStoredMonth(
  document: MonthDocument
): Promise<MonthDocument | null> {
  if (!isMonthKey(document.month)) {
    throw new Error("A month document needs a YYYY-MM month key.");
  }

  if (document.statements.length === 0) {
    await deleteStoredMonth(document.month);

    return null;
  }

  const filePath = monthPath(document.month);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  return document;
}

async function deleteStoredMonth(month: string) {
  if (!isMonthKey(month)) {
    return;
  }

  await rm(monthPath(month), { force: true });
}

async function storedMonthKeys() {
  try {
    const entries = await readdir(monthsDirectory());

    return entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -".json".length))
      .filter(isMonthKey);
  } catch {
    return [];
  }
}

function monthPath(month: string) {
  return path.join(monthsDirectory(), `${month}.json`);
}

function monthsDirectory() {
  return path.join(process.cwd(), DATA_ROOT, MONTHS_DIRECTORY);
}
