import { z } from "zod";
import { getClient, getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";
import config from "../config/env";
import { associateAccount, getUserAccounts, getUserCredentials } from "../services/db";

export const ListAccountsSchema = z.object({
  userId: z.string().optional().describe("SaaS User ID to list accounts for"),
});

function normalizeCustomerId(raw: string): string {
  const extracted = raw.includes("/") ? raw.split("/").pop() || raw : raw;
  return extracted.replace(/-/g, "");
}

async function discoverAccountsFromGoogleAds(refreshToken: string, userId?: string): Promise<string[]> {
  const client = getClient();
  const discoveredCustomerIds = new Set<string>();
  const discovery = await client.listAccessibleCustomers(refreshToken);

  for (const resourceName of discovery.resource_names || []) {
    const customerId = normalizeCustomerId(resourceName);
    if (!customerId) continue;

    discoveredCustomerIds.add(customerId);
    if (userId) {
      await associateAccount(userId, customerId);
    }

    // Expand manager accounts into first-level enabled children.
    try {
      const managerCandidate = client.Customer({
        customer_id: customerId,
        refresh_token: refreshToken,
        login_customer_id: customerId,
      });

      const managerCheck = await managerCandidate.query(`
        SELECT customer.manager
        FROM customer
        LIMIT 1
      `);
      const isManager = Boolean(managerCheck?.[0]?.customer?.manager);
      if (!isManager) {
        continue;
      }

      const childRows = await managerCandidate.query(`
        SELECT customer_client.id
        FROM customer_client
        WHERE customer_client.level = 1
      `);

      for (const row of childRows) {
        const childId = String(row?.customer_client?.id || "").trim();
        if (!childId) continue;

        discoveredCustomerIds.add(childId);
        if (userId) {
          await associateAccount(userId, childId);
        }
      }
    } catch (childDiscoveryError: any) {
      logger.warn(
        { err: childDiscoveryError, managerCustomerId: customerId, userId },
        "Skipping manager child-account discovery during listAccounts"
      );
    }
  }

  return Array.from(discoveredCustomerIds)
    .sort()
    .map(id => `customers/${id}`);
}

export async function listAccounts(args: z.infer<typeof ListAccountsSchema> = {}) {
  const { userId } = args;
  logger.info(`Listing accessible accounts${userId ? ` for user ${userId}` : ""}`);

  const linkedAccounts = userId ? await getUserAccounts(userId) : [];
  
  // 1. Get Refresh Token
  let refreshToken = config.GOOGLE_ADS_REFRESH_TOKEN;
  if (userId) {
    const creds = await getUserCredentials(userId);
    if (!creds) {
      throw new Error(`No credentials found for user ${userId}`);
    }
    refreshToken = creds.refreshToken;
  } else if (!refreshToken) {
    throw new Error(
      "GOOGLE_ADS_REFRESH_TOKEN is missing. " +
      "Pass userId (dynamic OAuth mode) or configure single-user env credentials."
    );
  }

  try {
    const discoveredAccounts = await discoverAccountsFromGoogleAds(refreshToken, userId);
    if (discoveredAccounts.length > 0) {
      return discoveredAccounts;
    }
  } catch (error: any) {
    logger.warn(
      { err: error, userId },
      "Live Google Ads account discovery failed; falling back to cached linked accounts"
    );
    if (linkedAccounts.length > 0) {
      return linkedAccounts.map(account => `customers/${account.customerId}`);
    }

    // Fallback logic...
    if (config.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
      const customer = await getCustomer(config.GOOGLE_ADS_LOGIN_CUSTOMER_ID, userId);
      const query = `SELECT customer_client.id FROM customer_client WHERE customer_client.level <= 1`;
      const results = await customer.query(query);
      return results.map((r: any) => `customers/${r.customer_client.id}`);
    }
    throw error;
  }

  if (linkedAccounts.length > 0) {
    return linkedAccounts.map(account => `customers/${account.customerId}`);
  }

  return [];
}
