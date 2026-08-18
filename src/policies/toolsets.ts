/**
 * Toolset grouping.
 *
 * The server registers ~345 tools. Every one of them costs context in the
 * client, and a large flat list also dilutes tool search: the more near-identical
 * names compete, the worse the ranking for the handful that matter. Toolsets let
 * an operator register only the groups they actually use.
 *
 * Naming follows the GitHub MCP server's `GITHUB_TOOLSETS` convention (a
 * comma-separated list plus the special value `all`), because users already
 * know it.
 */

export const TOOLSETS = [
  "core",
  "reporting",
  "keywords",
  "negatives",
  "audiences",
  "conversions",
  "assets",
  "shopping",
  "planning",
  "experiments",
  "bidding",
  "billing",
  "admin",
  "resources",
] as const;

export type Toolset = (typeof TOOLSETS)[number];

/** Registered when GOOGLE_ADS_TOOLSETS is unset: day-to-day management + reads. */
export const DEFAULT_TOOLSETS: readonly Toolset[] = ["core", "reporting"];

/** The value that turns everything on. */
export const ALL_TOOLSETS = "all";

const KNOWN: ReadonlySet<string> = new Set(TOOLSETS);

/**
 * Resolve the configured toolsets.
 *
 * @param raw The raw GOOGLE_ADS_TOOLSETS value; unset falls back to
 *   {@link DEFAULT_TOOLSETS}.
 * @returns The set of groups whose tools should be registered.
 * @throws {Error} on an unknown group name — a typo that silently registered the
 *   wrong tools would surface much later as "the tool does not exist".
 */
export function resolveToolsets(raw: string | undefined): ReadonlySet<Toolset> {
  const requested = (raw ?? "")
    .split(",")
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0);

  if (requested.length === 0) {
    return new Set(DEFAULT_TOOLSETS);
  }
  if (requested.includes(ALL_TOOLSETS)) {
    return new Set(TOOLSETS);
  }

  const unknown = requested.filter(entry => !KNOWN.has(entry));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown GOOGLE_ADS_TOOLSETS value(s): ${unknown.join(", ")}. ` +
      `Valid groups: ${TOOLSETS.join(", ")} (or '${ALL_TOOLSETS}').`
    );
  }
  return new Set(requested as Toolset[]);
}
