import { GoogleAdsApi } from 'google-ads-api';
import config from '../../config/env.js';
import logger from '../../observability/logger.js';
import { getConnectionForCustomer } from '../db.js';
import { getIdentity } from '../../auth/identityContext.js';
import { normalizeCustomerId } from './resourceNames.js';

let apiInstance: GoogleAdsApi;

function normalizeOptionalCustomerId(customerId?: string | null): string | undefined {
  if (!customerId) return undefined;
  const normalized = normalizeCustomerId(customerId);
  return normalized || undefined;
}

export function getClient(): GoogleAdsApi {
  if (!apiInstance) {
    if (!config.GOOGLE_ADS_CLIENT_ID || !config.GOOGLE_ADS_CLIENT_SECRET || !config.GOOGLE_ADS_DEVELOPER_TOKEN) {
      throw new Error('Missing Google Ads API credentials.');
    }
    apiInstance = new GoogleAdsApi({
      client_id: config.GOOGLE_ADS_CLIENT_ID,
      client_secret: config.GOOGLE_ADS_CLIENT_SECRET,
      developer_token: config.GOOGLE_ADS_DEVELOPER_TOKEN,
    });

    const mask = (s: string) => s.substring(0, 4) + "..." + s.substring(s.length - 4);
    logger.info(`Google Ads API client initialized with Client ID: ${mask(config.GOOGLE_ADS_CLIENT_ID)}`);
  }
  return apiInstance;
}

/**
 * Build a Google Ads Customer client for a target account.
 *
 * Multi-tenant mode (userId given): the user must hold an AccountGrant for the
 * customer. The owning connection's MCC is used as login_customer_id and its
 * refresh token (decrypted in memory) authenticates the call.
 *
 * Single-operator fallback (no userId): uses GOOGLE_ADS_REFRESH_TOKEN and the
 * optional GOOGLE_ADS_LOGIN_CUSTOMER_ID from the environment.
 *
 * SECURITY: the authenticated identity (AsyncLocalStorage) is authoritative.
 * Any caller-supplied `userId` argument is IGNORED so a client cannot act as
 * another tenant by passing someone else's id. The `_ignoredUserId` parameter
 * is retained only for call-site compatibility during the transition.
 */
export async function getCustomer(customerId: string, _ignoredUserId?: string) {
  const api = getClient();
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const userId = getIdentity()?.userId;

  if (userId) {
    const resolved = await getConnectionForCustomer(userId, normalizedCustomerId, getIdentity()?.orgId);
    if (!resolved) {
      throw new Error(
        `User ${userId} has no grant for customer ${normalizedCustomerId}. ` +
        `An admin must grant access to this account first.`
      );
    }
    logger.info(`Resolved connection ${resolved.connectionId} (${resolved.accessLevel}) for user ${userId}`);
    return api.Customer({
      customer_id: normalizedCustomerId,
      refresh_token: resolved.refreshToken,
      login_customer_id: resolved.mccCustomerId,
    });
  }

  const refreshToken = config.GOOGLE_ADS_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      "GOOGLE_ADS_REFRESH_TOKEN is missing. " +
      "Pass a userId (multi-tenant mode) or set GOOGLE_ADS_REFRESH_TOKEN for single-operator mode."
    );
  }

  return api.Customer({
    customer_id: normalizedCustomerId,
    refresh_token: refreshToken,
    login_customer_id: normalizeOptionalCustomerId(config.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
  });
}
