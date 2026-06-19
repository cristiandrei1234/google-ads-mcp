import { describe, it, expect } from "vitest";
import {
  registry,
  recordToolInvocation,
  recordApiCall,
  setActiveSessions,
  metricsText,
  metricsContentType,
  enableDefaultMetrics,
} from "./metrics.js";

describe("metrics", () => {
  it("records a tool invocation (counter + duration histogram)", async () => {
    recordToolInvocation("run_gaql_query", "ok", 0.42);
    const text = await metricsText();
    expect(text).toContain('mcp_tool_invocations_total{tool="run_gaql_query",outcome="ok"} 1');
    expect(text).toContain("mcp_tool_duration_seconds_count");
  });

  it("records a Google Ads API call duration", async () => {
    recordApiCall("mutate", "error", 1.5);
    const text = await metricsText();
    expect(text).toContain('google_ads_api_duration_seconds_count{operation="mutate",outcome="error"} 1');
  });

  it("publishes the active session gauge", async () => {
    setActiveSessions(7);
    const text = await metricsText();
    expect(text).toContain("mcp_active_sessions 7");
  });

  it("exposes the Prometheus content type", () => {
    expect(metricsContentType).toContain("text/plain");
  });

  it("enables default process metrics once (idempotent)", async () => {
    enableDefaultMetrics();
    enableDefaultMetrics(); // second call is a no-op
    const text = await metricsText();
    expect(text).toContain("process_cpu_user_seconds_total");
    expect(registry.getSingleMetric("process_cpu_user_seconds_total")).toBeDefined();
  });
});
