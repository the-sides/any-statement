import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for third-party credentials the ledger stores on a user's behalf.
 *
 * A Notion integration token is not this app's secret to keep in the clear: it
 * belongs to the user who pasted it, and one shared database row leaking would
 * otherwise hand over their whole workspace. Everything here is deliberately
 * fail-closed -- without a key configured, storing a credential errors instead
 * of quietly writing readable text.
 */
export const SECRET_KEY_ENV = "STATEMENT_LEDGER_SECRET_KEY";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT_VERSION = "v1";

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyError";
  }
}

export function isSecretKeyConfigured() {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

/** Generates a key in the format `STATEMENT_LEDGER_SECRET_KEY` expects. */
export function generateSecretKey() {
  return randomBytes(KEY_BYTES).toString("base64");
}

export function encryptSecret(plaintext: string) {
  if (!plaintext) {
    return "";
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, readKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64")
  ].join(".");
}

/**
 * Throws on a value that does not decrypt: a credential that cannot be read
 * back is a configuration problem worth surfacing, not an empty string to carry
 * silently into a Notion request that will fail with a confusing 401.
 */
export function decryptSecret(stored: string) {
  if (!stored) {
    return "";
  }

  const [version, iv, authTag, ciphertext] = stored.split(".");

  if (version !== FORMAT_VERSION || !iv || !authTag || !ciphertext) {
    throw new SecretKeyError("The stored credential is not in a known format.");
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      readKey(),
      Buffer.from(iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof SecretKeyError) {
      throw error;
    }

    // Authentication failure means the key changed or the row was tampered
    // with. Either way the stored value is unusable.
    throw new SecretKeyError(
      `The stored credential could not be decrypted with the current ${SECRET_KEY_ENV}.`
    );
  }
}

function readKey() {
  const raw = process.env[SECRET_KEY_ENV];

  if (!raw) {
    throw new SecretKeyError(
      `${SECRET_KEY_ENV} is not set. Generate one with \`bun run scripts/generate-secret-key.ts\` before storing credentials.`
    );
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== KEY_BYTES) {
    throw new SecretKeyError(
      `${SECRET_KEY_ENV} must be ${KEY_BYTES} base64-encoded bytes.`
    );
  }

  return key;
}
