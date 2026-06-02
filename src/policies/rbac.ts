import type { AuthContext } from "../auth/identityContext.js";

/**
 * Identity-based authorization. Two layers protect an operation:
 *   1. ROLE gate (here): can this employee run write/admin tools at all.
 *   2. ACCOUNT gate (services/db.ts getConnectionForCustomer + getGrantLevel):
 *      does the employee hold a (sufficient) AccountGrant for the customerId.
 *
 * Write-vs-read is decided by DEFAULT-DENY, not by a name prefix: a tool is a
 * read ONLY if it is explicitly known to be read-only; everything else is
 * treated as a write (so a mutating tool can never slip through the grant gate
 * just because its name doesn't start with create_/update_/remove_).
 */

const ADMIN_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);
/** Roles permitted to run write tools. Anything else (incl. null/empty) is read-only. */
const WRITE_CAPABLE_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "member"]);

/** Tools that expose org-wide administrative data and require an admin role. */
const ADMIN_ONLY_TOOLS: ReadonlySet<string> = new Set(["get_user_status", "list_users"]);

/** Read-only tool name prefixes. */
const READ_ONLY_PREFIX = /^(list_|get_)/;
/** Read-only tools that do not match the prefix convention. */
const READ_ONLY_EXTRA: ReadonlySet<string> = new Set([
  "run_gaql_query",
  "generate_keyword_ideas",
  "generate_reach_forecast",
]);

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_PREFIX.test(toolName) || READ_ONLY_EXTRA.has(toolName);
}

/** DEFAULT-DENY: anything not explicitly read-only is treated as a write. */
export function isWriteTool(toolName: string): boolean {
  return !isReadOnlyTool(toolName);
}

export interface AuthzVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether the authenticated caller may invoke a tool (role layer only).
 *
 * @param authCtx The resolved identity, or undefined for single-operator/stdio
 *   mode (no multi-tenant identity → allowed; account access still gated by env).
 * @param toolName The MCP tool being invoked.
 */
export function can(authCtx: AuthContext | undefined, toolName: string): AuthzVerdict {
  // Single-operator / stdio mode: no authenticated identity. Account access is
  // still controlled by env credentials in getCustomer.
  if (!authCtx) {
    return { allowed: true };
  }

  const role = authCtx.role ?? "";

  if (ADMIN_ONLY_TOOLS.has(toolName) && !ADMIN_ROLES.has(role)) {
    return { allowed: false, reason: `Tool '${toolName}' requires an organization admin role.` };
  }

  // Fail closed: writes require an explicitly write-capable role.
  if (isWriteTool(toolName) && !WRITE_CAPABLE_ROLES.has(role)) {
    return {
      allowed: false,
      reason: `Role '${role || "none"}' may not run write tool '${toolName}'.`,
    };
  }

  return { allowed: true };
}
