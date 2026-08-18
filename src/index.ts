import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./createServer.js";
import logger from "./observability/logger.js";
import { redirectConsoleToStderr } from "./observability/stdoutGuard.js";

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
    logger.error("Server error:", error);
    process.exit(1);
});
