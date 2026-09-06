import { parseCashFlowEntries, type CashFlowEntry } from "@/lib/cashFlowPlan";
import { getSql } from "@/lib/db";
import {
  DEFAULT_CASH_FLOW_ENTRIES,
  normalizeCategorizationNotes,
  type UserSettings
} from "@/lib/userSettings";

export type StoredUserSettings = UserSettings & {
  /**
   * False when this user has never saved settings. The browser uses it to
   * decide whether a plan left in localStorage by the pre-database build is
   * still worth adopting, so it must not be conflated with "saved but empty".
   */
  configured: boolean;
};

type SettingsRow = {
  cash_flow_entries: unknown;
  categorization_notes: unknown;
  updated_at: unknown;
};

/**
 * Unlike the category catalog, a read failure here is not degraded into
 * defaults: the browser writes the whole settings row back, so answering a
 * database outage with an empty plan would let the next edit overwrite the
 * real one with the placeholder.
 */
export async function loadUserSettings(
  userId: string
): Promise<StoredUserSettings> {
  const rows = (await getSql()`
    select cash_flow_entries, categorization_notes, updated_at
    from user_settings
    where user_id = ${userId}
  `) as SettingsRow[];
  const row = rows[0];

  if (!row) {
    return {
      cashFlowEntries: [...DEFAULT_CASH_FLOW_ENTRIES],
      categorizationNotes: "",
      updatedAt: "",
      configured: false
    };
  }

  return {
    cashFlowEntries: parseCashFlowEntries(row.cash_flow_entries),
    categorizationNotes: normalizeCategorizationNotes(row.categorization_notes),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
    configured: true
  };
}

export async function saveUserSettings(
  userId: string,
  input: {
    cashFlowEntries: readonly CashFlowEntry[];
    categorizationNotes: string;
  }
): Promise<UserSettings> {
  const settings: UserSettings = {
    cashFlowEntries: parseCashFlowEntries(input.cashFlowEntries),
    categorizationNotes: normalizeCategorizationNotes(input.categorizationNotes),
    updatedAt: new Date().toISOString()
  };

  await getSql()`
    insert into user_settings (
      user_id, cash_flow_entries, categorization_notes, updated_at
    ) values (
      ${userId},
      ${JSON.stringify(settings.cashFlowEntries)}::jsonb,
      ${settings.categorizationNotes},
      ${settings.updatedAt}
    )
    on conflict (user_id) do update
      set cash_flow_entries = excluded.cash_flow_entries,
          categorization_notes = excluded.categorization_notes,
          updated_at = excluded.updated_at
  `;

  return settings;
}
