import { getSql } from "@/lib/db";
import { normalizeImportGuidance } from "@/lib/importGuidance";

/**
 * Per-user Import Guidance. Reads degrade to empty guidance when the row or the
 * table is unreachable, for the same reason category reads degrade to the
 * built-in defaults: guidance only tunes extraction, so a database outage must
 * not turn an upload into an error. Writes still surface their failure, because
 * silently discarding what the reviewer typed is worse than a visible error.
 */
export type StoredImportGuidance = {
  guidance: string;
  updatedAt: string;
};

const EMPTY: StoredImportGuidance = { guidance: "", updatedAt: "" };

export async function readImportGuidance(
  userId: string
): Promise<StoredImportGuidance> {
  let row: { guidance: unknown; updated_at: unknown } | undefined;

  try {
    const rows = (await getSql()`
      select guidance, updated_at
      from import_guidance
      where user_id = ${userId}
    `) as Array<NonNullable<typeof row>>;

    row = rows[0];
  } catch {
    return EMPTY;
  }

  if (!row) {
    return EMPTY;
  }

  return {
    guidance: typeof row.guidance === "string" ? row.guidance : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : ""
  };
}

export async function saveImportGuidance(
  userId: string,
  input: unknown
): Promise<StoredImportGuidance> {
  const guidance = normalizeImportGuidance(input);
  const updatedAt = new Date().toISOString();

  await getSql()`
    insert into import_guidance (user_id, guidance, updated_at)
    values (${userId}, ${guidance}, ${updatedAt})
    on conflict (user_id) do update
      set guidance = excluded.guidance,
          updated_at = excluded.updated_at
  `;

  return { guidance, updatedAt };
}
