import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));

import { registerKeywordPlannerAdvancedTools } from "./keywordPlannerAdvanced.js";
import { getCustomer } from "../services/google-ads/client.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

function planCustomer() {
  const c: any = fakeCustomer();
  c.keywordPlanIdeas = {
    generateKeywordHistoricalMetrics: vi.fn(async () => ({ metrics: "hist" })),
    generateKeywordForecastMetrics: vi.fn(async () => ({ metrics: "forecast" })),
  };
  c.keywordPlans = {
    create: vi.fn(async () => ({ results: [{ resource_name: "plan/1" }] })),
    update: vi.fn(async () => ({ results: [{ resource_name: "plan/1" }] })),
    remove: vi.fn(async () => ({ results: [{ resource_name: "plan/1" }] })),
  };
  c.keywordPlanCampaigns = { create: vi.fn(async () => ({ results: [{ resource_name: "kpc/1" }] })) };
  c.keywordPlanAdGroups = { create: vi.fn(async () => ({ results: [{ resource_name: "kpag/1" }] })) };
  c.keywordPlanAdGroupKeywords = { create: vi.fn(async () => ({ results: [{ resource_name: "kw/1" }] })) };
  return c;
}

let customer: any;
const tools = captureTools(registerKeywordPlannerAdvancedTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

beforeEach(() => {
  vi.clearAllMocks();
  customer = planCustomer();
  (getCustomer as any).mockResolvedValue(customer);
});

describe("keywordPlannerAdvanced tools", () => {
  it("registers all 8 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "add_keyword_plan_keywords",
        "create_keyword_plan",
        "create_keyword_plan_ad_group",
        "create_keyword_plan_campaign",
        "generate_keyword_forecast_metrics",
        "generate_keyword_historical_metrics",
        "remove_keyword_plan",
        "update_keyword_plan",
      ].sort(),
    );
  });

  it("generate_keyword_historical_metrics builds the request", async () => {
    const res = await call("generate_keyword_historical_metrics", {
      customerId: "1",
      keywords: ["a", "b"],
      languageId: "1000",
      geoTargetConstantIds: ["2840", "2826"],
      includeAdultKeywords: true,
      keywordPlanNetwork: "GOOGLE_SEARCH",
    });
    expect(toolJson(res)).toEqual({ metrics: "hist" });
    const req = customer.keywordPlanIdeas.generateKeywordHistoricalMetrics.mock.calls[0][0];
    expect(req).toEqual({
      customer_id: "1",
      keywords: ["a", "b"],
      language: "languageConstants/1000",
      include_adult_keywords: true,
      geo_target_constants: ["geoTargetConstants/2840", "geoTargetConstants/2826"],
      keyword_plan_network: "GOOGLE_SEARCH",
    });
  });

  it("generate_keyword_historical_metrics handles empty geo list and partners network", async () => {
    await call("generate_keyword_historical_metrics", {
      customerId: "1",
      keywords: ["a"],
      languageId: "1000",
      geoTargetConstantIds: [],
      includeAdultKeywords: false,
      keywordPlanNetwork: "GOOGLE_SEARCH_AND_PARTNERS",
    });
    const req = customer.keywordPlanIdeas.generateKeywordHistoricalMetrics.mock.calls[0][0];
    expect(req.language).toBe("languageConstants/1000");
    expect(req.geo_target_constants).toEqual([]);
    expect(req.include_adult_keywords).toBe(false);
    expect(req.keyword_plan_network).toBe("GOOGLE_SEARCH_AND_PARTNERS");
  });

  it("generate_keyword_forecast_metrics builds the campaign payload with per-keyword bids and fallback bid", async () => {
    const res = await call("generate_keyword_forecast_metrics", {
      customerId: "1",
      keywords: [
        { text: "a", matchType: "EXACT", cpcBidMicros: 500000 },
        { text: "b", matchType: "BROAD" },
      ],
      languageId: "1001",
      geoTargetConstantIds: ["2840"],
      currencyCode: "EUR",
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      maxCpcBidMicros: 2000000,
      dailyBudgetMicros: 5000000,
      keywordPlanNetwork: "GOOGLE_SEARCH",
    });
    expect(toolJson(res)).toEqual({ metrics: "forecast" });
    const req = customer.keywordPlanIdeas.generateKeywordForecastMetrics.mock.calls[0][0];
    expect(req.customer_id).toBe("1");
    expect(req.currency_code).toBe("EUR");
    expect(req.forecast_period).toEqual({ start_date: "2026-01-01", end_date: "2026-03-31" });
    expect(req.campaign.keyword_plan_network).toBe("GOOGLE_SEARCH");
    expect(req.campaign.language_constants).toEqual(["languageConstants/1001"]);
    expect(req.campaign.geo_modifiers).toEqual([
      { geo_target_constant: "geoTargetConstants/2840", bid_modifier: 1 },
    ]);
    expect(req.campaign.bidding_strategy.manual_cpc_bidding_strategy).toEqual({
      daily_budget_micros: 5000000,
      max_cpc_bid_micros: 2000000,
    });
    const adGroup = req.campaign.ad_groups[0];
    expect(adGroup.max_cpc_bid_micros).toBe(2000000);
    expect(adGroup.biddable_keywords).toEqual([
      { keyword: { text: "a", match_type: "EXACT" }, max_cpc_bid_micros: 500000 },
      { keyword: { text: "b", match_type: "BROAD" }, max_cpc_bid_micros: 2000000 },
    ]);
  });

  it("generate_keyword_forecast_metrics uses USD/empty geo and per-keyword fallback bid", async () => {
    await call("generate_keyword_forecast_metrics", {
      customerId: "1",
      keywords: [{ text: "a", matchType: "PHRASE" }],
      languageId: "1000",
      geoTargetConstantIds: [],
      currencyCode: "USD",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      maxCpcBidMicros: 1000000,
      dailyBudgetMicros: 10000000,
      keywordPlanNetwork: "GOOGLE_SEARCH_AND_PARTNERS",
    });
    const req = customer.keywordPlanIdeas.generateKeywordForecastMetrics.mock.calls[0][0];
    expect(req.currency_code).toBe("USD");
    expect(req.campaign.language_constants).toEqual(["languageConstants/1000"]);
    expect(req.campaign.geo_modifiers).toEqual([]);
    expect(req.campaign.bidding_strategy.manual_cpc_bidding_strategy).toEqual({
      daily_budget_micros: 10000000,
      max_cpc_bid_micros: 1000000,
    });
    expect(req.campaign.ad_groups[0].biddable_keywords[0].max_cpc_bid_micros).toBe(1000000);
  });

  it("create_keyword_plan sends a create with the given interval", async () => {
    const res = await call("create_keyword_plan", {
      customerId: "1",
      name: "Plan A",
      forecastDateInterval: "NEXT_QUARTER",
    });
    expect(toolJson(res)).toEqual({ results: [{ resource_name: "plan/1" }] });
    expect(customer.keywordPlans.create).toHaveBeenCalledWith([
      { name: "Plan A", forecast_period: { date_interval: "NEXT_QUARTER" } },
    ]);
  });

  it("create_keyword_plan honors explicit interval", async () => {
    await call("create_keyword_plan", { customerId: "1", name: "P", forecastDateInterval: "NEXT_YEAR" });
    expect(customer.keywordPlans.create.mock.calls[0][0][0].forecast_period.date_interval).toBe("NEXT_YEAR");
  });

  it("update_keyword_plan with both name and interval", async () => {
    await call("update_keyword_plan", {
      customerId: "1",
      keywordPlanId: "9",
      name: "New",
      forecastDateInterval: "NEXT_MONTH",
    });
    expect(customer.keywordPlans.update).toHaveBeenCalledWith([
      {
        resource_name: "customers/1/keywordPlans/9",
        name: "New",
        forecast_period: { date_interval: "NEXT_MONTH" },
      },
    ]);
  });

  it("update_keyword_plan with name only", async () => {
    await call("update_keyword_plan", { customerId: "1", keywordPlanId: "9", name: "Only" });
    const update = customer.keywordPlans.update.mock.calls[0][0][0];
    expect(update.name).toBe("Only");
    expect(update.forecast_period).toBeUndefined();
  });

  it("update_keyword_plan with interval only and neither", async () => {
    await call("update_keyword_plan", { customerId: "1", keywordPlanId: "9", forecastDateInterval: "NEXT_QUARTER" });
    let update = customer.keywordPlans.update.mock.calls[0][0][0];
    expect(update.name).toBeUndefined();
    expect(update.forecast_period).toEqual({ date_interval: "NEXT_QUARTER" });

    await call("update_keyword_plan", { customerId: "1", keywordPlanId: "9" });
    update = customer.keywordPlans.update.mock.calls[1][0][0];
    expect(update).toEqual({ resource_name: "customers/1/keywordPlans/9" });
  });

  it("remove_keyword_plan removes by resource name", async () => {
    await call("remove_keyword_plan", { customerId: "1", keywordPlanId: "9" });
    expect(customer.keywordPlans.remove).toHaveBeenCalledWith(["customers/1/keywordPlans/9"]);
  });

  it("create_keyword_plan_campaign with name and targets", async () => {
    await call("create_keyword_plan_campaign", {
      customerId: "1",
      keywordPlanId: "9",
      name: "Camp",
      cpcBidMicros: 1000,
      geoTargetConstantIds: ["2840"],
      languageIds: ["1000"],
      keywordPlanNetwork: "GOOGLE_SEARCH",
    });
    expect(customer.keywordPlanCampaigns.create).toHaveBeenCalledWith([
      {
        keyword_plan: "customers/1/keywordPlans/9",
        name: "Camp",
        cpc_bid_micros: 1000,
        keyword_plan_network: "GOOGLE_SEARCH",
        language_constants: ["languageConstants/1000"],
        geo_targets: [{ geo_target_constant: "geoTargetConstants/2840" }],
      },
    ]);
  });

  it("create_keyword_plan_campaign without name omits name and handles empty target lists", async () => {
    await call("create_keyword_plan_campaign", {
      customerId: "1",
      keywordPlanId: "9",
      cpcBidMicros: 5,
      geoTargetConstantIds: [],
      languageIds: [],
      keywordPlanNetwork: "GOOGLE_SEARCH_AND_PARTNERS",
    });
    const op = customer.keywordPlanCampaigns.create.mock.calls[0][0][0];
    expect(op.name).toBeUndefined();
    expect(op.keyword_plan_network).toBe("GOOGLE_SEARCH_AND_PARTNERS");
    expect(op.language_constants).toEqual([]);
    expect(op.geo_targets).toEqual([]);
  });

  it("create_keyword_plan_ad_group", async () => {
    await call("create_keyword_plan_ad_group", {
      customerId: "1",
      keywordPlanCampaignId: "7",
      name: "AG",
      cpcBidMicros: 250,
    });
    expect(customer.keywordPlanAdGroups.create).toHaveBeenCalledWith([
      {
        keyword_plan_campaign: "customers/1/keywordPlanCampaigns/7",
        name: "AG",
        cpc_bid_micros: 250,
      },
    ]);
  });

  it("add_keyword_plan_keywords with and without cpc bid", async () => {
    await call("add_keyword_plan_keywords", {
      customerId: "1",
      keywordPlanAdGroupId: "8",
      keywords: [
        { text: "a", matchType: "EXACT", cpcBidMicros: 500, negative: true },
        { text: "b", matchType: "BROAD", negative: false },
      ],
    });
    expect(customer.keywordPlanAdGroupKeywords.create).toHaveBeenCalledWith([
      {
        keyword_plan_ad_group: "customers/1/keywordPlanAdGroups/8",
        text: "a",
        match_type: "EXACT",
        cpc_bid_micros: 500,
        negative: true,
      },
      {
        keyword_plan_ad_group: "customers/1/keywordPlanAdGroups/8",
        text: "b",
        match_type: "BROAD",
        negative: false,
      },
    ]);
  });

  it("returns isError when the underlying API throws", async () => {
    customer.keywordPlans.create.mockRejectedValueOnce(new Error("nope"));
    const res = await call("create_keyword_plan", { customerId: "1", name: "X" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toContain("nope");
  });
});
