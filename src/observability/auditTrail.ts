import type { AuthContext } from "../auth/identityContext.js";
import type { AuditEntry } from "../services/db.js";
import logger from "./logger.js";

export type AuditOutcome = "ok" | "error" | "denied";

/**
 * Build the audit row for one tool call, or null when there is nothing to
 * attribute it to.
 *
 * Separated from the write so the shape is unit-testable: this row is the only
 * record of who did what, and a field silently dropped here is invisible until
 * someone needs the trail.
 *
 * @param identity The authenticated identity, or undefined in single-operator
 *   (stdio) mode.
 * @returns The row to append, or null when no org-scoped identity is present.
 */
export function buildAuditEntry(
  identity: AuthContext | undefined,
  toolName: string,
  customerId: string | undefined,
  outcome: AuditOutcome,
  errorKind?: string
): AuditEntry | null {
  if (!identity?.orgId) {
    return null; // single-operator/stdio: nothing to attribute to an org.
  }
  return {
    organizationId: identity.orgId,
    memberId: identity.memberId,
    userId: identity.userId,
    tool: toolName,
    customerId: customerId ?? null,
    outcome,
    errorKind: errorKind ?? null,
  };
}

/**
 * Append an audit row, best-effort.
 *
 * The database module is imported here rather than at module scope so a stdio
 * process — which never produces an entry — never loads Prisma. A failed write
 * is logged, never thrown: losing the trail must not fail the caller's tool.
 */
export function recordAuditEntry(entry: AuditEntry): void {
  void import("../services/db.js")
    .then(({ appendAuditLog }) => appendAuditLog(entry))
    .catch(err => logger.warn({ err, tool: entry.tool }, "audit log write failed"));
}
