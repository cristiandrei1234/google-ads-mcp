import { describe, it, expect } from "vitest";
import { withToolSpan } from "./tracing.js";

/**
 * With no SDK registered, the OTel API's no-op tracer still invokes the
 * startActiveSpan callback with a non-recording span and runs its lifecycle
 * methods as no-ops — so calling withToolSpan exercises the success, error, and
 * non-Error-throw paths end to end (the span methods are real, just no-ops).
 */
describe("withToolSpan", () => {
  it("runs fn within an active span and returns its result", async () => {
    const result = await withToolSpan("run_gaql_query", { "mcp.tool": "run_gaql_query" }, async () => 42);
    expect(result).toBe(42);
  });

  it("propagates and records an Error throw", async () => {
    const boom = new Error("kaboom");
    await expect(
      withToolSpan("remove_campaign", { "mcp.tool": "remove_campaign" }, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
  });

  it("handles a non-Error throw (stringified status message)", async () => {
    await expect(
      withToolSpan("x", {}, async () => {
        throw "plain-string";
      })
    ).rejects.toBe("plain-string");
  });
});
