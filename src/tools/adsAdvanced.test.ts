import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerAdsAdvancedTools } from "./adsAdvanced.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerAdsAdvancedTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([]);
});

const threeHeadlines = [{ text: "H1" }, { text: "H2" }, { text: "H3" }];
const twoDescriptions = [{ text: "D1" }, { text: "D2" }];

describe("adsAdvanced tools", () => {
  it("registers both tools", () => {
    expect([...tools.keys()].sort()).toEqual(["list_ads", "update_ad_content"].sort());
  });

  // ---- list_ads ----

  it("list_ads builds GAQL with no filters", async () => {
    await call("list_ads", { customerId: "1", limit: 100 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).not.toContain("WHERE");
    expect(q).toContain("LIMIT 100");
  });

  it("list_ads filters by campaignId only", async () => {
    await call("list_ads", { customerId: "1", campaignId: "5" });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain("WHERE campaign.id = 5");
    expect(q).not.toContain("ad_group.id =");
  });

  it("list_ads filters by adGroupId only", async () => {
    await call("list_ads", { customerId: "1", adGroupId: "9" });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain("WHERE ad_group.id = 9");
    expect(q).not.toContain("campaign.id =");
  });

  it("list_ads filters by both campaignId and adGroupId joined with AND", async () => {
    await call("list_ads", { customerId: "1", campaignId: "5", adGroupId: "9", limit: 3 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain("WHERE campaign.id = 5 AND ad_group.id = 9");
    expect(q).toContain("LIMIT 3");
  });

  // ---- update_ad_content ----

  it("update_ad_content errors when ad not found", async () => {
    (runQuery as any).mockResolvedValueOnce([]);
    const res = await call("update_ad_content", {
      customerId: "1",
      adGroupId: "9",
      adId: "5",
      headlines: threeHeadlines,
      descriptions: twoDescriptions,
      finalUrls: ["https://example.com"],
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/not found/i);
  });

  it("update_ad_content errors when too few headlines/descriptions", async () => {
    (runQuery as any).mockResolvedValueOnce([
      { ad_group_ad: { resource_name: "rn", ad: { final_urls: ["https://e.com"] } } },
    ]);
    const res = await call("update_ad_content", {
      customerId: "1",
      adGroupId: "9",
      adId: "5",
      headlines: [{ text: "only one" }],
      descriptions: twoDescriptions,
      finalUrls: ["https://example.com"],
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least 3 headlines and 2 descriptions/i);
  });

  it("update_ad_content errors when no final URLs available", async () => {
    (runQuery as any).mockResolvedValueOnce([
      { ad_group_ad: { resource_name: "rn", ad: {} } }, // no final_urls
    ]);
    const res = await call("update_ad_content", {
      customerId: "1",
      adGroupId: "9",
      adId: "5",
      headlines: threeHeadlines,
      descriptions: twoDescriptions,
      // no finalUrls and existing empty -> error
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one final url/i);
  });

  it("update_ad_content creates new ad from provided args (with pinned fields) and removes old", async () => {
    (runQuery as any).mockResolvedValueOnce([
      {
        ad_group_ad: {
          resource_name: "customers/1/adGroupAds/9~5",
          status: 2,
          ad: { final_urls: ["https://old.com"], responsive_search_ad: { path1: "old1", path2: "old2" } },
        },
      },
    ]);
    (runMutation as any)
      .mockResolvedValueOnce({
        mutate_operation_responses: [{ ad_group_ad_result: { resource_name: "customers/1/adGroupAds/9~99" } }],
      })
      .mockResolvedValueOnce({}); // remove

    const res = await call("update_ad_content", {
      customerId: "1",
      adGroupId: "9",
      adId: "5",
      headlines: [{ text: "H1", pinnedField: "HEADLINE_1" }, { text: "H2" }, { text: "H3" }],
      descriptions: [{ text: "D1", pinnedField: "DESCRIPTION_1" }, { text: "D2" }],
      finalUrls: ["https://new.com"],
      path1: "new1",
      path2: "new2",
      status: "ENABLED",
    });

    expect(res.isError).toBeUndefined();
    const out = toolJson(res) as any;
    expect(out).toEqual({
      previousAdResourceName: "customers/1/adGroupAds/9~5",
      newAdResourceName: "customers/1/adGroupAds/9~99",
    });

    const createOp = (runMutation as any).mock.calls[0][1][0].ad_group_ad_operation.create;
    expect(createOp.ad_group).toBe("customers/1/adGroups/9");
    expect(createOp.status).toBe("ENABLED");
    expect(createOp.ad.final_urls).toEqual(["https://new.com"]);
    const rsa = createOp.ad.responsive_search_ad;
    expect(rsa.headlines).toEqual([
      { text: "H1", pinned_field: "HEADLINE_1" },
      { text: "H2" },
      { text: "H3" },
    ]);
    expect(rsa.descriptions).toEqual([
      { text: "D1", pinned_field: "DESCRIPTION_1" },
      { text: "D2" },
    ]);
    expect(rsa.path1).toBe("new1");
    expect(rsa.path2).toBe("new2");

    // remove uses old resource name
    expect((runMutation as any).mock.calls[1][1][0].ad_group_ad_operation.remove).toBe(
      "customers/1/adGroupAds/9~5"
    );
  });

  it("update_ad_content falls back to existing content and derives status from row (ENABLED)", async () => {
    (runQuery as any).mockResolvedValueOnce([
      {
        ad_group_ad: {
          resource_name: "rn-old",
          status: 2, // ENABLED
          ad: {
            final_urls: ["https://existing.com"],
            responsive_search_ad: {
              headlines: [{ text: "EH1" }, { text: "EH2" }, { text: "EH3" }],
              descriptions: [{ text: "ED1" }, { text: "ED2" }],
              path1: "ep1",
              path2: "ep2",
            },
          },
        },
      },
    ]);
    (runMutation as any).mockResolvedValueOnce({}).mockResolvedValueOnce({});

    const res = await call("update_ad_content", { customerId: "1", adGroupId: "9", adId: "5" });
    expect(res.isError).toBeUndefined();
    const createOp = (runMutation as any).mock.calls[0][1][0].ad_group_ad_operation.create;
    expect(createOp.status).toBe("ENABLED"); // derived from status 2
    expect(createOp.ad.final_urls).toEqual(["https://existing.com"]);
    const rsa = createOp.ad.responsive_search_ad;
    expect(rsa.headlines).toEqual([{ text: "EH1" }, { text: "EH2" }, { text: "EH3" }]);
    expect(rsa.descriptions).toEqual([{ text: "ED1" }, { text: "ED2" }]);
    expect(rsa.path1).toBe("ep1");
    expect(rsa.path2).toBe("ep2");
    // newAdResourceName undefined when mutation returns no responses
    const out = toolJson(res) as any;
    expect(out.newAdResourceName).toBeUndefined();
  });

  it("update_ad_content derives PAUSED status when row status is not 2", async () => {
    (runQuery as any).mockResolvedValueOnce([
      {
        ad_group_ad: {
          resource_name: "rn-old",
          status: 3, // not ENABLED
          ad: {
            final_urls: ["https://existing.com"],
            responsive_search_ad: {
              headlines: [{ text: "EH1" }, { text: "EH2" }, { text: "EH3" }],
              descriptions: [{ text: "ED1" }, { text: "ED2" }],
            },
          },
        },
      },
    ]);
    (runMutation as any).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await call("update_ad_content", { customerId: "1", adGroupId: "9", adId: "5" });
    const createOp = (runMutation as any).mock.calls[0][1][0].ad_group_ad_operation.create;
    expect(createOp.status).toBe("PAUSED");
    // path1/path2 undefined since not provided and existing lacks them
    const rsa = createOp.ad.responsive_search_ad;
    expect(rsa.path1).toBeUndefined();
    expect(rsa.path2).toBeUndefined();
  });

  it("update_ad_content defaults status missing-row to PAUSED and tolerates absent ad/resource_name", async () => {
    // ad_group_ad present but no status/ad -> status defaults to 3 -> PAUSED, resource_name ""
    (runQuery as any).mockResolvedValueOnce([{ ad_group_ad: {} }]);
    (runMutation as any).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const res = await call("update_ad_content", {
      customerId: "1",
      adGroupId: "9",
      adId: "5",
      headlines: threeHeadlines,
      descriptions: twoDescriptions,
      finalUrls: ["https://new.com"],
    });
    expect(res.isError).toBeUndefined();
    const createOp = (runMutation as any).mock.calls[0][1][0].ad_group_ad_operation.create;
    expect(createOp.status).toBe("PAUSED");
    expect((runMutation as any).mock.calls[1][1][0].ad_group_ad_operation.remove).toBe("");
    const out = toolJson(res) as any;
    expect(out.previousAdResourceName).toBe("");
  });

  it("update_ad_content falls back to empty arrays when no args and no existing RSA", async () => {
    (runQuery as any).mockResolvedValueOnce([
      { ad_group_ad: { resource_name: "rn", ad: { final_urls: ["https://e.com"] } } }, // no responsive_search_ad
    ]);
    const res = await call("update_ad_content", { customerId: "1", adGroupId: "9", adId: "5" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least 3 headlines and 2 descriptions/i);
  });

  it("update_ad_content filters out blank/whitespace headlines and descriptions then errors", async () => {
    (runQuery as any).mockResolvedValueOnce([
      { ad_group_ad: { resource_name: "rn", ad: { final_urls: ["https://e.com"] } } },
    ]);
    const res = await call("update_ad_content", {
      customerId: "1",
      adGroupId: "9",
      adId: "5",
      headlines: [{ text: "H1" }, { text: "   " }, { text: "H3" }], // one blank -> only 2 valid
      descriptions: twoDescriptions,
      finalUrls: ["https://e.com"],
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least 3 headlines/i);
  });
});
