import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  decryptWithKeys,
  loadEncryptionKey,
  loadEncryptionKeys,
  secretsEqual,
  CryptoError,
} from "./crypto.js";

const key = randomBytes(32);
const keyBase64 = key.toString("base64");

describe("loadEncryptionKey", () => {
  it("accepts a valid base64 32-byte key", () => {
    expect(loadEncryptionKey(keyBase64).length).toBe(32);
  });

  it("rejects a missing key", () => {
    expect(() => loadEncryptionKey(undefined)).toThrow(CryptoError);
    expect(() => loadEncryptionKey("")).toThrow(/missing/i);
  });

  it("rejects a key of the wrong length", () => {
    const short = randomBytes(16).toString("base64");
    expect(() => loadEncryptionKey(short)).toThrow(/32 bytes/);
  });

  it("rejects a key with invalid base64 characters", () => {
    expect(() => loadEncryptionKey("not valid base64 !!! @@@")).toThrow(/base64/i);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", () => {
    const plaintext = "1//0gRefreshTokenExample_abc-123";
    const encrypted = encryptSecret(plaintext, key);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted, key)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same", key);
    const b = encryptSecret("same", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("same");
    expect(decryptSecret(b, key)).toBe("same");
  });

  it("round-trips unicode and empty strings", () => {
    for (const value of ["", "ünîcödé €", "a".repeat(5000)]) {
      expect(decryptSecret(encryptSecret(value, key), key)).toBe(value);
    }
  });

  it("fails authentication with a wrong key", () => {
    const encrypted = encryptSecret("secret", key);
    const wrongKey = randomBytes(32);
    expect(() => decryptSecret(encrypted, wrongKey)).toThrow(/integrity/i);
  });

  it("detects tampering with the ciphertext", () => {
    const encrypted = encryptSecret("secret", key);
    const packed = Buffer.from(encrypted.slice(3), "base64");
    packed[packed.length - 1] ^= 0x01; // flip a bit in the ciphertext
    const tampered = `v1:${packed.toString("base64")}`;
    expect(() => decryptSecret(tampered, key)).toThrow(CryptoError);
  });

  it("rejects an unknown version prefix", () => {
    const encrypted = encryptSecret("secret", key);
    const swapped = `v9:${encrypted.slice(3)}`;
    expect(() => decryptSecret(swapped, key)).toThrow(/version/i);
  });

  it("rejects a payload with no version prefix", () => {
    expect(() => decryptSecret("not-a-valid-payload", key)).toThrow(/version prefix/i);
  });

  it("rejects a payload too short to hold iv + auth tag", () => {
    // Valid version prefix, but the base64 body decodes to < 28 bytes.
    const tooShort = `v1:${Buffer.from("tiny").toString("base64")}`;
    expect(() => decryptSecret(tooShort, key)).toThrow(/too short/i);
    try {
      decryptSecret(tooShort, key);
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError);
      expect((error as CryptoError).kind).toBe("malformed_payload");
    }
  });
});

describe("AAD binding (v2)", () => {
  it("round-trips with matching AAD and emits a v2 payload", () => {
    const enc = encryptSecret("tok", key, "conn:org1:999");
    expect(enc.startsWith("v2:")).toBe(true);
    expect(decryptSecret(enc, key, "conn:org1:999")).toBe("tok");
  });

  it("fails when the AAD differs (ciphertext copied to another row)", () => {
    const enc = encryptSecret("tok", key, "conn:org1:999");
    expect(() => decryptSecret(enc, key, "conn:org2:999")).toThrow(/integrity/i);
    expect(() => decryptSecret(enc, key)).toThrow(/integrity/i); // missing AAD
  });

  it("still decrypts legacy v1 (no AAD) payloads", () => {
    const v1 = encryptSecret("legacy", key); // no aad -> v1
    expect(v1.startsWith("v1:")).toBe(true);
    expect(decryptSecret(v1, key)).toBe("legacy");
  });
});

describe("key rotation (decryptWithKeys / loadEncryptionKeys)", () => {
  it("decrypts a payload encrypted under a previous key", () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const enc = encryptSecret("rotate-me", oldKey, "aad");
    // primary=newKey first (fails), then previous=oldKey (succeeds)
    expect(decryptWithKeys(enc, [newKey, oldKey], "aad")).toBe("rotate-me");
  });

  it("throws auth_failed when no key matches", () => {
    const enc = encryptSecret("x", randomBytes(32), "aad");
    expect(() => decryptWithKeys(enc, [randomBytes(32)], "aad")).toThrow(CryptoError);
  });

  it("rethrows a non-auth structural error instead of trying more keys", () => {
    // A malformed payload yields a CryptoError whose kind !== 'auth_failed',
    // which must abort the key loop immediately (decryptWithKeys line 156-157).
    const malformed = `v9:${Buffer.from("whatever").toString("base64")}`;
    try {
      decryptWithKeys(malformed, [randomBytes(32), randomBytes(32)]);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError);
      expect((error as CryptoError).kind).toBe("unsupported_version");
    }
  });

  it("throws auth_failed when the key list is empty", () => {
    // No keys -> loop body never runs -> lastError stays undefined -> final throw (line 164).
    const enc = encryptSecret("x", randomBytes(32));
    try {
      decryptWithKeys(enc, []);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError);
      expect((error as CryptoError).kind).toBe("auth_failed");
      expect((error as CryptoError).message).toMatch(/any available key/i);
    }
  });

  it("loadEncryptionKeys parses primary + comma-separated previous keys", () => {
    const a = randomBytes(32).toString("base64");
    const b = randomBytes(32).toString("base64");
    const keys = loadEncryptionKeys(a, `${b}`);
    expect(keys.all.length).toBe(2);
    expect(keys.primary.equals(Buffer.from(a, "base64"))).toBe(true);
  });

  it("loadEncryptionKeys works with only a primary key (previous omitted)", () => {
    // Exercises the `previousBase64 ?? ""` nullish branch (line 180).
    const a = randomBytes(32).toString("base64");
    const keys = loadEncryptionKeys(a);
    expect(keys.all.length).toBe(1);
    expect(keys.all[0].equals(keys.primary)).toBe(true);
  });
});

describe("secretsEqual", () => {
  it("is true for equal strings and false otherwise", () => {
    expect(secretsEqual("abc", "abc")).toBe(true);
    expect(secretsEqual("abc", "abd")).toBe(false);
    expect(secretsEqual("abc", "abcd")).toBe(false);
  });
});
