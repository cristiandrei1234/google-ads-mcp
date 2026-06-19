import { OAuth2Client } from "google-auth-library";
import { getClient } from "./client.js";
import config from "../../config/env.js";
import { normalizeCustomerId } from "./resourceNames.js";

/**
 * Google Ads OAuth "connect" flow for multi-tenant onboarding: a tenant (agency
 * owner or employee) authorizes their Google Ads account, and we capture an
 * `adwords`-scoped refresh token to store (encrypted) as a GoogleAdsConnection.
 */

const ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords";

export function createOAuthClient(redirectUri: string): OAuth2Client {
  return new OAuth2Client(config.GOOGLE_ADS_CLIENT_ID, config.GOOGLE_ADS_CLIENT_SECRET, redirectUri);
}

/** Build the Google consent URL (offline access, forced consent for a refresh token). */
export function getConsentUrl(redirectUri: string, state: string): string {
  return createOAuthClient(redirectUri).generateAuthUrl({
    access_type: "offline",
    scope: ADWORDS_SCOPE,
    prompt: "consent",
    state,
  });
}

/** Exchange the authorization code for a refresh token. */
export async function exchangeCodeForRefreshToken(redirectUri: string, code: string): Promise<string> {
  const { tokens } = await createOAuthClient(redirectUri).getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke prior access at " +
        "https://myaccount.google.com/permissions and reconnect."
    );
  }
  return tokens.refresh_token;
}

export interface DetectedLoginCustomer {
  /** The customer id to use as login_customer_id (prefers a manager/MCC). */
  mccCustomerId: string;
  /** All customer ids the refresh token can access directly. */
  accessible: string[];
}

/**
 * Determine the login customer id for a freshly-authorized refresh token. Prefers
 * a manager (MCC) account; falls back to the first accessible account otherwise.
 */
export async function detectLoginCustomerId(refreshToken: string): Promise<DetectedLoginCustomer> {
  const client = getClient();
  const discovery = await client.listAccessibleCustomers(refreshToken);
  const accessible = (discovery.resource_names || [])
    // resource_names are "customers/<id>"; split always yields a last segment.
    .map((rn) => normalizeCustomerId(rn.split("/").pop()!))
    .filter((id): id is string => Boolean(id));

  if (accessible.length === 0) {
    throw new Error("This Google account has no accessible Google Ads accounts.");
  }

  for (const id of accessible) {
    try {
      const customer = client.Customer({ customer_id: id, refresh_token: refreshToken, login_customer_id: id });
      const rows = await customer.query("SELECT customer.manager FROM customer LIMIT 1");
      if (rows?.[0]?.customer?.manager) {
        return { mccCustomerId: id, accessible };
      }
    } catch {
      // Skip accounts we cannot introspect; fall through to the default.
    }
  }
  return { mccCustomerId: accessible[0], accessible };
}

/**
 * List the client account ids reachable under a connection's MCC (down to two
 * levels), for assigning grants. Uses the connection's own login customer id.
 */
export async function listClientAccounts(refreshToken: string, mccCustomerId: string): Promise<string[]> {
  const client = getClient();
  const customer = client.Customer({
    customer_id: mccCustomerId,
    refresh_token: refreshToken,
    login_customer_id: mccCustomerId,
  });
  const rows = await customer.query(
    "SELECT customer_client.id FROM customer_client WHERE customer_client.level <= 2"
  );
  const ids = new Set<string>([mccCustomerId]);
  for (const row of rows ?? []) {
    const id = String(row?.customer_client?.id ?? "").trim();
    if (id) ids.add(id);
  }
  return [...ids].sort();
}
