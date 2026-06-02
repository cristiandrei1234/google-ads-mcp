import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn() }));

import { getSearchTerms, getChangeHistory } from "./reporting.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSearchTerms", () => {
  it("builds a metric query with defaults (no campaign/adGroup filters)", async () => {
    const c = fakeCustomer([{ s: 1 }]);
    (getCustomer as any).mockResolvedValue(c);
    const res = await getSearchTerms({ customerId: "1", limit: 50, dateRange: "LAST_30_DAYS" } as any);
    const q = c.query.mock.calls[0][0];
    expect(q).toContain("FROM search_term_view");
    expect(q).toContain("DURING LAST_30_DAYS");
    expect(q).toContain("metrics.impressions");
    expect(q).not.toContain("campaign.id =");
    expect(q).not.toContain("ad_group.id =");
    expect(q).toContain("ORDER BY metrics.impressions DESC LIMIT 50");
    expect(res).toEqual([{ s: 1 }]);
  });

  it("adds campaign and adGroup filters when provided", async () => {
    const c = fakeCustomer([]);
    (getCustomer as any).mockResolvedValue(c);
    await getSearchTerms({
      customerId: "1",
      campaignId: "11",
      adGroupId: "22",
      limit: 10,
      dateRange: "TODAY",
      userId: "u",
    } as any);
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
    const q = c.query.mock.calls[0][0];
    expect(q).toContain("AND campaign.id = 11");
    expect(q).toContain("AND ad_group.id = 22");
  });

  it("falls back to the non-metric query on REQUESTED_METRICS_FOR_MANAGER", async () => {
    const c = fakeCustomer();
    c.query
      .mockRejectedValueOnce({ message: "x", code: "REQUESTED_METRICS_FOR_MANAGER" })
      .mockResolvedValueOnce([{ noMetrics: true }]);
    (getCustomer as any).mockResolvedValue(c);
    const res = await getSearchTerms({
      customerId: "1",
      campaignId: "11",
      adGroupId: "22",
      limit: 25,
      dateRange: "LAST_7_DAYS",
    } as any);
    expect(res).toEqual([{ noMetrics: true }]);
    const fallbackQ = c.query.mock.calls[1][0];
    expect(fallbackQ).not.toContain("metrics.impressions");
    expect(fallbackQ).toContain("AND campaign.id = 11");
    expect(fallbackQ).toContain("AND ad_group.id = 22");
    expect(fallbackQ).toContain("LIMIT 25");
  });

  it("builds the fallback query without filters", async () => {
    const c = fakeCustomer();
    c.query
      .mockRejectedValueOnce({ message: "REQUESTED_METRICS_FOR_MANAGER inside" })
      .mockResolvedValueOnce([]);
    (getCustomer as any).mockResolvedValue(c);
    await getSearchTerms({ customerId: "1", limit: 5, dateRange: "THIS_MONTH" } as any);
    const fallbackQ = c.query.mock.calls[1][0];
    expect(fallbackQ).not.toContain("campaign.id =");
    expect(fallbackQ).not.toContain("ad_group.id =");
  });

  it("rethrows other errors", async () => {
    const c = fakeCustomer();
    c.query.mockRejectedValue(new Error("permission denied"));
    (getCustomer as any).mockResolvedValue(c);
    await expect(
      getSearchTerms({ customerId: "1", limit: 5, dateRange: "LAST_MONTH" } as any)
    ).rejects.toThrow("permission denied");
  });

  it("exercises the `error ?? {}` nullish branch when null is thrown", async () => {
    const c = fakeCustomer();
    // Throw null: `JSON.stringify(error ?? {})` evaluates the {} fallback (does not
    // match the manager sentinel). The catch then reads `error.message`, which on
    // null surfaces as a TypeError — the function still rejects.
    c.query.mockRejectedValue(null);
    (getCustomer as any).mockResolvedValue(c);
    await expect(
      getSearchTerms({ customerId: "1", limit: 5, dateRange: "LAST_MONTH" } as any)
    ).rejects.toThrow(TypeError);
  });
});

describe("getChangeHistory", () => {
  it("uses the LAST_14_DAYS default window when no dates provided", async () => {
    const c = fakeCustomer([{ e: 1 }]);
    (getCustomer as any).mockResolvedValue(c);
    const res = await getChangeHistory({ customerId: "1", limit: 50 } as any);
    const q = c.query.mock.calls[0][0];
    expect(q).toContain("DURING LAST_14_DAYS");
    expect(q).toContain("FROM change_event");
    expect(q).toContain("ORDER BY change_event.change_date_time DESC LIMIT 50");
    expect(res).toEqual([{ e: 1 }]);
  });

  it("uses a BETWEEN window when startDate and endDate provided", async () => {
    const c = fakeCustomer([]);
    (getCustomer as any).mockResolvedValue(c);
    await getChangeHistory({
      customerId: "1",
      limit: 10,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      userId: "u",
    } as any);
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
    const q = c.query.mock.calls[0][0];
    expect(q).toContain("BETWEEN '2026-01-01' AND '2026-02-01'");
    expect(q).not.toContain("LAST_14_DAYS");
  });

  it("adds a resource type IN filter when resourceTypes provided", async () => {
    const c = fakeCustomer([]);
    (getCustomer as any).mockResolvedValue(c);
    await getChangeHistory({
      customerId: "1",
      limit: 10,
      resourceTypes: ["CAMPAIGN", "AD_GROUP"],
    } as any);
    const q = c.query.mock.calls[0][0];
    expect(q).toContain("change_event.change_resource_type IN ('CAMPAIGN','AD_GROUP')");
  });

  it("ignores an empty resourceTypes array", async () => {
    const c = fakeCustomer([]);
    (getCustomer as any).mockResolvedValue(c);
    await getChangeHistory({ customerId: "1", limit: 10, resourceTypes: [] } as any);
    expect(c.query.mock.calls[0][0]).not.toContain("change_resource_type IN");
  });

  it("only uses startDate without endDate -> default window", async () => {
    const c = fakeCustomer([]);
    (getCustomer as any).mockResolvedValue(c);
    await getChangeHistory({ customerId: "1", limit: 10, startDate: "2026-01-01" } as any);
    expect(c.query.mock.calls[0][0]).toContain("DURING LAST_14_DAYS");
  });

  it("rethrows on query failure", async () => {
    const c = fakeCustomer();
    c.query.mockRejectedValue(new Error("change history boom"));
    (getCustomer as any).mockResolvedValue(c);
    await expect(getChangeHistory({ customerId: "1", limit: 10 } as any)).rejects.toThrow(
      "change history boom"
    );
  });
});
