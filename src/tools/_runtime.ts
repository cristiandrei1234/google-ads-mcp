import { toErrorMessage } from "../observability/errorMessage.js";

/**
 * Shape every MCP tool handler returns: a single text block, optionally flagged
 * as an error. Matches the SDK's `CallToolResult` subset these tools use.
 */
export type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: true;
};

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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${toErrorMessage(error)}` }],
      isError: true,
    };
  }
}
