/**
 * Shared Google Ads resource-name / identifier helpers.
 *
 * Before this module these five functions were copy-pasted across ~17 tool
 * files (and a per-collection `to<Collection>ResourceName` wrapper was
 * re-implemented 40+ times). They are pure, dependency-free string utilities,
 * so they belong in one place. Tool files import from here instead of
 * re-declaring them.
 */

/** Strip the dashes from a customer ID (e.g. "123-456-7890" -> "1234567890"). */
export function normalizeCustomerId(customerId: string): string {
  return customerId.replace(/-/g, "");
}

/** Escape a value for safe interpolation inside a single-quoted GAQL string literal. */
export function escapeGaqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Pull the trailing id out of a resource name for the given collection,
 * falling back to the trimmed input when it is already a bare id.
 *
 * @example extractResourceId("customers/123/campaigns/456", "campaigns") -> "456"
 */
export function extractResourceId(value: string, collection: string): string {
  const match = value.trim().match(new RegExp(`/${collection}/([^/]+)$`));
  return match?.[1] || value.trim();
}

/**
 * Like {@link extractResourceId} but guarantees a purely-numeric id, throwing
 * when the input contains no digits.
 */
export function normalizeNumericId(value: string, collection: string): string {
  const normalized = extractResourceId(value, collection).replace(/[^0-9]/g, "");
  if (!normalized) {
    throw new Error(`Invalid ${collection} identifier: ${value}`);
  }
  return normalized;
}

/**
 * Build a fully-qualified resource name from a customer ID and either a bare id
 * or an already-qualified resource name (which is returned unchanged).
 *
 * @example toResourceName("123-456-7890", "456", "campaigns")
 *          -> "customers/1234567890/campaigns/456"
 */
export function toResourceName(customerId: string, idOrResourceName: string, collection: string): string {
  if (idOrResourceName.startsWith("customers/")) {
    return idOrResourceName;
  }
  const customer = normalizeCustomerId(customerId);
  const id = normalizeNumericId(idOrResourceName, collection);
  return `customers/${customer}/${collection}/${id}`;
}
