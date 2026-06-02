/**
 * Classification of destructive tools.
 *
 * The agent (LLM) is a primary actor against real client ad budgets, so
 * irreversible operations must not run on a single model decision. A tool is
 * "destructive" when it deletes/removes an entity or makes an account-wide
 * change that is hard to undo. Such tools require an explicit `confirm: true`
 * flag in their arguments before the handler executes.
 *
 * This is the single source of truth — both the argument-schema augmentation
 * and the runtime guard read from here.
 */

/** Tool-name prefixes that are always destructive. */
const DESTRUCTIVE_PREFIXES = ["remove_", "delete_", "unlink_"] as const;

/**
 * Tools that are destructive despite not matching a prefix (e.g. they mutate
 * account-level settings or apply queued operations irreversibly).
 */
const DESTRUCTIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "update_customer",
  "run_batch_job",
  "apply_recommendation",
  // Irreversible operations that don't match a destructive prefix:
  "run_offline_user_data_job",
  "promote_campaign_draft",
  "promote_experiment",
  "end_experiment",
]);

/**
 * @param toolName The registered MCP tool name (e.g. "remove_campaign").
 * @returns true if the tool requires explicit confirmation before running.
 */
export function isDestructiveTool(toolName: string): boolean {
  if (DESTRUCTIVE_TOOL_NAMES.has(toolName)) {
    return true;
  }
  return DESTRUCTIVE_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

/** The argument field a caller sets to acknowledge a destructive action. */
export const CONFIRM_FIELD = "confirm" as const;

/**
 * Decide whether a destructive call is allowed to proceed.
 *
 * @param toolName The tool being invoked.
 * @param args The (already validated) tool arguments.
 * @returns `{ allowed: true }` for non-destructive tools or confirmed calls;
 *   otherwise `{ allowed: false, reason }` with a message safe to show.
 */
export function checkDestructiveConfirmation(
  toolName: string,
  args: unknown
): { allowed: true } | { allowed: false; reason: string } {
  if (!isDestructiveTool(toolName)) {
    return { allowed: true };
  }

  const confirmed =
    typeof args === "object" &&
    args !== null &&
    (args as Record<string, unknown>)[CONFIRM_FIELD] === true;

  if (confirmed) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason:
      `Tool '${toolName}' is destructive and was not confirmed. ` +
      `Re-issue the call with "${CONFIRM_FIELD}": true once you are certain. ` +
      `This protects live client accounts from irreversible changes.`,
  };
}
