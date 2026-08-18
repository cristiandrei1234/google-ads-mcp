import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./createServer.js";
import logger from "./observability/logger.js";
import { redirectConsoleToStderr } from "./observability/stdoutGuard.js";
import { toErrorMessage } from "./observability/errorMessage.js";

// Before anything can write: on this transport stdout is the JSON-RPC stream.
redirectConsoleToStderr();

// stdio entry point — for local development and single-operator use.
// The production HTTP transport lives in src/server/http.ts.
async function main() {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Google Ads MCP Server running on stdio");
}

main().catch((error) => {
    // pino's pretty transport runs in a worker thread and process.exit() can cut
    // it off mid-flush, so a startup failure (bad env, bad GOOGLE_ADS_TOOLSETS)
    // must also go straight to fd 2 or the process dies silently.
    process.stderr.write(`google-ads-mcp failed to start: ${toErrorMessage(error)}
`);
    logger.error({ err: error }, "server startup failed");
    process.exit(1);
});
