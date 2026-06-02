import { normalizeCustomerId } from "../services/google-ads/resourceNames.js";

/**
 * Guard against acting on a resourceName that belongs to a different customer
 * than the one the caller is authorized for. Tools that accept a full Google
 * Ads `resourceName` (e.g. customers/{id}/offlineUserDataJobs/{jobId}) are
 * grant-checked only on their `customerId` arg; without this check a caller
 * could pass a resourceName under a customer they do NOT hold a grant for.
 */
export function assertResourceBelongsToCustomer(resourceName: string, customerId: string): void {
  const match = /^customers\/(\d+)\//.exec(resourceName);
  const resourceCustomerId = match?.[1];
  const normalized = normalizeCustomerId(customerId);
  if (!resourceCustomerId || resourceCustomerId !== normalized) {
    throw new Error(
      `resourceName '${resourceName}' does not belong to the authorized customer ${normalized}.`
    );
  }
}
