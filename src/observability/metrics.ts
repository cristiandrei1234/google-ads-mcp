import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Prometheus metrics for the MCP server. Kept side-effect-free at import time:
 * default process/Node metrics are opt-in via {@link enableDefaultMetrics} so
 * unit tests don't start background collection.
 */

export const registry = new Registry();

export const toolInvocations = new Counter({
  name: "mcp_tool_invocations_total",
  help: "MCP tool invocations by tool and outcome.",
  labelNames: ["tool", "outcome"] as const,
  registers: [registry],
});

export const toolDuration = new Histogram({
  name: "mcp_tool_duration_seconds",
  help: "MCP tool handler execution time in seconds.",
  labelNames: ["tool"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const apiCallDuration = new Histogram({
  name: "google_ads_api_duration_seconds",
  help: "Google Ads API call time in seconds by operation and outcome.",
  labelNames: ["operation", "outcome"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const activeSessions = new Gauge({
  name: "mcp_active_sessions",
  help: "Number of live MCP sessions.",
  registers: [registry],
});

export type ToolOutcome = "ok" | "error" | "denied";

/** Record one tool invocation: bump the counter and observe its duration. */
export function recordToolInvocation(tool: string, outcome: ToolOutcome, durationSeconds: number): void {
  toolInvocations.inc({ tool, outcome });
  toolDuration.observe({ tool }, durationSeconds);
}

/** Record one Google Ads API call's duration and outcome. */
export function recordApiCall(operation: string, outcome: "ok" | "error", durationSeconds: number): void {
  apiCallDuration.observe({ operation, outcome }, durationSeconds);
}

/** Publish the current live-session count. */
export function setActiveSessions(count: number): void {
  activeSessions.set(count);
}

/** Render the registry in Prometheus text exposition format. */
export function metricsText(): Promise<string> {
  return registry.metrics();
}

export const metricsContentType = registry.contentType;

let defaultsEnabled = false;
/** Opt in to default process/Node.js metrics (call once from the HTTP entry). */
export function enableDefaultMetrics(): void {
  if (defaultsEnabled) return;
  defaultsEnabled = true;
  collectDefaultMetrics({ register: registry });
}
