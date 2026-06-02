import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerCampaignCloneTools } from "./campaignClone.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerCampaignCloneTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

// A mutation result shaped for extractResourceName: result.mutate_operation_responses[0][key].resource_name
function mutResult(key: string, resourceName: string) {
  return { mutate_operation_responses: [{ [key]: { resource_name: resourceName } }] };
}

// runMutation implementation that inspects the first operation to decide what
// resource_name to return (budget create / campaign create / ad group create),
// and returns a generic result otherwise.
function defaultMutation() {
  return (_customer: unknown, ops: any[]) => {
    const first = ops[0] || {};
    if (first.campaign_budget_operation) {
      return Promise.resolve(mutResult("campaign_budget_result", "customers/1/campaignBudgets/500"));
    }
    if (first.campaign_operation) {
      return Promise.resolve(mutResult("campaign_result", "customers/1/campaigns/900"));
    }
    if (first.ad_group_operation) {
      return Promise.resolve(mutResult("ad_group_result", "customers/1/adGroups/700"));
    }
    return Promise.resolve({});
  };
}

// Default source rows for the campaign + budget lookups.
function sourceCampaignRow(overrides: Record<string, unknown> = {}) {
  return {
    campaign: {
      id: "10",
      name: "Source",
      bidding_strategy_type: 0,
      advertising_channel_type: "SEARCH",
      network_settings: {
        target_google_search: true,
        target_search_network: false,
        target_content_network: false,
        target_partner_search_network: false,
      },
      contains_eu_political_advertising: 3,
      campaign_budget: "customers/1/campaignBudgets/1",
      ...overrides,
    },
  };
}
function budgetRow() {
  return { campaign_budget: { name: "SrcBudget", amount_micros: 1000 } };
}

