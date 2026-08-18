import config from "../config/env.js";
import { toErrorMessage } from "../observability/errorMessage.js";

/**
 * Shape every MCP tool handler returns: a single text block, optionally flagged
 * as an error. Matches the SDK's `CallToolResult` subset these tools use.
 */
export type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: true;
};

/** Characters a single tool result may occupy when nothing is configured. */
export const DEFAULT_MAX_RESULT_CHARS = 100_000;

/** Room reserved for the truncation envelope's own fields. */
const ENVELOPE_OVERHEAD_CHARS = 400;

/** The configured result ceiling, or {@link DEFAULT_MAX_RESULT_CHARS}. */
export function maxResultChars(): number {
  return config.GOOGLE_ADS_MAX_RESULT_CHARS ?? DEFAULT_MAX_RESULT_CHARS;
}

function narrowingAdvice(limit: number): string {
  return (
    `The full result exceeds the ${limit}-character ceiling ` +
    `(GOOGLE_ADS_MAX_RESULT_CHARS). Re-run with a narrower request: add or lower ` +
    `LIMIT, filter with WHERE, shorten the date range, or select fewer fields.`
  );
}

/**
 * Serialise a tool's return value, bounded by {@link maxResultChars}.
 *
 * An unbounded `run_gaql_query` on a large account otherwise drops tens of
 * thousands of rows straight into the model's context. Rows are kept whole (a
 * half-serialised row is not parseable), and the envelope states how many of
 * how many were returned so the caller knows the result is partial and what to
 * do about it — "truncated" on its own is not actionable.
 */
export function renderToolResult(result: unknown): string {
  const limit = maxResultChars();
  const text = JSON.stringify(result);
  if (text === undefined) {
    return "null"; // undefined has no JSON representation
  }
  if (text.length <= limit) {
    return text;
  }

  if (Array.isArray(result)) {
    const budget = limit - ENVELOPE_OVERHEAD_CHARS;
    const rows: unknown[] = [];
    let used = 0;
    for (const row of result) {
      const size = JSON.stringify(row).length + 1; // + the separating comma
      if (used + size > budget) break;
      rows.push(row);
      used += size;
    }
    return JSON.stringify({
      truncated: true,
      totalRows: result.length,
      returnedRows: rows.length,
      advice: narrowingAdvice(limit),
      rows,
    });
  }

  return JSON.stringify({
    truncated: true,
    advice: narrowingAdvice(limit),
    partial: text.slice(0, limit - ENVELOPE_OVERHEAD_CHARS),
  });
}

/**
 * Run a tool implementation and adapt its outcome to the MCP wire shape.
 *
 * Replaces the ~20 copy-pasted `asTool` definitions that lived in each tool
 * file. Crucially, it renders failures through {@link toErrorMessage} (not raw
 * `error.message`), so a thrown string, a non-Error object, or a nested
 * `errors[]` payload all surface a usable message instead of `undefined`.
 *
 * Never throws: any failure is returned as `{ isError: true }`.
 */
export async function asTool<A>(
  fn: (args: A) => Promise<unknown>,
  args: A,
): Promise<ToolResult> {
  try {
    const result = await fn(args);
    return { content: [{ type: "text", text: renderToolResult(result) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${toErrorMessage(error)}` }],
      isError: true,
    };
  }
}
