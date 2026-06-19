import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring `state` for the Google Ads OAuth connect flow.
 *
 * The state round-trips through Google's consent screen, so it must be tamper-
 * proof (an attacker must not be able to forge which member/org a returned code
 * is bound to) and short-lived. We HMAC a compact JSON payload with the Better
 * Auth secret — no DB row needed.
 */

export interface ConnectState {
  memberId: string;
  orgId: string;
  nonce: string;
  /** Expiry epoch ms. */
  exp: number;
}

const DEFAULT_TTL_MS = 10 * 60_000; // 10 minutes

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export interface SignOptions {
  now?: number;
  ttlMs?: number;
  nonce?: string;
}

/** Produce a signed state token binding the OAuth flow to (member, org). */
export function signConnectState(
  input: { memberId: string; orgId: string },
  secret: string,
  options: SignOptions = {}
): string {
  const now = options.now ?? Date.now();
  const state: ConnectState = {
    memberId: input.memberId,
    orgId: input.orgId,
    nonce: options.nonce ?? randomBytes(16).toString("base64url"),
    exp: now + (options.ttlMs ?? DEFAULT_TTL_MS),
  };
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/**
 * Verify and decode a state token. Returns the payload, or null if the token is
 * malformed, the signature does not match, or it has expired.
 */
export function verifyConnectState(token: string, secret: string, now: number = Date.now()): ConnectState | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const expected = sign(body, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let state: ConnectState;
  try {
    state = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof state.exp !== "number" || state.exp < now) {
    return null;
  }
  return state;
}
