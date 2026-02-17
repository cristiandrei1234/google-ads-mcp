import { GoogleAdsApi } from 'google-ads-api';
import config from '../../config/env';
import logger from '../../observability/logger';
import { canUseAccount, getUserAccounts, getUserCredentials } from '../db';

let apiInstance: GoogleAdsApi;
const dynamicLoginCustomerIdCache = new Map<string, string>();

function normalizeCustomerId(customerId: string): string {
  return customerId.replace(/-/g, "");
}

function normalizeOptionalCustomerId(customerId?: string | null): string | undefined {
  if (!customerId) return undefined;
  const normalized = normalizeCustomerId(customerId);
  return normalized || undefined;
}

async function resolveDynamicLoginCustomerId(
  api: GoogleAdsApi,
  refreshToken: string,
  targetCustomerId: string,
  userId?: string
): Promise<string | undefined> {
  const explicitLoginCustomerId = normalizeOptionalCustomerId(config.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (explicitLoginCustomerId) {
    return explicitLoginCustomerId;
  }

  if (!userId) {
    return undefined;
  }

  const cachedLoginCustomerId = dynamicLoginCustomerIdCache.get(userId);
  if (cachedLoginCustomerId) {
    return cachedLoginCustomerId;
  }

  const linkedAccounts = await getUserAccounts(userId);
  const selectedAccounts = linkedAccounts.filter(account => account.isDefault).map(account => account.customerId);
  const candidateLoginIds = [
    ...new Set(
      [
        ...selectedAccounts,
        targetCustomerId,
        ...linkedAccounts.map(account => account.customerId),
      ]
        .filter(Boolean)
        .map(normalizeCustomerId)
    ),
  ];

  for (const candidateLoginId of candidateLoginIds) {
    try {
      const customer = api.Customer({
        customer_id: candidateLoginId,
        refresh_token: refreshToken,
        login_customer_id: candidateLoginId,
      });
      const rows = await customer.query(`
        SELECT customer.manager
        FROM customer
        LIMIT 1
      `);
      const isManager = Boolean(rows?.[0]?.customer?.manager);
      if (isManager) {
        dynamicLoginCustomerIdCache.set(userId, candidateLoginId);
        return candidateLoginId;
      }
    } catch {
      // Try next candidate.
    }
  }

  const fallbackLoginId = candidateLoginIds[0];
  if (fallbackLoginId) {
    dynamicLoginCustomerIdCache.set(userId, fallbackLoginId);
    return fallbackLoginId;
  }

  return undefined;
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

export async function getCustomer(customerId: string, userId?: string) {
  const api = getClient();
  const normalizedCustomerId = normalizeCustomerId(customerId);
  let refreshToken = config.GOOGLE_ADS_REFRESH_TOKEN;

  if (userId) {
    const creds = await getUserCredentials(userId);
    if (!creds) {
      throw new Error(`No credentials found for user ${userId}. Please connect your account first.`);
    }

    const accountAllowed = await canUseAccount(userId, normalizedCustomerId);
    if (!accountAllowed) {
      throw new Error(
        `Customer ${normalizedCustomerId} is not linked or not selected for user ${userId}. ` +
        `Use the auth API to link/select accounts first.`
      );
    }

    refreshToken = creds.refreshToken;
    logger.info(`Using database credentials for user ${userId}`);
  } else {
    if (!refreshToken) {
      throw new Error(
        "GOOGLE_ADS_REFRESH_TOKEN is missing. " +
        "Use per-user OAuth login (recommended) or set GOOGLE_ADS_REFRESH_TOKEN for single-user mode."
      );
    }
    logger.info(`Using default environment credentials`);
  }

  if (!refreshToken) {
    throw new Error("Refresh token could not be resolved for this request.");
  }

  const loginCustomerId = await resolveDynamicLoginCustomerId(
    api,
    refreshToken,
    normalizedCustomerId,
    userId
  );

  return api.Customer({
    customer_id: normalizedCustomerId,
    refresh_token: refreshToken,
    login_customer_id: loginCustomerId,
  });
}
