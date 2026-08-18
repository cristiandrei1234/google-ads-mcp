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
  assertNoStatementBreakers(fragment, `'${label}' GAQL fragment`);
  if (FORBIDDEN_KEYWORDS.test(fragment)) {
    throw new Error(`Invalid '${label}' GAQL fragment: statement keywords are not allowed.`);
  }
}

/** Reject text that could end the current clause and start something else. */
function assertNoStatementBreakers(text: string, subject: string): void {
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    if (text.includes(bad)) {
      throw new Error(`Invalid ${subject}: contains '${bad}'.`);
    }
  }
}

/**
 * Validate a whole caller-supplied GAQL statement.
 *
 * Unlike a fragment, a statement legitimately contains SELECT and FROM, so only
 * the separator and comment checks apply. Free-text statements were previously
 * unvalidated while fragments were — the same class of input deserves the same
 * floor.
 *
 * @throws Error if the query hides a second statement or a comment.
 */
export function assertSafeGaqlStatement(query: string): void {
  assertNoStatementBreakers(query, "GAQL query");
}

/** Rows returned when a caller-supplied statement carries no LIMIT of its own. */
export const DEFAULT_QUERY_LIMIT = 1000;

/**
 * Append a LIMIT to a statement that has none.
 *
 * GAQL happily streams an entire account, and a model that forgets LIMIT should
 * not be able to. The clause goes before PARAMETERS, which must stay last.
 */
export function withDefaultLimit(query: string, limit: number = DEFAULT_QUERY_LIMIT): string {
  if (/\bLIMIT\s+\d+/i.test(query)) {
    return query;
  }
  const trimmed = query.trim();
  const parameters = /\bPARAMETERS\b/i.exec(trimmed);
  if (parameters) {
    return `${trimmed.slice(0, parameters.index).trimEnd()} LIMIT ${limit} ${trimmed.slice(parameters.index)}`;
  }
  return `${trimmed} LIMIT ${limit}`;
}