// Configure runQuery to respond to each GAQL query by inspecting its FROM clause.
function setupQuery(opts: {
  source?: any[];
  budget?: any[];
  adGroups?: any[];
  keywords?: any[];
  ads?: any[];
  negatives?: any[];
  device?: any[];
} = {}) {
  const {
    source = [sourceCampaignRow()],
    budget = [budgetRow()],
    adGroups = [],
    keywords = [],
    ads = [],
    negatives = [],
    device = [],
  } = opts;
  (runQuery as any).mockImplementation(async ({ query }: { query: string }) => {
    if (query.includes("FROM campaign_budget")) return budget;
    if (query.includes("FROM keyword_view")) return keywords;
    if (query.includes("FROM ad_group_ad")) return ads;
    if (query.includes("FROM ad_group")) return adGroups;
    if (query.includes("campaign_criterion.negative = true")) return negatives;
    if (query.includes("campaign_criterion.type = DEVICE")) return device;
    if (query.includes("campaign.bidding_strategy_type")) return source;
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockImplementation(defaultMutation());
  setupQuery();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("campaignClone tools", () => {
  it("registers both tools", () => {
    expect([...tools.keys()].sort()).toEqual(["duplicate_campaign", "duplicate_campaign_by_device"].sort());
  });

  describe("duplicate_campaign", () => {
    it("clones a minimal campaign with no ad groups/keywords/ads and a default name", async () => {
      const res = await call("duplicate_campaign", {
        customerId: "1",
        sourceCampaignId: "10",
        status: "PAUSED",
        copyCampaignNegatives: true,
      });
      const out = toolJson(res) as any;
      expect(out.targetCampaignId).toBe("900");
      expect(out.campaignResourceName).toBe("customers/1/campaigns/900");
      expect(out.budgetResourceName).toBe("customers/1/campaignBudgets/500");
      expect(out.adGroupsCreated).toBe(0);
      expect(out.keywordsCopied).toBe(0);
      expect(out.adsCopied).toBe(0);
      // copyNegatives true -> runs the negatives query (empty -> 0)
      expect(out.negativesCopied).toBe(0);

      // budget create operation payload
      const budgetOp = (runMutation as any).mock.calls[0][1][0].campaign_budget_operation.create;
      expect(budgetOp).toMatchObject({
        name: expect.stringContaining("SrcBudget - Clone -"),
        amount_micros: 1000,
        delivery_method: "STANDARD",
        explicitly_shared: false,
      });
      // campaign create operation payload
      const campOp = (runMutation as any).mock.calls[1][1][0].campaign_operation.create;
      expect(campOp).toMatchObject({
        name: expect.stringContaining("Campaign Copy"),
        status: "PAUSED",
        campaign_budget: "customers/1/campaignBudgets/500",
        advertising_channel_type: "SEARCH",
        contains_eu_political_advertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      });
      expect(campOp.manual_cpc).toEqual({});
      expect(campOp.network_settings.target_google_search).toBe(true);
    });

    it("honours an explicit target name and status, and skips negatives", async () => {
      const res = await call("duplicate_campaign", {
        customerId: "1",
        sourceCampaignId: "10",
        targetCampaignName: "Custom",
        status: "ENABLED",
        copyCampaignNegatives: false,
      });
      const out = toolJson(res) as any;
      const campOp = (runMutation as any).mock.calls[1][1][0].campaign_operation.create;
      expect(campOp.name).toBe("Custom");
      expect(campOp.status).toBe("ENABLED");
      expect(out.negativesCopied).toBe(0);
      // negatives query should NOT have been issued
      const negativeQueried = (runQuery as any).mock.calls.some((c: any[]) =>
        c[0].query.includes("campaign_criterion.negative = true")
      );
      expect(negativeQueried).toBe(false);
    });

    it("throws when the source campaign is not found", async () => {
      setupQuery({ source: [] });
      const res = await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/Source campaign 10 not found/);
    });

    it("throws when the source budget is not found", async () => {
      setupQuery({ budget: [] });
      const res = await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/Source campaign budget not found/);
    });

    it("selects maximize_conversion_value bidding (type 11)", async () => {
      setupQuery({ source: [sourceCampaignRow({ bidding_strategy_type: 11 })] });
      await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const campOp = (runMutation as any).mock.calls[1][1][0].campaign_operation.create;
      expect(campOp.maximize_conversion_value).toEqual({});
    });

    it("selects maximize_conversions bidding (type 10)", async () => {
      setupQuery({ source: [sourceCampaignRow({ bidding_strategy_type: 10 })] });
      await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const campOp = (runMutation as any).mock.calls[1][1][0].campaign_operation.create;
      expect(campOp.maximize_conversions).toEqual({});
    });

    it("normalizes CONTAINS_EU political advertising (numeric 2) and missing channel type", async () => {
      setupQuery({
        source: [
          sourceCampaignRow({
            contains_eu_political_advertising: 2,
            advertising_channel_type: undefined,
          }),
        ],
      });
      await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const campOp = (runMutation as any).mock.calls[1][1][0].campaign_operation.create;
      expect(campOp.contains_eu_political_advertising).toBe("CONTAINS_EU_POLITICAL_ADVERTISING");
      expect(campOp.advertising_channel_type).toBe("SEARCH");
    });

    it("normalizes CONTAINS string political advertising value", async () => {
      setupQuery({
        source: [sourceCampaignRow({ contains_eu_political_advertising: "CONTAINS_EU_POLITICAL_ADVERTISING" })],
      });
      await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const campOp = (runMutation as any).mock.calls[1][1][0].campaign_operation.create;
      expect(campOp.contains_eu_political_advertising).toBe("CONTAINS_EU_POLITICAL_ADVERTISING");
    });

    it("falls back to DOES_NOT for an unknown political advertising value and default budget fields", async () => {
      setupQuery({
        source: [
          sourceCampaignRow({
            contains_eu_political_advertising: 0,
            network_settings: undefined,
          }),
        ],
        budget: [{ campaign_budget: {} }], // no name / no amount_micros -> defaults
      });
      await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10", status: "PAUSED" });
      const budgetOp = (runMutation as any).mock.calls[0][1][0].campaign_budget_operation.create;
      expect(budgetOp.name).toMatch(/^Budget - Clone -/);
      expect(budgetOp.amount_micros).toBe(0);
      const campOp = (runMutation as any).mock.calls[1][1][0].campaign_operation.create;
      expect(campOp.contains_eu_political_advertising).toBe("DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING");
      // network settings default to false when source has none
      expect(campOp.network_settings.target_google_search).toBe(false);
    });

    it("normalizes the explicit DOES_NOT string political advertising value", async () => {
      setupQuery({
        source: [
          sourceCampaignRow({ contains_eu_political_advertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" }),
        ],
      });
      await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const campOp = (runMutation as any).mock.calls[1][1][0].campaign_operation.create;
      expect(campOp.contains_eu_political_advertising).toBe("DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING");
    });

    it("copies ad groups (with and without type/cpc), keywords, and ads", async () => {
      setupQuery({
        adGroups: [
          {
            ad_group: { id: "20", name: "AG1", status: "ENABLED", type: "SEARCH_STANDARD", cpc_bid_micros: 5000 },
          },
          // second ad group with no type / no cpc / no name -> defaults applied
          { ad_group: { id: "21", status: 3 } },
        ],
        keywords: [
          {
            ad_group: { id: "20" },
            ad_group_criterion: {
              status: "ENABLED",
              cpc_bid_micros: 1234,
              keyword: { text: "shoes", match_type: "BROAD" },
            },
          },
          // keyword for unknown ad group -> skipped (no targetAdGroupId)
          {
            ad_group: { id: "999" },
            ad_group_criterion: { keyword: { text: "skip", match_type: "EXACT" } },
          },
          // keyword with no text -> skipped
          {
            ad_group: { id: "20" },
            ad_group_criterion: { keyword: { match_type: "PHRASE" } },
          },
          // keyword with null match_type -> skipped
          {
            ad_group: { id: "20" },
            ad_group_criterion: { keyword: { text: "nomatch", match_type: null } },
          },
        ],
        ads: [
          {
            ad_group: { id: "20" },
            ad_group_ad: {
              status: "PAUSED",
              ad: {
                final_urls: ["https://a.com"],
                responsive_search_ad: {
                  headlines: [{ text: "h1" }, { text: "h2" }, { text: "h3" }, { text: "  " }],
                  descriptions: [{ text: "d1" }, { text: "d2" }],
                  path1: "p1",
                  path2: "p2",
                },
              },
            },
          },
          // ad for unknown ad group -> skipped
          { ad_group: { id: "999" }, ad_group_ad: { ad: { final_urls: ["x"], responsive_search_ad: {} } } },
          // ad with no rsa -> skipped
          { ad_group: { id: "20" }, ad_group_ad: { ad: { final_urls: ["x"] } } },
          // ad with empty final_urls -> skipped
          {
            ad_group: { id: "20" },
            ad_group_ad: { ad: { final_urls: [], responsive_search_ad: { headlines: [], descriptions: [] } } },
          },
          // ad with too few headlines/descriptions -> skipped
          {
            ad_group: { id: "20" },
            ad_group_ad: {
              ad: {
                final_urls: ["https://b.com"],
                responsive_search_ad: { headlines: [{ text: "only1" }], descriptions: [{ text: "d" }] },
              },
            },
          },
        ],
      });

      const res = await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const out = toolJson(res) as any;
      expect(out.adGroupsCreated).toBe(2);
      expect(out.keywordsCopied).toBe(1);
      expect(out.adsCopied).toBe(1);

      // find the ad group create with defaults (id 21)
      const adGroupCreates = (runMutation as any).mock.calls
        .map((c: any[]) => c[1][0]?.ad_group_operation?.create)
        .filter(Boolean);
      const defaulted = adGroupCreates.find((c: any) => c.name === "Ad Group");
      expect(defaulted).toBeTruthy();
      expect(defaulted.status).toBe("PAUSED"); // status 3 -> PAUSED
      expect(defaulted).not.toHaveProperty("type");
      expect(defaulted).not.toHaveProperty("cpc_bid_micros");

      const withType = adGroupCreates.find((c: any) => c.name === "AG1");
      expect(withType.type).toBe("SEARCH_STANDARD");
      expect(withType.cpc_bid_micros).toBe(5000);
      expect(withType.status).toBe("ENABLED");

      // keyword op payload
      const kwOp = (runMutation as any).mock.calls
        .map((c: any[]) => c[1][0]?.ad_group_criterion_operation?.create)
        .find(Boolean);
      expect(kwOp.ad_group).toBe("customers/1/adGroups/700");
      expect(kwOp.keyword).toEqual({ text: "shoes", match_type: "BROAD" });
      expect(kwOp.cpc_bid_micros).toBe(1234);

      // ad op payload (whitespace headline filtered out -> 3 headlines)
      const adOp = (runMutation as any).mock.calls
        .map((c: any[]) => c[1][0]?.ad_group_ad_operation?.create)
        .find(Boolean);
      expect(adOp.ad.responsive_search_ad.headlines).toHaveLength(3);
      expect(adOp.ad.responsive_search_ad.descriptions).toHaveLength(2);
      expect(adOp.ad.responsive_search_ad.path1).toBe("p1");
      expect(adOp.ad.responsive_search_ad.path2).toBe("p2");
      expect(adOp.status).toBe("PAUSED");
    });

    it("omits path1/path2 when absent and handles missing headlines/descriptions arrays", async () => {
      setupQuery({
        adGroups: [{ ad_group: { id: "20", name: "AG" } }],
        ads: [
          {
            ad_group: { id: "20" },
            ad_group_ad: {
              ad: {
                final_urls: ["https://a.com"],
                responsive_search_ad: {
                  headlines: [{ text: "h1" }, { text: "h2" }, { text: "h3" }],
                  descriptions: [{ text: "d1" }, { text: "d2" }],
                },
              },
            },
          },
        ],
      });
      await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const adOp = (runMutation as any).mock.calls
        .map((c: any[]) => c[1][0]?.ad_group_ad_operation?.create)
        .find(Boolean);
      expect(adOp.ad.responsive_search_ad).not.toHaveProperty("path1");
      expect(adOp.ad.responsive_search_ad).not.toHaveProperty("path2");
    });

    it("handles rows with missing ad_group ids and rsa with no headlines/descriptions arrays", async () => {
      setupQuery({
        adGroups: [{ ad_group: { id: "20", name: "AG" } }],
        keywords: [
          // keyword row with no ad_group id -> String(undefined||"") = "" -> skipped
          { ad_group: {}, ad_group_criterion: { keyword: { text: "k", match_type: "BROAD" } } },
        ],
        ads: [
          // ad row with no ad_group id -> "" -> skipped
          {
            ad_group: {},
            ad_group_ad: {
              ad: { final_urls: ["https://a.com"], responsive_search_ad: { headlines: [], descriptions: [] } },
            },
          },
          // valid ad group but rsa missing headlines/descriptions arrays -> defaults to [] -> filtered out
          {
            ad_group: { id: "20" },
            ad_group_ad: { ad: { final_urls: ["https://a.com"], responsive_search_ad: {} } },
          },
        ],
      });
      const res = await call("duplicate_campaign", {
        customerId: "1",
        sourceCampaignId: "10",
        status: "PAUSED",
        copyCampaignNegatives: false,
      });
      const out = toolJson(res) as any;
      expect(out.keywordsCopied).toBe(0);
      expect(out.adsCopied).toBe(0);
      expect(out.adGroupsCreated).toBe(1);
    });

    it("copies campaign negatives, skipping rows without text or match_type", async () => {
      setupQuery({
        negatives: [
          { campaign_criterion: { keyword: { text: "neg1", match_type: 4 } } },
          { campaign_criterion: { keyword: { match_type: 3 } } }, // no text -> skip
          { campaign_criterion: { keyword: { text: "neg2", match_type: null } } }, // null match -> skip
          { campaign_criterion: { keyword: { text: "neg3", match_type: 2 } } },
        ],
      });
      const res = await call("duplicate_campaign", {
        customerId: "1",
        sourceCampaignId: "10",
        copyCampaignNegatives: true,
      });
      const out = toolJson(res) as any;
      expect(out.negativesCopied).toBe(2);

      const negOps = (runMutation as any).mock.calls
        .map((c: any[]) => c[1])
        .find((ops: any[]) => ops[0]?.campaign_criterion_operation?.create?.negative === true);
      expect(negOps).toBeTruthy();
      const create = negOps[0].campaign_criterion_operation.create;
      expect(create.campaign).toBe("customers/1/campaigns/900");
      expect(create.status).toBe("ENABLED");
      expect(create.keyword.match_type).toBe("BROAD"); // 4 -> BROAD
    });

    it("falls back to default match type for an unknown numeric match value", async () => {
      setupQuery({
        negatives: [{ campaign_criterion: { keyword: { text: "neg", match_type: 99 } } }],
      });
      await call("duplicate_campaign", {
        customerId: "1",
        sourceCampaignId: "10",
        copyCampaignNegatives: true,
      });
      const negOps = (runMutation as any).mock.calls
        .map((c: any[]) => c[1])
        .find((ops: any[]) => ops[0]?.campaign_criterion_operation?.create?.negative === true);
      expect(negOps[0].campaign_criterion_operation.create.keyword.match_type).toBe("PHRASE");
    });

    it("normalizes PHRASE and EXACT match types from strings", async () => {
      setupQuery({
        adGroups: [{ ad_group: { id: "20", name: "AG" } }],
        keywords: [
          {
            ad_group: { id: "20" },
            ad_group_criterion: { status: 2, keyword: { text: "k-phrase", match_type: "PHRASE" } },
          },
          {
            ad_group: { id: "20" },
            ad_group_criterion: { status: 99, keyword: { text: "k-exact", match_type: "EXACT" } },
          },
        ],
      });
      await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10", status: "PAUSED" });
      const kwCreates = (runMutation as any).mock.calls
        .flatMap((c: any[]) => c[1])
        .map((op: any) => op?.ad_group_criterion_operation?.create)
        .filter(Boolean);
      const phrase = kwCreates.find((c: any) => c.keyword.text === "k-phrase");
      const exact = kwCreates.find((c: any) => c.keyword.text === "k-exact");
      expect(phrase.keyword.match_type).toBe("PHRASE");
      expect(phrase.status).toBe("ENABLED"); // status 2 -> ENABLED
      expect(exact.keyword.match_type).toBe("EXACT");
      expect(exact.status).toBe("PAUSED"); // status 99 falls back to clone default PAUSED
    });

    it("throws when a mutation result is missing the expected resource_name", async () => {
      (runMutation as any).mockResolvedValue({});
      const res = await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/Missing campaign_budget_result\.resource_name/);
    });

    it("skips an ad group whose create result yields an empty newId (trailing-slash guard, line 81)", async () => {
      setupQuery({
        adGroups: [{ ad_group: { id: "20", name: "AG" } }], // has oldId
      });
      (runMutation as any).mockImplementation((_c: unknown, ops: any[]) => {
        const first = ops[0] || {};
        if (first.campaign_budget_operation)
          return Promise.resolve(mutResult("campaign_budget_result", "customers/1/campaignBudgets/500"));
        if (first.campaign_operation)
          return Promise.resolve(mutResult("campaign_result", "customers/1/campaigns/900"));
        if (first.ad_group_operation)
          // trailing slash -> split("/").pop() === "" -> newId falsy -> not mapped
          return Promise.resolve(mutResult("ad_group_result", "customers/1/adGroups/"));
        return Promise.resolve({});
      });
      const res = await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const out = toolJson(res) as any;
      // oldId present but newId empty -> not registered in the map
      expect(out.adGroupsCreated).toBe(0);
    });

    it("derives an empty targetCampaignId when the campaign resource_name ends with a slash (line 262)", async () => {
      (runMutation as any).mockImplementation((_c: unknown, ops: any[]) => {
        const first = ops[0] || {};
        if (first.campaign_budget_operation)
          return Promise.resolve(mutResult("campaign_budget_result", "customers/1/campaignBudgets/500"));
        if (first.campaign_operation)
          // trailing slash -> split("/").pop() === "" -> targetCampaignId falsy branch
          return Promise.resolve(mutResult("campaign_result", "customers/1/campaigns/"));
        if (first.ad_group_operation)
          return Promise.resolve(mutResult("ad_group_result", "customers/1/adGroups/700"));
        return Promise.resolve({});
      });
      const res = await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const out = toolJson(res) as any;
      expect(out.targetCampaignId).toBe("");
    });

    it("skips an ad group whose create result has no usable ids (oldId/newId guard)", async () => {
      setupQuery({
        adGroups: [{ ad_group: { name: "NoId" } }], // no id -> oldId empty -> not mapped
      });
      (runMutation as any).mockImplementation((_c: unknown, ops: any[]) => {
        const first = ops[0] || {};
        if (first.campaign_budget_operation)
          return Promise.resolve(mutResult("campaign_budget_result", "customers/1/campaignBudgets/500"));
        if (first.campaign_operation)
          return Promise.resolve(mutResult("campaign_result", "customers/1/campaigns/900"));
        if (first.ad_group_operation)
          return Promise.resolve(mutResult("ad_group_result", "customers/1/adGroups/700"));
        return Promise.resolve({});
      });
      const res = await call("duplicate_campaign", { customerId: "1", sourceCampaignId: "10" });
      const out = toolJson(res) as any;
      // ad group was created but not registered in the map (oldId empty)
      expect(out.adGroupsCreated).toBe(0);
    });
  });

  describe("duplicate_campaign_by_device", () => {
    it("creates desktop+mobile clones and applies device bid-modifier splits", async () => {
      // device rows: types 2(MOBILE),3(TABLET),4(DESKTOP)
      const deviceRows = [
        { campaign_criterion: { resource_name: "rn/m", device: { type: 2 } } },
        { campaign_criterion: { resource_name: "rn/t", device: { type: 3 } } },
        { campaign_criterion: { resource_name: "rn/d", device: { type: 4 } } },
        { campaign_criterion: { resource_name: "rn/x", device: {} } }, // type 0 -> excluded for both
      ];
      setupQuery({ device: deviceRows });

      const res = await call("duplicate_campaign_by_device", { customerId: "1", sourceCampaignId: "10" });
      const out = toolJson(res) as any;
      expect(out.desktop.targetCampaignId).toBe("900");
      expect(out.mobile.targetCampaignId).toBe("900");

      // collect device update mutations
      const deviceUpdates = (runMutation as any).mock.calls
        .map((c: any[]) => c[1])
        .filter((ops: any[]) => ops[0]?.campaign_criterion_operation?.update?.bid_modifier === 0);
      // desktop excludes {2,3}; mobile excludes {4,3}
      expect(deviceUpdates.length).toBe(2);
      const desktopUpdate = deviceUpdates[0];
      // desktop: rows with type in {2,3} => rn/m, rn/t
      expect(desktopUpdate.map((o: any) => o.campaign_criterion_operation.update.resource_name).sort()).toEqual(
        ["rn/m", "rn/t"]
      );
      const mobileUpdate = deviceUpdates[1];
      expect(mobileUpdate.map((o: any) => o.campaign_criterion_operation.update.resource_name).sort()).toEqual(
        ["rn/d", "rn/t"]
      );
      expect(desktopUpdate[0].campaign_criterion_operation.update_mask.paths).toEqual(["bid_modifier"]);
    });

    it("uses explicit desktop/mobile names and skips device mutation when no rows match", async () => {
      setupQuery({ device: [] });
      const res = await call("duplicate_campaign_by_device", {
        customerId: "1",
        sourceCampaignId: "10",
        desktopCampaignName: "Desk",
        mobileCampaignName: "Mob",
        copyCampaignNegatives: false,
      });
      const out = toolJson(res) as any;
      expect(out.desktop.targetCampaignId).toBe("900");
      // campaign creates should carry the provided names
      const campNames = (runMutation as any).mock.calls
        .map((c: any[]) => c[1][0]?.campaign_operation?.create?.name)
        .filter(Boolean);
      expect(campNames).toContain("Desk");
      expect(campNames).toContain("Mob");
      // no device bid_modifier updates issued
      const deviceUpdates = (runMutation as any).mock.calls
        .map((c: any[]) => c[1])
        .filter((ops: any[]) => ops[0]?.campaign_criterion_operation?.update?.bid_modifier === 0);
      expect(deviceUpdates.length).toBe(0);
    });

    it("uses default desktop/mobile names when not provided", async () => {
      setupQuery({ device: [] });
      await call("duplicate_campaign_by_device", { customerId: "1", sourceCampaignId: "10" });
      const campNames = (runMutation as any).mock.calls
        .map((c: any[]) => c[1][0]?.campaign_operation?.create?.name)
        .filter(Boolean);
      expect(campNames.some((n: string) => n.startsWith("Desktop Copy"))).toBe(true);
      expect(campNames.some((n: string) => n.startsWith("Mobile Copy"))).toBe(true);
    });
  });
});
