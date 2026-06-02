import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerReadParityTools, READ_PARITY_EXPECTED_TOOL_NAMES } from "./readParity.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerReadParityTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);
const lastQuery = () => (runQuery as any).mock.calls.at(-1)[0].query as string;

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runQuery as any).mockResolvedValue([]);
});

describe("readParity tools", () => {
  it("registers exactly the expected tool set", () => {
    expect([...tools.keys()].sort()).toEqual([...READ_PARITY_EXPECTED_TOOL_NAMES].sort());
    expect(tools.size).toBe(READ_PARITY_EXPECTED_TOOL_NAMES.length);
  });

  // ---- firstRowResult: found true and false ----------------------------------

  it("get_campaign returns found=true with the first row", async () => {
    (runQuery as any).mockResolvedValue([{ campaign: { id: "5" } }, { campaign: { id: "6" } }]);
    const res = await call("get_campaign", { customerId: "123-456-7890", campaignId: "5" });
    expect(res.isError).toBeUndefined();
    const json = toolJson(res) as any;
    expect(json).toEqual({ found: true, row: { campaign: { id: "5" } } });
    const q = lastQuery();
    expect(q).toContain("FROM campaign");
    expect(q).toContain("WHERE campaign.resource_name = 'customers/1234567890/campaigns/5'");
  });

  it("get_campaign returns found=false and null row when empty", async () => {
    (runQuery as any).mockResolvedValue([]);
    const json = toolJson(await call("get_campaign", { customerId: "1", campaignId: "5" })) as any;
    expect(json).toEqual({ found: false, row: null });
  });

  it("get_campaign accepts an already-qualified resource name", async () => {
    await call("get_campaign", { customerId: "1", campaignId: "customers/9/campaigns/77" });
    expect(lastQuery()).toContain("'customers/9/campaigns/77'");
  });

  // ---- list_campaign_budgets: with/without status ---------------------------

  it("list_campaign_budgets builds GAQL with and without a status filter", async () => {
    await call("list_campaign_budgets", { customerId: "1", limit: 5 });
    expect(lastQuery()).not.toContain("WHERE");
    expect(lastQuery()).toContain("LIMIT 5");

    await call("list_campaign_budgets", { customerId: "1", limit: 7, status: "ENABLED" });
    expect(lastQuery()).toContain("WHERE campaign_budget.status = ENABLED");
  });

  it("get_campaign_budget builds the resource-name filter", async () => {
    await call("get_campaign_budget", { customerId: "1", budgetId: "42" });
    expect(lastQuery()).toContain("WHERE campaign_budget.resource_name = 'customers/1/campaignBudgets/42'");
  });

  it("get_ad_group builds the resource-name filter", async () => {
    await call("get_ad_group", { customerId: "1", adGroupId: "42" });
    expect(lastQuery()).toContain("WHERE ad_group.resource_name = 'customers/1/adGroups/42'");
  });

  // ---- get_keyword: both branches + invalid criterion -----------------------

  it("get_keyword uses the resourceName branch", async () => {
    await call("get_keyword", { customerId: "1", resourceName: "customers/1/adGroupCriteria/2~3" });
    expect(lastQuery()).toContain("ad_group_criterion.resource_name = 'customers/1/adGroupCriteria/2~3'");
  });

  it("get_keyword uses the adGroupId+criterionId branch", async () => {
    await call("get_keyword", { customerId: "1", adGroupId: "customers/1/adGroups/22", criterionId: "abc33" });
    const q = lastQuery();
    expect(q).toContain("ad_group.id = 22");
    expect(q).toContain("ad_group_criterion.criterion_id = 33");
  });

  it("get_keyword errors when criterionId has no digits", async () => {
    const res = await call("get_keyword", { customerId: "1", adGroupId: "22", criterionId: "xx" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Invalid criterionId/);
  });

  // ---- get_ad: both branches + invalid adId ---------------------------------

  it("get_ad uses the resourceName branch", async () => {
    await call("get_ad", { customerId: "1", resourceName: "customers/1/adGroupAds/2~3" });
    expect(lastQuery()).toContain("ad_group_ad.resource_name = 'customers/1/adGroupAds/2~3'");
  });

  it("get_ad uses the adGroupId+adId branch", async () => {
    await call("get_ad", { customerId: "1", adGroupId: "22", adId: "55" });
    const q = lastQuery();
    expect(q).toContain("ad_group.id = 22");
    expect(q).toContain("ad_group_ad.ad.id = 55");
  });

  it("get_ad errors when adId has no digits", async () => {
    const res = await call("get_ad", { customerId: "1", adGroupId: "22", adId: "zz" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Invalid adId/);
  });

  it("get_asset builds the resource-name filter", async () => {
    await call("get_asset", { customerId: "1", assetId: "8" });
    expect(lastQuery()).toContain("WHERE asset.resource_name = 'customers/1/assets/8'");
  });

  it("get_asset_group builds the resource-name filter", async () => {
    await call("get_asset_group", { customerId: "1", assetGroupId: "8" });
    expect(lastQuery()).toContain("WHERE asset_group.resource_name = 'customers/1/assetGroups/8'");
  });

  // ---- list_campaign_negative_keywords: with/without campaignId -------------

  it("list_campaign_negative_keywords without campaignId filter", async () => {
    await call("list_campaign_negative_keywords", { customerId: "1", limit: 3 });
    const q = lastQuery();
    expect(q).toContain("campaign_criterion.negative = true");
    expect(q).toContain("campaign_criterion.type = KEYWORD");
    expect(q).not.toContain("campaign.id =");
    expect(q).toContain("LIMIT 3");
  });

  it("list_campaign_negative_keywords with campaignId filter", async () => {
    await call("list_campaign_negative_keywords", { customerId: "1", limit: 3, campaignId: "99" });
    expect(lastQuery()).toContain("campaign.id = 99");
  });

  // ---- get_campaign_negative_keyword: both branches + invalid ---------------

  it("get_campaign_negative_keyword resourceName branch", async () => {
    await call("get_campaign_negative_keyword", { customerId: "1", resourceName: "customers/1/campaignCriteria/2~3" });
    expect(lastQuery()).toContain("campaign_criterion.resource_name = 'customers/1/campaignCriteria/2~3'");
  });

  it("get_campaign_negative_keyword campaignId+criterionId branch", async () => {
    await call("get_campaign_negative_keyword", { customerId: "1", campaignId: "12", criterionId: "34" });
    const q = lastQuery();
    expect(q).toContain("campaign.id = 12");
    expect(q).toContain("campaign_criterion.criterion_id = 34");
  });

  it("get_campaign_negative_keyword errors on non-numeric criterionId", async () => {
    const res = await call("get_campaign_negative_keyword", { customerId: "1", campaignId: "12", criterionId: "--" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Invalid criterionId/);
  });

  // ---- list_ad_group_negative_keywords --------------------------------------

  it("list_ad_group_negative_keywords without adGroupId filter", async () => {
    await call("list_ad_group_negative_keywords", { customerId: "1", limit: 4 });
    const q = lastQuery();
    expect(q).toContain("ad_group_criterion.negative = true");
    expect(q).not.toContain("ad_group.id =");
  });

  it("list_ad_group_negative_keywords with adGroupId filter", async () => {
    await call("list_ad_group_negative_keywords", { customerId: "1", limit: 4, adGroupId: "55" });
    expect(lastQuery()).toContain("ad_group.id = 55");
  });

  // ---- get_ad_group_negative_keyword: both branches + invalid ---------------

  it("get_ad_group_negative_keyword resourceName branch", async () => {
    await call("get_ad_group_negative_keyword", { customerId: "1", resourceName: "customers/1/adGroupCriteria/2~3" });
    expect(lastQuery()).toContain("ad_group_criterion.resource_name = 'customers/1/adGroupCriteria/2~3'");
  });

  it("get_ad_group_negative_keyword adGroupId+criterionId branch", async () => {
    await call("get_ad_group_negative_keyword", { customerId: "1", adGroupId: "12", criterionId: "34" });
    const q = lastQuery();
    expect(q).toContain("ad_group.id = 12");
    expect(q).toContain("ad_group_criterion.criterion_id = 34");
  });

  it("get_ad_group_negative_keyword errors on non-numeric criterionId", async () => {
    const res = await call("get_ad_group_negative_keyword", { customerId: "1", adGroupId: "12", criterionId: "zz" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Invalid criterionId/);
  });

  it("get_shared_negative_keyword_list builds the resource-name filter", async () => {
    await call("get_shared_negative_keyword_list", { customerId: "1", sharedSetId: "8" });
    const q = lastQuery();
    expect(q).toContain("shared_set.type = NEGATIVE_KEYWORDS");
    expect(q).toContain("shared_set.resource_name = 'customers/1/sharedSets/8'");
  });

  it("get_conversion_action builds the resource-name filter", async () => {
    await call("get_conversion_action", { customerId: "1", conversionActionId: "8" });
    expect(lastQuery()).toContain("WHERE conversion_action.resource_name = 'customers/1/conversionActions/8'");
  });

  // ---- get_customer_conversion_goal: both branches --------------------------

  it("get_customer_conversion_goal resourceName branch", async () => {
    await call("get_customer_conversion_goal", { customerId: "1", resourceName: "customers/1/customerConversionGoals/A~B" });
    expect(lastQuery()).toContain("'customers/1/customerConversionGoals/A~B'");
  });

  it("get_customer_conversion_goal category+origin branch", async () => {
    await call("get_customer_conversion_goal", { customerId: "123-456-7890", category: "PURCHASE", origin: "WEBSITE" });
    expect(lastQuery()).toContain("'customers/1234567890/customerConversionGoals/PURCHASE~WEBSITE'");
  });

  // ---- get_campaign_conversion_goal: both branches --------------------------

  it("get_campaign_conversion_goal resourceName branch", async () => {
    await call("get_campaign_conversion_goal", { customerId: "1", resourceName: "customers/1/campaignConversionGoals/7~A~B" });
    expect(lastQuery()).toContain("'customers/1/campaignConversionGoals/7~A~B'");
  });

  it("get_campaign_conversion_goal campaignId+category+origin branch", async () => {
    await call("get_campaign_conversion_goal", {
      customerId: "123-456-7890",
      campaignId: "customers/1/campaigns/77",
      category: "PURCHASE",
      origin: "WEBSITE",
    });
    expect(lastQuery()).toContain("'customers/1234567890/campaignConversionGoals/77~PURCHASE~WEBSITE'");
  });

  it("get_user_list builds the resource-name filter", async () => {
    await call("get_user_list", { customerId: "1", userListId: "8" });
    expect(lastQuery()).toContain("WHERE user_list.resource_name = 'customers/1/userLists/8'");
  });

  it("get_custom_audience builds the resource-name filter", async () => {
    await call("get_custom_audience", { customerId: "1", customAudienceId: "8" });
    expect(lastQuery()).toContain("WHERE custom_audience.resource_name = 'customers/1/customAudiences/8'");
  });

  it("get_combined_audience builds the resource-name filter", async () => {
    await call("get_combined_audience", { customerId: "1", combinedAudienceId: "8" });
    expect(lastQuery()).toContain("WHERE combined_audience.resource_name = 'customers/1/combinedAudiences/8'");
  });

  // ---- list_campaign_audience_targeting -------------------------------------

  it("list_campaign_audience_targeting without campaignId", async () => {
    await call("list_campaign_audience_targeting", { customerId: "1", limit: 9 });
    const q = lastQuery();
    expect(q).toContain("campaign_criterion.type IN ('AUDIENCE','CUSTOM_AUDIENCE','COMBINED_AUDIENCE','USER_LIST')");
    expect(q).not.toContain("campaign.id =");
    expect(q).toContain("LIMIT 9");
  });

  it("list_campaign_audience_targeting with campaignId", async () => {
    await call("list_campaign_audience_targeting", { customerId: "1", limit: 9, campaignId: "21" });
    expect(lastQuery()).toContain("campaign.id = 21");
  });

  // ---- list_ad_group_audience_targeting -------------------------------------

  it("list_ad_group_audience_targeting without adGroupId", async () => {
    await call("list_ad_group_audience_targeting", { customerId: "1", limit: 2 });
    const q = lastQuery();
    expect(q).toContain("ad_group_criterion.type IN ('AUDIENCE','CUSTOM_AUDIENCE','COMBINED_AUDIENCE','USER_LIST')");
    expect(q).not.toContain("ad_group.id =");
  });

  it("list_ad_group_audience_targeting with adGroupId", async () => {
    await call("list_ad_group_audience_targeting", { customerId: "1", limit: 2, adGroupId: "21" });
    expect(lastQuery()).toContain("ad_group.id = 21");
  });

  it("get_campaign_draft builds the resource-name filter", async () => {
    await call("get_campaign_draft", { customerId: "1", draftId: "8" });
    expect(lastQuery()).toContain("WHERE campaign_draft.resource_name = 'customers/1/campaignDrafts/8'");
  });

  it("get_bidding_strategy builds the resource-name filter", async () => {
    await call("get_bidding_strategy", { customerId: "1", biddingStrategyId: "8" });
    expect(lastQuery()).toContain("WHERE bidding_strategy.resource_name = 'customers/1/biddingStrategies/8'");
  });

  it("get_bidding_seasonality_adjustment builds the resource-name filter", async () => {
    await call("get_bidding_seasonality_adjustment", { customerId: "1", seasonalityAdjustmentId: "8" });
    expect(lastQuery()).toContain(
      "WHERE bidding_seasonality_adjustment.resource_name = 'customers/1/biddingSeasonalityAdjustments/8'"
    );
  });

  it("get_bidding_data_exclusion builds the resource-name filter", async () => {
    await call("get_bidding_data_exclusion", { customerId: "1", dataExclusionId: "8" });
    expect(lastQuery()).toContain("WHERE bidding_data_exclusion.resource_name = 'customers/1/biddingDataExclusions/8'");
  });

  it("get_asset_set builds the resource-name filter", async () => {
    await call("get_asset_set", { customerId: "1", assetSetId: "8" });
    expect(lastQuery()).toContain("WHERE asset_set.resource_name = 'customers/1/assetSets/8'");
  });

  // ---- get_asset_set_asset: both branches -----------------------------------

  it("get_asset_set_asset resourceName branch", async () => {
    await call("get_asset_set_asset", { customerId: "1", resourceName: "customers/1/assetSetAssets/2~3" });
    expect(lastQuery()).toContain("asset_set_asset.resource_name = 'customers/1/assetSetAssets/2~3'");
  });

  it("get_asset_set_asset assetSetId+assetId branch", async () => {
    await call("get_asset_set_asset", { customerId: "123-456-7890", assetSetId: "22", assetId: "33" });
    expect(lastQuery()).toContain("'customers/1234567890/assetSetAssets/22~33'");
  });

  // ---- get_campaign_asset_set: both branches --------------------------------

  it("get_campaign_asset_set resourceName branch", async () => {
    await call("get_campaign_asset_set", { customerId: "1", resourceName: "customers/1/campaignAssetSets/2~3" });
    expect(lastQuery()).toContain("campaign_asset_set.resource_name = 'customers/1/campaignAssetSets/2~3'");
  });

  it("get_campaign_asset_set campaignId+assetSetId branch", async () => {
    await call("get_campaign_asset_set", { customerId: "123-456-7890", campaignId: "22", assetSetId: "33" });
    expect(lastQuery()).toContain("'customers/1234567890/campaignAssetSets/22~33'");
  });

  it("get_asset_group_signal builds the resource-name filter", async () => {
    await call("get_asset_group_signal", { customerId: "1", resourceName: "customers/1/assetGroupSignals/2~3" });
    expect(lastQuery()).toContain("WHERE asset_group_signal.resource_name = 'customers/1/assetGroupSignals/2~3'");
  });

  // ---- get_experiment: both branches ----------------------------------------

  it("get_experiment with a bare id", async () => {
    await call("get_experiment", { customerId: "123-456-7890", experimentId: " 77 " });
    expect(lastQuery()).toContain("WHERE experiment.resource_name = 'customers/1234567890/experiments/77'");
  });

  it("get_experiment with an already-qualified resource name", async () => {
    await call("get_experiment", { customerId: "1", experimentId: "customers/9/experiments/55" });
    expect(lastQuery()).toContain("WHERE experiment.resource_name = 'customers/9/experiments/55'");
  });

  // ---- list_reach_plannable_products: uses customer.reachPlans ---------------

  it("list_reach_plannable_products calls reachPlans with the location id", async () => {
    const listPlannableProducts = vi.fn(async () => [{ plannable_product_code: "YOUTUBE" }]);
    const customer = fakeCustomer();
    (customer as any).reachPlans = { listPlannableProducts };
    (getCustomer as any).mockResolvedValue(customer);

    const res = await call("list_reach_plannable_products", { customerId: "9", locationId: "2840" });
    expect(getCustomer).toHaveBeenCalledWith("9", undefined);
    expect(listPlannableProducts).toHaveBeenCalledWith({ plannable_location_id: "2840" });
    expect(toolJson(res)).toEqual([{ plannable_product_code: "YOUTUBE" }]);
  });

  it("list_reach_plannable_products surfaces errors via asTool", async () => {
    const customer = fakeCustomer();
    (customer as any).reachPlans = {
      listPlannableProducts: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    (getCustomer as any).mockResolvedValue(customer);
    const res = await call("list_reach_plannable_products", { customerId: "9", locationId: "2840" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/boom/);
  });

  it("passes userId through to runQuery", async () => {
    await call("get_campaign", { customerId: "1", campaignId: "5", userId: "u-1" });
    expect((runQuery as any).mock.calls.at(-1)[0].userId).toBe("u-1");
  });

  // ---- additional reachable-path coverage -----------------------------------

  it("get_keyword returns found=true when a row is present (firstRowResult true)", async () => {
    (runQuery as any).mockResolvedValue([{ ad_group_criterion: { criterion_id: "33" } }]);
    const json = toolJson(
      await call("get_keyword", { customerId: "1", resourceName: "customers/1/adGroupCriteria/2~3" })
    ) as any;
    expect(json).toEqual({ found: true, row: { ad_group_criterion: { criterion_id: "33" } } });
  });

  it("get_ad returns found=false when no rows (firstRowResult false on get_ad)", async () => {
    (runQuery as any).mockResolvedValue([]);
    const json = toolJson(
      await call("get_ad", { customerId: "1", resourceName: "customers/1/adGroupAds/2~3" })
    ) as any;
    expect(json).toEqual({ found: false, row: null });
  });

  it("get_customer_conversion_goal escapes a resource name containing a quote", async () => {
    await call("get_customer_conversion_goal", {
      customerId: "1",
      resourceName: "customers/1/customerConversionGoals/A'B~C",
    });
    // escapeGaqlString doubles single quotes inside the literal
    expect(lastQuery()).toContain("customerConversionGoals/A");
  });

  it("get_asset_set_asset normalizes ID-bearing resource segments in the fallback branch", async () => {
    await call("get_asset_set_asset", {
      customerId: "1",
      assetSetId: "customers/1/assetSets/22",
      assetId: "customers/1/assets/33",
    });
    expect(lastQuery()).toContain("'customers/1/assetSetAssets/22~33'");
  });

  it("get_campaign_asset_set normalizes ID-bearing resource segments in the fallback branch", async () => {
    await call("get_campaign_asset_set", {
      customerId: "1",
      campaignId: "customers/1/campaigns/22",
      assetSetId: "customers/1/assetSets/33",
    });
    expect(lastQuery()).toContain("'customers/1/campaignAssetSets/22~33'");
  });

  // ---- enforced .refine() validation: violations + valid passes -------------
  //
  // Each of the 8 refined schemas is now validated at runtime: the tool is
  // registered with the bare object `.shape` for the MCP wire schema, while the
  // handler parses args against the FULL refined schema inside `asTool`, so a
  // refine failure surfaces as `{ isError: true }` (a ZodError carrying the
  // custom message). The cases below exercise BOTH sides of each refine
  // predicate (a violation that throws, and a valid input that passes through to
  // runQuery / the firstRowResult path).

  it("get_keyword refine: violation (no identifiers) is an error", async () => {
    const res = await call("get_keyword", { customerId: "1" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or adGroupId\+criterionId/);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("get_keyword refine: adGroupId without criterionId is an error", async () => {
    const res = await call("get_keyword", { customerId: "1", adGroupId: "22" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or adGroupId\+criterionId/);
  });

  it("get_keyword refine: valid resourceName passes", async () => {
    const res = await call("get_keyword", { customerId: "1", resourceName: "customers/1/adGroupCriteria/2~3" });
    expect(res.isError).toBeUndefined();
    expect(runQuery).toHaveBeenCalled();
  });

  it("get_ad refine: violation (no identifiers) is an error", async () => {
    const res = await call("get_ad", { customerId: "1" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or adGroupId\+adId/);
  });

  it("get_ad refine: adGroupId without adId is an error", async () => {
    const res = await call("get_ad", { customerId: "1", adGroupId: "22" });
    expect(res.isError).toBe(true);
  });

  it("get_ad refine: valid adGroupId+adId passes", async () => {
    const res = await call("get_ad", { customerId: "1", adGroupId: "22", adId: "55" });
    expect(res.isError).toBeUndefined();
  });

  it("get_campaign_negative_keyword refine: violation is an error", async () => {
    const res = await call("get_campaign_negative_keyword", { customerId: "1", campaignId: "12" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or campaignId\+criterionId/);
  });

  it("get_campaign_negative_keyword refine: valid input passes", async () => {
    const res = await call("get_campaign_negative_keyword", { customerId: "1", campaignId: "12", criterionId: "34" });
    expect(res.isError).toBeUndefined();
  });

  it("get_ad_group_negative_keyword refine: violation is an error", async () => {
    const res = await call("get_ad_group_negative_keyword", { customerId: "1", adGroupId: "12" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or adGroupId\+criterionId/);
  });

  it("get_ad_group_negative_keyword refine: valid input passes", async () => {
    const res = await call("get_ad_group_negative_keyword", { customerId: "1", adGroupId: "12", criterionId: "34" });
    expect(res.isError).toBeUndefined();
  });

  it("get_customer_conversion_goal refine: violation is an error", async () => {
    const res = await call("get_customer_conversion_goal", { customerId: "1", category: "PURCHASE" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or category\+origin/);
  });

  it("get_customer_conversion_goal refine: valid input passes", async () => {
    const res = await call("get_customer_conversion_goal", { customerId: "1", category: "PURCHASE", origin: "WEBSITE" });
    expect(res.isError).toBeUndefined();
  });

  it("get_campaign_conversion_goal refine: violation is an error", async () => {
    const res = await call("get_campaign_conversion_goal", { customerId: "1", campaignId: "7", category: "PURCHASE" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or campaignId\+category\+origin/);
  });

  it("get_campaign_conversion_goal refine: valid input passes", async () => {
    const res = await call("get_campaign_conversion_goal", {
      customerId: "1",
      campaignId: "7",
      category: "PURCHASE",
      origin: "WEBSITE",
    });
    expect(res.isError).toBeUndefined();
  });

  it("get_asset_set_asset refine: violation is an error", async () => {
    const res = await call("get_asset_set_asset", { customerId: "1", assetSetId: "22" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or assetSetId\+assetId/);
  });

  it("get_asset_set_asset refine: valid input passes", async () => {
    const res = await call("get_asset_set_asset", { customerId: "1", assetSetId: "22", assetId: "33" });
    expect(res.isError).toBeUndefined();
  });

  it("get_campaign_asset_set refine: violation is an error", async () => {
    const res = await call("get_campaign_asset_set", { customerId: "1", campaignId: "22" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or campaignId\+assetSetId/);
  });

  it("get_campaign_asset_set refine: valid input passes", async () => {
    const res = await call("get_campaign_asset_set", { customerId: "1", campaignId: "22", assetSetId: "33" });
    expect(res.isError).toBeUndefined();
  });
});
