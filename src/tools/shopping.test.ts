import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../observability/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  listShoppingPerformance,
  listListingGroups,
  listAssetGroupListingGroups,
} from "./shopping.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";

let customer: ReturnType<typeof fakeCustomer>;

beforeEach(() => {
  vi.clearAllMocks();
  customer = fakeCustomer([{ row: 1 }]);
  (getCustomer as any).mockResolvedValue(customer);
});

describe("listShoppingPerformance", () => {
  it("runs the metrics query with date range and limit", async () => {
    const res = await listShoppingPerformance({ customerId: "1", dateRange: "LAST_7_DAYS", limit: 10 });
    const q = customer.query.mock.calls[0][0];
    expect(q).toContain("FROM shopping_performance_view");
    expect(q).toContain("DURING LAST_7_DAYS");
    expect(q).toContain("metrics.impressions");
    expect(q).toContain("LIMIT 10");
    expect(res).toEqual([{ row: 1 }]);
  });

  it("passes userId", async () => {
    await listShoppingPerformance({ customerId: "1", dateRange: "TODAY", limit: 5, userId: "u" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
  });

  it("falls back to non-metric query on REQUESTED_METRICS_FOR_MANAGER", async () => {
    customer.query
      .mockRejectedValueOnce({ errors: [{ message: "REQUESTED_METRICS_FOR_MANAGER" }] })
      .mockResolvedValueOnce([{ fallback: true }]);
    const res = await listShoppingPerformance({ customerId: "1", dateRange: "LAST_30_DAYS", limit: 50 });
    const q2 = customer.query.mock.calls[1][0];
    expect(q2).not.toContain("metrics.impressions");
    expect(q2).toContain("FROM shopping_performance_view");
    expect(res).toEqual([{ fallback: true }]);
  });

  it("rethrows other errors", async () => {
    customer.query.mockRejectedValueOnce(new Error("other failure"));
    await expect(listShoppingPerformance({ customerId: "1", dateRange: "TODAY", limit: 5 })).rejects.toThrow("other failure");
  });

  it("handles null/undefined error in JSON.stringify fallback guard", async () => {
    customer.query.mockRejectedValueOnce(null);
    await expect(listShoppingPerformance({ customerId: "1", dateRange: "TODAY", limit: 5 })).rejects.toBe(null);
  });
});

describe("listListingGroups", () => {
  it("queries without ad group filter", async () => {
    await listListingGroups({ customerId: "1" });
    const q = customer.query.mock.calls[0][0];
    expect(q).toContain("WHERE ad_group_criterion.type = 'LISTING_GROUP'");
    expect(q).not.toContain("ad_group.id =");
  });

  it("adds ad group filter when provided", async () => {
    await listListingGroups({ customerId: "1", adGroupId: "999" });
    expect(customer.query.mock.calls[0][0]).toContain("AND ad_group.id = 999");
  });
});

describe("listAssetGroupListingGroups", () => {
  it("queries without asset group filter", async () => {
    await listAssetGroupListingGroups({ customerId: "1" });
    const q = customer.query.mock.calls[0][0];
    expect(q).toContain("FROM asset_group_listing_group_filter");
    expect(q).not.toContain("asset_group.id =");
  });

  it("adds asset group filter when provided", async () => {
    await listAssetGroupListingGroups({ customerId: "1", assetGroupId: "888" });
    expect(customer.query.mock.calls[0][0]).toContain("AND asset_group.id = 888");
  });
});
