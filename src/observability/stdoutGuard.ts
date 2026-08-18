import { Console } from "node:console";

/**
 * Route every `console.*` write to stderr (fd 2).
 *
 * On the stdio transport fd 1 carries the MCP JSON-RPC stream and nothing else;
 * a single stray line desynchronises the protocol for the rest of the session.
 * Third-party code does not know that: `google-ads-api` prints the raw error
 * object to stdout when `listAccessibleCustomers` fails (an expired refresh
 * token is enough to trigger it), so the guard has to sit above them all rather
 * than at each call site. The logger avoids fd 1 for the same reason.
 */
export function redirectConsoleToStderr(): void {
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
}
