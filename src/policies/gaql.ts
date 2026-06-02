/**
 * Defensive validation for caller-supplied GAQL fragments (free-text WHERE /
 * ORDER BY clauses on the generic read tools).
 *
 * GAQL is read-only and every query is pinned to a single, grant-checked
 * customer_id, so a fragment cannot mutate data or cross tenants. This guard is
 * defense-in-depth: it rejects fragments that try to break out of a clause
 * (statement separators, comment markers) or smuggle a full statement
 * (SELECT/FROM/INSERT/UPDATE/DELETE/MUTATE keywords), which never belong in a
 * WHERE/ORDER BY fragment.
 */

const FORBIDDEN_SUBSTRINGS = [";", "--", "/*", "*/"];
const FORBIDDEN_KEYWORDS = /\b(SELECT|FROM|INSERT|UPDATE|DELETE|MUTATE|CREATE|DROP)\b/i;

/**
 * @param fragment The caller-supplied clause body (without the WHERE/ORDER BY keyword).
 * @param label Field name for the error message (e.g. "where", "orderBy").
 * @throws Error if the fragment contains disallowed tokens.
 */
export function assertSafeGaqlFragment(fragment: string | undefined, label: string): void {
  if (fragment === undefined) return;
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    if (fragment.includes(bad)) {
      throw new Error(`Invalid '${label}' GAQL fragment: contains '${bad}'.`);
    }
  }
  if (FORBIDDEN_KEYWORDS.test(fragment)) {
    throw new Error(`Invalid '${label}' GAQL fragment: statement keywords are not allowed.`);
  }
}
