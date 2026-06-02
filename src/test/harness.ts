import { vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Shared unit-test harness for tool handlers and services.
 *
 * The heavy boundaries (Google Ads client, DB, identity) are mocked with
 * `vi.mock` AT THE TOP of each test file (mock factories are hoisted), e.g.:
 *
 *   vi.mock("../services/google-ads/client.js", () => ({
 *     getCustomer: vi.fn(),
 *     getClient: vi.fn(),
 *   }));
 *   vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));
 *   vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
 *
 * Then in tests, import the mocked fns and set their return values, and use
 * `captureTools(registerXTools)` to get each tool's handler to invoke.
 */

export interface CapturedTool {
  name: string;
  config: { description?: string; inputSchema?: Record<string, unknown> };
  handler: (args: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: true }>;
}

/**
 * Invoke a `registerXTools(server)` function against a stub server and capture
 * every registered tool by name (bypassing createServer's withRbac wrapper, so
 * the raw handler logic is what gets tested).
 */
export function captureTools(register: (server: McpServer) => void): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    registerTool: (name: string, config: CapturedTool["config"], handler: CapturedTool["handler"]) => {
      tools.set(name, { name, config, handler });
    },
  } as unknown as McpServer;
  register(server);
  return tools;
}

/** Get a tool handler by name or throw a helpful error (so typos fail loudly). */
export function getTool(tools: Map<string, CapturedTool>, name: string): CapturedTool {
  const tool = tools.get(name);
  if (!tool) {
    throw new Error(`Tool '${name}' not registered. Available: ${[...tools.keys()].join(", ")}`);
  }
  return tool;
}

/** Extract the JSON payload a tool returned (parses the single text block). */
export function toolJson(result: { content: { text: string }[]; isError?: true }): unknown {
  const text = result.content[0]?.text ?? "";
  if (result.isError) return { __error: text };
  return JSON.parse(text);
}

export interface FakeCustomer {
  query: ReturnType<typeof vi.fn>;
  mutateResources: ReturnType<typeof vi.fn>;
  offlineUserDataJobs: {
    createOfflineUserDataJob: ReturnType<typeof vi.fn>;
    addOfflineUserDataJobOperations: ReturnType<typeof vi.fn>;
    runOfflineUserDataJob: ReturnType<typeof vi.fn>;
  };
  conversionUploads: { uploadClickConversions: ReturnType<typeof vi.fn>; uploadCallConversions: ReturnType<typeof vi.fn> };
  conversionAdjustmentUploads: { uploadConversionAdjustments: ReturnType<typeof vi.fn> };
  [key: string]: unknown;
}

/**
 * A fake google-ads-api Customer recording query/mutate calls. `queryRows`
 * seeds the default `query()` result. Extend the returned object as needed for
 * tools that call other namespaced APIs.
 */
export function fakeCustomer(queryRows: unknown[] = []): FakeCustomer {
  return {
    query: vi.fn(async () => queryRows),
    mutateResources: vi.fn(async () => ({ results: [{ resource_name: "customers/1/resources/1" }] })),
    offlineUserDataJobs: {
      createOfflineUserDataJob: vi.fn(async () => ({ resource_name: "customers/1/offlineUserDataJobs/9" })),
      addOfflineUserDataJobOperations: vi.fn(async () => ({})),
      runOfflineUserDataJob: vi.fn(async () => ({})),
    },
    conversionUploads: {
      uploadClickConversions: vi.fn(async () => ({})),
      uploadCallConversions: vi.fn(async () => ({})),
    },
    conversionAdjustmentUploads: {
      uploadConversionAdjustments: vi.fn(async () => ({})),
    },
  };
}
