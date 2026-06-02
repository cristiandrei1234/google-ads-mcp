import { google } from 'googleapis';
import config from '../../config/env.js';
import logger from '../../observability/logger.js';
import { getConnectionForCustomer } from '../db.js';
import { getIdentity } from '../../auth/identityContext.js';

const authClientCache = new Map<string, any>();

function buildAuthClient(refreshToken: string) {
  const client = new google.auth.OAuth2(
    config.GOOGLE_ADS_CLIENT_ID,
    config.GOOGLE_ADS_CLIENT_SECRET
  );
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Resolve a Merchant Center auth client. In multi-tenant mode the caller MUST
 * hold an AccountGrant for `customerId` (the linked Google Ads account); the
 * connection that grant resolves to provides the OAuth token, so Merchant Center
 * access is gated by the same per-account grant as Ads access (no connections[0]
 * fallback, no cross-tenant data access). Single-operator/stdio uses env.
 */
export async function getMerchantAuth(customerId?: string) {
  let refreshToken = config.GOOGLE_ADS_REFRESH_TOKEN;
  let cacheKey = "env";

  const identity = getIdentity();
  if (identity?.userId) {
    if (!customerId) {
      throw new Error("A customerId you hold a grant for is required to access Merchant Center.");
    }
    const resolved = await getConnectionForCustomer(identity.userId, customerId, identity.orgId);
    if (!resolved) {
      throw new Error(`No grant for customer ${customerId}; Merchant Center access denied.`);
    }
    refreshToken = resolved.refreshToken;
    cacheKey = `connection:${resolved.connectionId}`;
  }

  if (!refreshToken) {
    throw new Error(
      "GOOGLE_ADS_REFRESH_TOKEN is missing. " +
      "Pass a granted customerId (multi-tenant) or configure single-operator env credentials."
    );
  }

  if (!authClientCache.has(cacheKey)) {
    authClientCache.set(cacheKey, buildAuthClient(refreshToken));
    logger.info(`Merchant Center (Content API) auth client initialized for ${cacheKey}`);
  }

  return authClientCache.get(cacheKey);
}

export async function getContentService(customerId?: string) {
  const auth = await getMerchantAuth(customerId);
  return google.content({
    version: 'v2.1',
    auth: auth,
  });
}
