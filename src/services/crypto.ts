import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Authenticated symmetric encryption for secrets at rest (refresh tokens).
 *
 * Algorithm: AES-256-GCM. Each ciphertext is self-describing:
 *
 *   "v1:" + base64( iv(12 bytes) || authTag(16 bytes) || ciphertext )
 *
 * The version prefix lets us rotate the scheme later without ambiguity.
 * GCM gives us confidentiality AND integrity — a tampered payload fails
 * `decryptSecret` instead of silently returning garbage.
 */

const SCHEME_V1 = "v1"; // legacy: no AAD
const SCHEME_V2 = "v2"; // AAD-bound to the storage row
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const AUTH_TAG_BYTES = 16;

/** Distinct failure modes so callers can react precisely (never a bare throw). */
export type CryptoErrorKind =
  | "invalid_key"
  | "malformed_payload"
  | "unsupported_version"
  | "auth_failed";

export class CryptoError extends Error {
  public readonly kind: CryptoErrorKind;

  constructor(kind: CryptoErrorKind, message: string) {
    super(message);
    this.name = "CryptoError";
    this.kind = kind;
  }
}

/**
 * Decode and validate a base64-encoded 32-byte encryption key.
 *
 * @param rawBase64 The key material as a base64 string (e.g. from env).
 * @returns A 32-byte key buffer.
 * @throws {CryptoError} `invalid_key` if missing, not base64, or wrong length.
 */
export function loadEncryptionKey(rawBase64: string | undefined): Buffer {
  if (!rawBase64 || rawBase64.trim().length === 0) {
    throw new CryptoError("invalid_key", "Encryption key is missing.");
  }

  const trimmed = rawBase64.trim();
  // Buffer.from(..., "base64") never throws — it silently drops invalid chars.
  // Validate the alphabet explicitly so a typo'd key can't slip through.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new CryptoError("invalid_key", "Encryption key is not valid base64.");
  }
  const key = Buffer.from(trimmed, "base64");

  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      "invalid_key",
      `Encryption key must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: openssl rand -base64 32`
    );
  }

  return key;
}

/**
 * Encrypt a UTF-8 plaintext secret. Output is safe to store as text.
 *
 * @param plaintext The secret to protect (e.g. a Google Ads refresh token).
 * @param key A 32-byte key from {@link loadEncryptionKey}.
 * @param aad Optional Additional Authenticated Data binding the ciphertext to
 *   its storage context (e.g. `${organizationId}:${mccCustomerId}`). When given,
 *   a "v2" payload is produced and the same AAD is required to decrypt — so a
 *   ciphertext copied into a different row fails authentication.
 * @returns A versioned, base64-wrapped ciphertext string.
 */
export function encryptSecret(plaintext: string, key: Buffer, aad?: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad !== undefined) {
    cipher.setAAD(Buffer.from(aad, "utf8"));
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, authTag, ciphertext]).toString("base64");
  return `${aad !== undefined ? SCHEME_V2 : SCHEME_V1}:${packed}`;
}

/**
 * Decrypt a payload produced by {@link encryptSecret} with a single key.
 *
 * @param payload The versioned, base64-wrapped ciphertext.
 * @param key The 32-byte key to try.
 * @param aad The AAD used at encryption time (required for v2 payloads).
 * @throws {CryptoError} `malformed_payload`, `unsupported_version`, or `auth_failed`.
 */
export function decryptSecret(payload: string, key: Buffer, aad?: string): string {
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex === -1) {
    throw new CryptoError("malformed_payload", "Ciphertext is missing a version prefix.");
  }

  const version = payload.slice(0, separatorIndex);
  if (version !== SCHEME_V1 && version !== SCHEME_V2) {
    throw new CryptoError("unsupported_version", `Unsupported ciphertext version '${version}'.`);
  }

  const packed = Buffer.from(payload.slice(separatorIndex + 1), "base64");
  if (packed.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new CryptoError("malformed_payload", "Ciphertext is too short to be valid.");
  }

  const iv = packed.subarray(0, IV_BYTES);
  const authTag = packed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  // v2 binds to AAD; v1 ignores it (legacy ciphertexts predate AAD).
  if (version === SCHEME_V2) {
    decipher.setAAD(Buffer.from(aad ?? "", "utf8"));
  }
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM tag mismatch: tampered payload, wrong key, or wrong AAD. Never leak which.
    throw new CryptoError("auth_failed", "Failed to decrypt secret (integrity check failed).");
  }
}

/**
 * Decrypt by trying each key in order (key rotation: primary first, then
 * previous keys). Lets you rotate TOKEN_ENCRYPTION_KEY without bricking tokens
 * encrypted under an older key — re-encrypt them with the primary on next write.
 *
 * @throws {CryptoError} `auth_failed` if no key succeeds (or the last parse error).
 */
export function decryptWithKeys(payload: string, keys: Buffer[], aad?: string): string {
  let lastError: unknown;
  for (const key of keys) {
    try {
      return decryptSecret(payload, key, aad);
    } catch (error) {
      lastError = error;
      // Only keep trying other keys on auth failure; structural errors are fatal.
      if (error instanceof CryptoError && error.kind !== "auth_failed") {
        throw error;
      }
    }
  }
  if (lastError instanceof CryptoError) {
    throw lastError;
  }
  throw new CryptoError("auth_failed", "Failed to decrypt secret with any available key.");
}

export interface EncryptionKeys {
  /** Key used for new encryptions. */
  primary: Buffer;
  /** All keys to try when decrypting (primary first, then previous keys). */
  all: Buffer[];
}

/**
 * Load the primary key plus any comma-separated previous keys (for rotation).
 * @throws {CryptoError} `invalid_key` if any key is missing/malformed.
 */
export function loadEncryptionKeys(primaryBase64: string | undefined, previousBase64?: string): EncryptionKeys {
  const primary = loadEncryptionKey(primaryBase64);
  const previous = (previousBase64 ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => loadEncryptionKey(s));
  return { primary, all: [primary, ...previous] };
}

/**
 * Constant-time equality for two secrets of the same byte length.
 * Use when comparing tokens/keys to avoid timing side channels.
 */
export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
