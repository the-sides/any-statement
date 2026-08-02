import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let client: Sql | null = null;

/**
 * Lazy so `next build` does not need DATABASE_URL — the connection is only
 * established the first time a route actually touches the ledger.
 */
export function getSql(): Sql {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Provision the Neon integration and run `vercel env pull`."
      );
    }

    client = neon(connectionString);
  }

  return client;
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

/** Neon returns numeric/decimal columns as strings to avoid precision loss. */
export function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

export function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = toNumber(value, Number.NaN);

  return Number.isFinite(parsed) ? parsed : null;
}

export function toText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
