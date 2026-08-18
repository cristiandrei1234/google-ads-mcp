import { z } from "zod";
import {
  TOOLSETS,
  TOOLSET_DESCRIPTIONS,
  type Toolset,
} from "../policies/toolsets.js";

/**
 * The part of the SDK's registered-tool handle this module needs.
 *
 * Kept to the minimum so the enable logic is testable without an MCP server or
 * a transport.
 */
export interface ToolsetMember {
  readonly toolset: Toolset;
  readonly enabled: boolean;
  enable(): void;
}

export const EnableToolsetSchema = z.object({
  toolsets: z
    .array(z.string())
    .min(1)
    .describe("Toolset names to switch on, e.g. ['shopping', 'bidding']."),
});

/**
 * Description for the enable_toolset tool.
 *
 * It has to name every group and say what is in it. The model cannot ask for a
 * group it has never seen described, and a model that cannot find a tool gives
 * up rather than going looking for the switch.
 */
export function enableToolsetDescription(): string {
  const groups = TOOLSETS.map(name => `- ${name}: ${TOOLSET_DESCRIPTIONS[name]}`).join("\n");
  return [
    "Switch on a group of Google Ads tools that is not currently loaded.",
    "",
    "This server registers far more tools than any one session needs, so most",
    "groups start disabled. If the tool you need for a Google Ads task is not in",
    "your list, enable its group here and the tools appear immediately.",
    "",
    "Groups:",
    groups,
  ].join("\n");
}

export interface EnableToolsetsResult {
  /** Groups switched on by this call. */
  enabled: Toolset[];
  /** Groups that were already on; asking again is not an error. */
  alreadyActive: Toolset[];
  /** Names that are not toolsets, echoed back so the caller can correct them. */
  unknown: string[];
  /** Tool names that became callable. */
  tools: string[];
}

const KNOWN: ReadonlySet<string> = new Set(TOOLSETS);

/**
 * Enable every tool belonging to the requested groups.
 *
 * @param registry Every registered tool, by name, with the group that owns it.
 * @param requested Group names as the caller wrote them (case-insensitive).
 * @throws {Error} when no requested name is a known group — a caller that got
 *   every name wrong needs the valid list, not an empty success.
 */
export function enableToolsets(
  registry: ReadonlyMap<string, ToolsetMember>,
  requested: readonly string[]
): EnableToolsetsResult {
  const normalized = requested.map(name => name.trim().toLowerCase());
  const unknown = normalized.filter(name => !KNOWN.has(name));
  const valid = normalized.filter((name): name is Toolset => KNOWN.has(name));

  if (valid.length === 0) {
    throw new Error(
      `No known toolset in: ${requested.join(", ") || "(nothing)"}. ` +
      `Valid groups: ${TOOLSETS.join(", ")}.`
    );
  }

  const wanted = new Set<Toolset>(valid);
  const enabled = new Set<Toolset>();
  const alreadyActive = new Set<Toolset>();
  const tools: string[] = [];

  for (const [name, member] of registry) {
    if (!wanted.has(member.toolset)) {
      continue;
    }
    if (member.enabled) {
      alreadyActive.add(member.toolset);
      continue;
    }
    member.enable();
    enabled.add(member.toolset);
    tools.push(name);
  }

  return {
    // A group counts as newly enabled only if something in it actually changed.
    enabled: [...enabled],
    alreadyActive: [...alreadyActive].filter(name => !enabled.has(name)),
    unknown,
    tools: tools.sort(),
  };
}
