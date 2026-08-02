import { afterEach, describe, expect, test } from "bun:test";
import {
  decryptSecret,
  encryptSecret,
  generateSecretKey,
  isSecretKeyConfigured,
  SECRET_KEY_ENV,
  SecretKeyError
} from "@/lib/secrets";

const originalKey = process.env[SECRET_KEY_ENV];

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env[SECRET_KEY_ENV];
  } else {
    process.env[SECRET_KEY_ENV] = originalKey;
  }
});

function useFreshKey() {
  const key = generateSecretKey();
  process.env[SECRET_KEY_ENV] = key;

  return key;
}

describe("secrets", () => {
  test("round-trips a credential", () => {
    useFreshKey();

    const stored = encryptSecret("ntn_secret_token");

    expect(stored).not.toContain("ntn_secret_token");
    expect(decryptSecret(stored)).toBe("ntn_secret_token");
  });

  test("produces a different ciphertext each time", () => {
    useFreshKey();

    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  test("passes empty values through untouched", () => {
    useFreshKey();

    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  test("refuses to encrypt without a key", () => {
    delete process.env[SECRET_KEY_ENV];

    expect(isSecretKeyConfigured()).toBe(false);
    expect(() => encryptSecret("token")).toThrow(SecretKeyError);
  });

  test("rejects a key of the wrong length", () => {
    process.env[SECRET_KEY_ENV] = Buffer.from("too short").toString("base64");

    expect(isSecretKeyConfigured()).toBe(false);
    expect(() => encryptSecret("token")).toThrow(SecretKeyError);
  });

  // A rotated key must fail loudly: silently returning "" would send an empty
  // Authorization header to Notion and surface as a confusing 401.
  test("refuses to decrypt a credential written under another key", () => {
    useFreshKey();

    const stored = encryptSecret("token");

    useFreshKey();

    expect(() => decryptSecret(stored)).toThrow(SecretKeyError);
  });

  test("rejects a stored value that is not in the expected format", () => {
    useFreshKey();

    expect(() => decryptSecret("plaintext-token")).toThrow(SecretKeyError);
  });
});
