import { getSql } from "@/lib/db";
import type { NotionConnection } from "@/lib/notion";
import { decryptSecret, encryptSecret, SecretKeyError } from "@/lib/secrets";

/**
 * Per-user Notion credentials. Each user connects their own workspace, so
 * nothing here falls back to `NOTION_*` environment variables: an env fallback
 * would quietly save one user's expenses into the deployment owner's Notion.
 */
export type NotionConnectionStatus = {
  hasApiKey: boolean;
  dataSourceId: string;
  categoryDataSourceId: string;
  updatedAt: string;
  /** True once the connection has everything a save needs. */
  ready: boolean;
};

export type NotionConnectionInput = {
  /** `undefined` keeps the stored token; `""` clears it. */
  apiKey?: string;
  dataSourceId: string;
  categoryDataSourceId: string;
};

type ConnectionRow = {
  api_key_encrypted: unknown;
  data_source_id: unknown;
  category_data_source_id: unknown;
  updated_at: unknown;
};

const EMPTY_CONNECTION: NotionConnection = {
  apiKey: "",
  dataSourceId: "",
  categoryDataSourceId: ""
};

export async function readNotionConnection(
  userId: string
): Promise<NotionConnection> {
  const row = await readRow(userId);

  if (!row) {
    return EMPTY_CONNECTION;
  }

  return {
    apiKey: decryptSecret(text(row.api_key_encrypted)),
    dataSourceId: text(row.data_source_id),
    categoryDataSourceId: text(row.category_data_source_id)
  };
}

/**
 * The shape the UI is allowed to see: whether a token is stored, never the
 * token itself.
 */
export async function readNotionConnectionStatus(
  userId: string
): Promise<NotionConnectionStatus> {
  const row = await readRow(userId);

  if (!row) {
    return {
      hasApiKey: false,
      dataSourceId: "",
      categoryDataSourceId: "",
      updatedAt: "",
      ready: false
    };
  }

  return toStatus({
    hasApiKey: Boolean(text(row.api_key_encrypted)),
    dataSourceId: text(row.data_source_id),
    categoryDataSourceId: text(row.category_data_source_id),
    updatedAt: text(row.updated_at)
  });
}

export async function writeNotionConnection(
  userId: string,
  input: NotionConnectionInput
): Promise<NotionConnectionStatus> {
  const existing = await readRow(userId);
  const apiKeyEncrypted =
    input.apiKey === undefined
      ? text(existing?.api_key_encrypted)
      : encryptSecret(input.apiKey.trim());
  const dataSourceId = input.dataSourceId.trim();
  const categoryDataSourceId = input.categoryDataSourceId.trim();
  const updatedAt = new Date().toISOString();

  await getSql()`
    insert into notion_connections (
      user_id, api_key_encrypted, data_source_id, category_data_source_id,
      updated_at
    ) values (
      ${userId}, ${apiKeyEncrypted}, ${dataSourceId}, ${categoryDataSourceId},
      ${updatedAt}
    )
    on conflict (user_id) do update
      set api_key_encrypted = excluded.api_key_encrypted,
          data_source_id = excluded.data_source_id,
          category_data_source_id = excluded.category_data_source_id,
          updated_at = excluded.updated_at
  `;

  return toStatus({
    hasApiKey: Boolean(apiKeyEncrypted),
    dataSourceId,
    categoryDataSourceId,
    updatedAt
  });
}

export async function deleteNotionConnection(userId: string) {
  await getSql()`delete from notion_connections where user_id = ${userId}`;
}

/**
 * Reads a connection for a code path that cannot proceed without one, turning
 * an unreadable stored token into the same shape as an absent one so callers
 * only handle "not connected".
 */
export async function readUsableNotionConnection(userId: string) {
  try {
    return await readNotionConnection(userId);
  } catch (error) {
    if (error instanceof SecretKeyError) {
      return EMPTY_CONNECTION;
    }

    throw error;
  }
}

async function readRow(userId: string) {
  const rows = (await getSql()`
    select api_key_encrypted, data_source_id, category_data_source_id, updated_at
    from notion_connections
    where user_id = ${userId}
  `) as ConnectionRow[];

  return rows[0];
}

function toStatus(
  status: Omit<NotionConnectionStatus, "ready">
): NotionConnectionStatus {
  return {
    ...status,
    ready: status.hasApiKey && Boolean(status.dataSourceId)
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
