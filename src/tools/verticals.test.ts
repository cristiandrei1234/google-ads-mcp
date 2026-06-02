import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../observability/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  listAudienceInsights,
  listHotelPerformance,
  registerVerticalTools,
} from "./verticals.js";
import { getCustomer } from "../services/google-ads/client.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

let customer: ReturnType<typeof fakeCustomer>;

beforeEach(() => {
  vi.clearAllMocks();
  customer = fakeCustomer([{ row: 1 }]);
  (customer as any).audienceInsights = {
    listAudienceInsightsAttributes: vi.fn(async () => ({ attributes: ["a"] })),
  };
  (getCustomer as any).mockResolvedValue(customer);
});

describe("listAudienceInsights", () => {
  it("builds request without queryText", async () => {
    const res = await listAudienceInsights({
      customerId: "1",
      customerInsightsGroup: "grp",
      dimensions: ["AFFINITY_USER_INTEREST"],
    });
    const req = (customer as any).audienceInsights.listAudienceInsightsAttributes.mock.calls[0][0];
    expect(req).toEqual({
      customer_id: "1",
      customer_insights_group: "grp",
      dimensions: ["AFFINITY_USER_INTEREST"],
    });
    expect(req.query_text).toBeUndefined();
    expect(res).toEqual({ attributes: ["a"] });
  });

  it("includes queryText when provided", async () => {
    await listAudienceInsights({
      customerId: "1",
      customerInsightsGroup: "grp",
      dimensions: ["X"],
      queryText: "shoes",
    });
    const req = (customer as any).audienceInsights.listAudienceInsightsAttributes.mock.calls[0][0];
    expect(req.query_text).toBe("shoes");
  });

  it("passes userId to getCustomer", async () => {
    await listAudienceInsights({ customerId: "1", customerInsightsGroup: "g", dimensions: ["X"], userId: "u" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
  });

  it("logs and rethrows on failure", async () => {
    (customer as any).audienceInsights.listAudienceInsightsAttributes.mockRejectedValueOnce(new Error("ai-fail"));
    await expect(
      listAudienceInsights({ customerId: "1", customerInsightsGroup: "g", dimensions: ["X"] })
    ).rejects.toThrow("ai-fail");
  });
});

describe("listHotelPerformance", () => {
  it("builds query with defaults (no where/orderBy)", async () => {
    const res = await listHotelPerformance({
      customerId: "1",
      fields: ["segments.partner_hotel_id", "campaign.name"],
      limit: 50,
    });
    const q = customer.query.mock.calls[0][0];
    expect(q).toContain("FROM hotel_performance_view");
    expect(q).toContain("segments.partner_hotel_id");
    expect(q).not.toContain("WHERE");
    expect(q).not.toContain("ORDER BY");
    expect(q).toContain("LIMIT 50");
    expect(res).toEqual([{ row: 1 }]);
  });

  it("includes where and orderBy clauses", async () => {
    await listHotelPerformance({
      customerId: "1",
      fields: ["campaign.name"],
      where: "metrics.clicks > 0",
      orderBy: "metrics.clicks DESC",
      limit: 10,
    });
    const q = customer.query.mock.calls[0][0];
    expect(q).toContain("WHERE metrics.clicks > 0");
    expect(q).toContain("ORDER BY metrics.clicks DESC");
  });

  it("rejects unsafe where fragment", async () => {
    await expect(
      listHotelPerformance({ customerId: "1", fields: ["campaign.name"], where: "1=1; DROP", limit: 10 })
    ).rejects.toThrow(/Invalid 'where'/);
  });

  it("rejects unsafe field fragment", async () => {
    await expect(
      listHotelPerformance({ customerId: "1", fields: ["SELECT * FROM x"], limit: 10 })
    ).rejects.toThrow(/Invalid 'fields'/);
  });
});

describe("registerVerticalTools", () => {
  const tools = captureTools(registerVerticalTools);

  it("registers both tools", () => {
    expect([...tools.keys()].sort()).toEqual(["list_audience_insights", "list_hotel_performance"]);
  });

  it("list_hotel_performance handler returns JSON via asTool", async () => {
    const res = await getTool(tools, "list_hotel_performance").handler({
      customerId: "1",
      fields: ["campaign.name"],
      limit: 5,
    });
    expect(res.isError).toBeUndefined();
    expect(toolJson(res)).toEqual([{ row: 1 }]);
  });

  it("list_audience_insights handler surfaces errors via asTool", async () => {
    (customer as any).audienceInsights.listAudienceInsightsAttributes.mockRejectedValueOnce(new Error("boom"));
    const res = await getTool(tools, "list_audience_insights").handler({
      customerId: "1",
      customerInsightsGroup: "g",
      dimensions: ["X"],
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/boom/);
  });
});
