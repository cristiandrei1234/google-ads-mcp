import { z } from "zod";
import { getClient } from "../services/google-ads/client.js";
import logger from "../observability/logger.js";
import config from "../config/env.js";
import { listConnectionsForUser, reachableCustomerIds } from "../services/db.js";
import { getIdentity } from "../auth/identityContext.js";

export const ListAccountsSchema = z.object({});

function normalizeCustomerId(raw: string): string {
  const extracted = raw.includes("/") ? raw.split("/").pop() || raw : raw;
  return extracted.replace(/-/g, "");
}

/** Discover Google-accessible customers (with first-level manager children). */
async function discoverAccountsFromGoogleAds(refreshToken: string): Promise<string[]> {
  const client = getClient();
  const discoveredCustomerIds = new Set<string>();
  const discovery = await client.listAccessibleCustomers(refreshToken);

  for (const resourceName of discovery.resource_names || []) {
    const customerId = normalizeCustomerId(resourceName);
    if (!customerId) continue;
    discoveredCustomerIds.add(customerId);

    // Expand manager accounts into first-level enabled children.
    try {
      const managerCandidate = client.Customer({
        customer_id: customerId,
        refresh_token: refreshToken,
        login_customer_id: customerId,
      });

      const managerCheck = await managerCandidate.query(
        `SELECT customer.manager FROM customer LIMIT 1`
      );
      const isManager = Boolean(managerCheck?.[0]?.customer?.manager);
      if (!isManager) continue;

      const childRows = await managerCandidate.query(
        `SELECT customer_client.id FROM customer_client WHERE customer_client.level = 1`
      );
      for (const row of childRows) {
        const childId = String(row?.customer_client?.id || "").trim();
        if (childId) discoveredCustomerIds.add(childId);
      }
    } catch (childDiscoveryError: any) {
      logger.warn(
        { err: childDiscoveryError, managerCustomerId: customerId },
        "Skipping manager child-account discovery during listAccounts"
      );
    }
  }

  return Array.from(discoveredCustomerIds)
    .sort()
    .map((id) => `customers/${id}`);
}

/**
 * List accessible Google Ads accounts.
 *
 * - userId mode: discover via the user's connection refresh token(s); on
 *   failure, fall back to the accounts the user has been granted.
 * - env mode: discover via GOOGLE_ADS_REFRESH_TOKEN.
 */
export async function listAccounts(_args: z.infer<typeof ListAccountsSchema> = {}) {
  // Identity comes from the authenticated session (multi-tenant) or env (stdio).
  const userId = getIdentity()?.userId;
  logger.info(`Listing accessible accounts${userId ? ` for user ${userId}` : ""}`);

  if (userId) {
    const orgId = getIdentity()?.orgId;
    // Grants are the authoritative scope. Discovery may only NARROW this set,
    // never reveal accounts the user has no grant for.
    const granted = new Set(await reachableCustomerIds(userId, orgId));
    const connections = await listConnectionsForUser(userId, orgId);
    const discovered = new Set<string>();
    for (const connection of connections) {
      try {
        for (const rn of await discoverAccountsFromGoogleAds(connection.refreshToken)) {
          discovered.add(normalizeCustomerId(rn));
        }
      } catch (error: any) {
        logger.warn(
          { err: error, userId, connectionId: connection.connectionId },
          "Account discovery failed for connection; using grants only"
        );
      }
    }
    const allowed = discovered.size > 0
      ? [...granted].filter((id) => discovered.has(id))
      : [...granted];
    return allowed.sort().map((id) => `customers/${id}`);
  }

  const refreshToken = config.GOOGLE_ADS_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      "GOOGLE_ADS_REFRESH_TOKEN is missing. " +
      "Pass userId (multi-tenant mode) or configure single-operator env credentials."
    );
  }
  return discoverAccountsFromGoogleAds(refreshToken);
}
