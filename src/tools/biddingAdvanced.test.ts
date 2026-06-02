import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerBiddingAdvancedTools } from "./biddingAdvanced.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerBiddingAdvancedTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ bidding_strategy: { id: "1" } }]);
});

function lastOps() {
  return (runMutation as any).mock.calls[0][1];
}

describe("biddingAdvanced tools", () => {
  it("registers all 14 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "list_bidding_strategies",
        "create_portfolio_bidding_strategy",
        "update_portfolio_bidding_strategy",
        "remove_portfolio_bidding_strategy",
        "set_campaign_portfolio_bidding_strategy",
        "clear_campaign_portfolio_bidding_strategy",
        "list_bidding_seasonality_adjustments",
        "create_bidding_seasonality_adjustment",
        "update_bidding_seasonality_adjustment",
        "remove_bidding_seasonality_adjustment",
        "list_bidding_data_exclusions",
        "create_bidding_data_exclusion",
        "update_bidding_data_exclusion",
        "remove_bidding_data_exclusion",
      ].sort()
    );
  });

  // ---- list tools ----------------------------------------------------------

  it("list_bidding_strategies builds GAQL with the limit", async () => {
    await call("list_bidding_strategies", { customerId: "1", limit: 7 });
    const q = (runQuery as any).mock.calls[0][0];
    expect(q.customerId).toBe("1");
    expect(q.query).toContain("FROM bidding_strategy");
    expect(q.query).toContain("LIMIT 7");
  });

  it("list_bidding_strategies without explicit limit interpolates undefined (no zod default applied)", async () => {
    await call("list_bidding_strategies", { customerId: "1" });
    expect((runQuery as any).mock.calls[0][0].query).toContain("LIMIT undefined");
  });

  it("list_bidding_seasonality_adjustments builds GAQL", async () => {
    await call("list_bidding_seasonality_adjustments", { customerId: "1", limit: 3 });
    expect((runQuery as any).mock.calls[0][0].query).toContain("FROM bidding_seasonality_adjustment");
    expect((runQuery as any).mock.calls[0][0].query).toContain("LIMIT 3");
  });

  it("list_bidding_data_exclusions builds GAQL", async () => {
    await call("list_bidding_data_exclusions", { customerId: "1", limit: 9 });
    expect((runQuery as any).mock.calls[0][0].query).toContain("FROM bidding_data_exclusion");
    expect((runQuery as any).mock.calls[0][0].query).toContain("LIMIT 9");
  });

  // ---- create_portfolio_bidding_strategy: every strategy branch -----------

  it("create_portfolio TARGET_CPA with and without targetCpaMicros", async () => {
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "TARGET_CPA", targetCpaMicros: 500 });
    expect(lastOps()[0].bidding_strategy_operation.create).toMatchObject({
      name: "S",
      target_cpa: { target_cpa_micros: 500 },
    });

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "TARGET_CPA" });
    expect(lastOps()[0].bidding_strategy_operation.create.target_cpa).toEqual({});
  });

  it("create_portfolio TARGET_ROAS with and without targetRoas", async () => {
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "TARGET_ROAS", targetRoas: 3.5, status: "PAUSED" });
    expect(lastOps()[0].bidding_strategy_operation.create).toMatchObject({
      status: "PAUSED",
      target_roas: { target_roas: 3.5 },
    });

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "TARGET_ROAS" });
    expect(lastOps()[0].bidding_strategy_operation.create.target_roas).toEqual({});
  });

  it("create_portfolio MAXIMIZE_CONVERSIONS with and without targetCpaMicros", async () => {
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "MAXIMIZE_CONVERSIONS", targetCpaMicros: 99 });
    expect(lastOps()[0].bidding_strategy_operation.create.maximize_conversions).toEqual({ target_cpa_micros: 99 });

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "MAXIMIZE_CONVERSIONS" });
    expect(lastOps()[0].bidding_strategy_operation.create.maximize_conversions).toEqual({});
  });

  it("create_portfolio MAXIMIZE_CONVERSION_VALUE with and without targetRoas", async () => {
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "MAXIMIZE_CONVERSION_VALUE", targetRoas: 4 });
    expect(lastOps()[0].bidding_strategy_operation.create.maximize_conversion_value).toEqual({ target_roas: 4 });

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "MAXIMIZE_CONVERSION_VALUE" });
    expect(lastOps()[0].bidding_strategy_operation.create.maximize_conversion_value).toEqual({});
  });

  it("create_portfolio TARGET_SPEND with all fields and empty", async () => {
    await call("create_portfolio_bidding_strategy", {
      customerId: "1", name: "S", strategy: "TARGET_SPEND",
      targetSpendMicros: 10, cpcBidCeilingMicros: 20, cpcBidFloorMicros: 5,
    });
    expect(lastOps()[0].bidding_strategy_operation.create.target_spend).toEqual({
      target_spend_micros: 10,
      cpc_bid_ceiling_micros: 20,
      cpc_bid_floor_micros: 5,
    });

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "TARGET_SPEND" });
    expect(lastOps()[0].bidding_strategy_operation.create.target_spend).toEqual({});
  });

  it("create_portfolio TARGET_IMPRESSION_SHARE with all fields and empty", async () => {
    await call("create_portfolio_bidding_strategy", {
      customerId: "1", name: "S", strategy: "TARGET_IMPRESSION_SHARE",
      cpcBidCeilingMicros: 30, locationFractionMicros: 400000, targetImpressionShareLocation: "TOP_OF_PAGE",
    });
    expect(lastOps()[0].bidding_strategy_operation.create.target_impression_share).toEqual({
      cpc_bid_ceiling_micros: 30,
      location_fraction_micros: 400000,
      location: "TOP_OF_PAGE",
    });

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("create_portfolio_bidding_strategy", { customerId: "1", name: "S", strategy: "TARGET_IMPRESSION_SHARE" });
    expect(lastOps()[0].bidding_strategy_operation.create.target_impression_share).toEqual({});
  });

  // ---- update_portfolio_bidding_strategy ----------------------------------

  it("update_portfolio errors when no fields given", async () => {
    const res = await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "55" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
  });

  it("update_portfolio name + status + resource name", async () => {
    await call("update_portfolio_bidding_strategy", { customerId: "123", biddingStrategyId: "55", name: "N", status: "REMOVED" });
    const op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.resource_name).toBe("customers/123/biddingStrategies/55");
    expect(op.update.name).toBe("N");
    expect(op.update.status).toBe("REMOVED");
    expect(op.update_mask.paths).toEqual(["name", "status"]);
  });

  it("update_portfolio passes through already-qualified resource name", async () => {
    await call("update_portfolio_bidding_strategy", {
      customerId: "1",
      biddingStrategyId: "customers/9/biddingStrategies/77",
      name: "N",
    });
    expect(lastOps()[0].bidding_strategy_operation.update.resource_name).toBe("customers/9/biddingStrategies/77");
  });

  it("update_portfolio TARGET_CPA with and without micros", async () => {
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "TARGET_CPA", targetCpaMicros: 12 });
    let op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.target_cpa).toEqual({ target_cpa_micros: 12 });
    expect(op.update_mask.paths).toEqual(["target_cpa", "target_cpa.target_cpa_micros"]);

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "TARGET_CPA" });
    op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.target_cpa).toEqual({});
    expect(op.update_mask.paths).toEqual(["target_cpa"]);
  });

  it("update_portfolio TARGET_ROAS with and without roas", async () => {
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "TARGET_ROAS", targetRoas: 2 });
    let op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.target_roas).toEqual({ target_roas: 2 });
    expect(op.update_mask.paths).toEqual(["target_roas", "target_roas.target_roas"]);

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "TARGET_ROAS" });
    op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.target_roas).toEqual({});
    expect(op.update_mask.paths).toEqual(["target_roas"]);
  });

  it("update_portfolio MAXIMIZE_CONVERSIONS with and without micros", async () => {
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "MAXIMIZE_CONVERSIONS", targetCpaMicros: 8 });
    let op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.maximize_conversions).toEqual({ target_cpa_micros: 8 });
    expect(op.update_mask.paths).toEqual(["maximize_conversions", "maximize_conversions.target_cpa_micros"]);

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "MAXIMIZE_CONVERSIONS" });
    op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.maximize_conversions).toEqual({});
    expect(op.update_mask.paths).toEqual(["maximize_conversions"]);
  });

  it("update_portfolio MAXIMIZE_CONVERSION_VALUE with and without roas", async () => {
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "MAXIMIZE_CONVERSION_VALUE", targetRoas: 6 });
    let op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.maximize_conversion_value).toEqual({ target_roas: 6 });
    expect(op.update_mask.paths).toEqual(["maximize_conversion_value", "maximize_conversion_value.target_roas"]);

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "MAXIMIZE_CONVERSION_VALUE" });
    op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.maximize_conversion_value).toEqual({});
    expect(op.update_mask.paths).toEqual(["maximize_conversion_value"]);
  });

  it("update_portfolio TARGET_SPEND with all fields and empty", async () => {
    await call("update_portfolio_bidding_strategy", {
      customerId: "1", biddingStrategyId: "5", strategy: "TARGET_SPEND",
      targetSpendMicros: 1, cpcBidCeilingMicros: 2, cpcBidFloorMicros: 3,
    });
    let op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.target_spend).toEqual({ target_spend_micros: 1, cpc_bid_ceiling_micros: 2, cpc_bid_floor_micros: 3 });
    expect(op.update_mask.paths).toEqual([
      "target_spend.target_spend_micros",
      "target_spend.cpc_bid_ceiling_micros",
      "target_spend.cpc_bid_floor_micros",
      "target_spend",
    ]);

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "TARGET_SPEND" });
    op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.target_spend).toEqual({});
    expect(op.update_mask.paths).toEqual(["target_spend"]);
  });

  it("update_portfolio TARGET_IMPRESSION_SHARE with all fields and empty", async () => {
    await call("update_portfolio_bidding_strategy", {
      customerId: "1", biddingStrategyId: "5", strategy: "TARGET_IMPRESSION_SHARE",
      cpcBidCeilingMicros: 7, locationFractionMicros: 100000, targetImpressionShareLocation: "ANYWHERE_ON_PAGE",
    });
    let op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.target_impression_share).toEqual({
      cpc_bid_ceiling_micros: 7,
      location_fraction_micros: 100000,
      location: "ANYWHERE_ON_PAGE",
    });
    expect(op.update_mask.paths).toEqual([
      "target_impression_share.cpc_bid_ceiling_micros",
      "target_impression_share.location_fraction_micros",
      "target_impression_share.location",
      "target_impression_share",
    ]);

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("update_portfolio_bidding_strategy", { customerId: "1", biddingStrategyId: "5", strategy: "TARGET_IMPRESSION_SHARE" });
    op = lastOps()[0].bidding_strategy_operation;
    expect(op.update.target_impression_share).toEqual({});
    expect(op.update_mask.paths).toEqual(["target_impression_share"]);
  });

  // ---- remove / set / clear ------------------------------------------------

  it("remove_portfolio_bidding_strategy sends a remove resource name", async () => {
    await call("remove_portfolio_bidding_strategy", { customerId: "123", biddingStrategyId: "55" });
    expect(lastOps()[0].bidding_strategy_operation.remove).toBe("customers/123/biddingStrategies/55");
  });

  it("set_campaign_portfolio_bidding_strategy builds update mask", async () => {
    await call("set_campaign_portfolio_bidding_strategy", { customerId: "123", campaignId: "7", biddingStrategyId: "55" });
    const op = lastOps()[0].campaign_operation;
    expect(op.update.resource_name).toBe("customers/123/campaigns/7");
    expect(op.update.bidding_strategy).toBe("customers/123/biddingStrategies/55");
    expect(op.update_mask.paths).toEqual(["bidding_strategy"]);
  });

  it("clear_campaign_portfolio_bidding_strategy switches to manual_cpc", async () => {
    await call("clear_campaign_portfolio_bidding_strategy", { customerId: "123", campaignId: "7" });
    const op = lastOps()[0].campaign_operation;
    expect(op.update.manual_cpc).toEqual({});
    expect(op.update_mask.paths).toEqual(["manual_cpc"]);
  });

  // ---- create_bidding_seasonality_adjustment ------------------------------

  it("create_seasonality minimal (required fields only)", async () => {
    await call("create_bidding_seasonality_adjustment", {
      customerId: "1", name: "Sale", startDateTime: "2026-01-01 00:00:00+00:00",
      endDateTime: "2026-01-02 00:00:00+00:00", conversionRateModifier: 1.5,
    });
    const create = lastOps()[0].bidding_seasonality_adjustment_operation.create;
    // No zod default is applied (handler receives raw args), so scope is undefined.
    expect(create).toEqual({
      name: "Sale",
      scope: undefined,
      start_date_time: "2026-01-01 00:00:00+00:00",
      end_date_time: "2026-01-02 00:00:00+00:00",
      conversion_rate_modifier: 1.5,
    });
  });

  it("create_seasonality with all optional fields", async () => {
    await call("create_bidding_seasonality_adjustment", {
      customerId: "123", name: "Sale", scope: "CAMPAIGN", status: "ENABLED",
      startDateTime: "a", endDateTime: "b", conversionRateModifier: 2,
      description: "desc", devices: ["MOBILE", "DESKTOP"],
      campaignIds: ["7", "8"], advertisingChannelTypes: ["SEARCH"],
    });
    const create = lastOps()[0].bidding_seasonality_adjustment_operation.create;
    expect(create.status).toBe("ENABLED");
    expect(create.description).toBe("desc");
    expect(create.devices).toEqual(["MOBILE", "DESKTOP"]);
    expect(create.campaigns).toEqual(["customers/123/campaigns/7", "customers/123/campaigns/8"]);
    expect(create.advertising_channel_types).toEqual(["SEARCH"]);
  });

  it("create_seasonality ignores empty arrays", async () => {
    await call("create_bidding_seasonality_adjustment", {
      customerId: "1", name: "Sale", startDateTime: "a", endDateTime: "b",
      conversionRateModifier: 1, devices: [], campaignIds: [], advertisingChannelTypes: [],
    });
    const create = lastOps()[0].bidding_seasonality_adjustment_operation.create;
    expect(create.devices).toBeUndefined();
    expect(create.campaigns).toBeUndefined();
    expect(create.advertising_channel_types).toBeUndefined();
  });

  // ---- update_bidding_seasonality_adjustment ------------------------------

  it("update_seasonality errors when no fields given", async () => {
    const res = await call("update_bidding_seasonality_adjustment", { customerId: "1", seasonalityAdjustmentId: "5" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
  });

  it("update_seasonality covers all fields", async () => {
    await call("update_bidding_seasonality_adjustment", {
      customerId: "123", seasonalityAdjustmentId: "5",
      name: "N", scope: "CHANNEL", status: "REMOVED",
      startDateTime: "s", endDateTime: "e", description: "d",
      devices: ["TABLET"], campaignIds: ["7"], advertisingChannelTypes: ["DISPLAY"],
      conversionRateModifier: 1.2,
    });
    const op = lastOps()[0].bidding_seasonality_adjustment_operation;
    expect(op.update.resource_name).toBe("customers/123/biddingSeasonalityAdjustments/5");
    expect(op.update.campaigns).toEqual(["customers/123/campaigns/7"]);
    expect(op.update_mask.paths).toEqual([
      "name", "scope", "status", "start_date_time", "end_date_time",
      "description", "devices", "campaigns", "advertising_channel_types",
      "conversion_rate_modifier",
    ]);
  });

  it("update_seasonality with empty-string description still sets it", async () => {
    await call("update_bidding_seasonality_adjustment", {
      customerId: "1", seasonalityAdjustmentId: "5", description: "",
    });
    const op = lastOps()[0].bidding_seasonality_adjustment_operation;
    expect(op.update.description).toBe("");
    expect(op.update_mask.paths).toEqual(["description"]);
  });

  it("update_seasonality with empty campaignIds maps to undefined campaigns", async () => {
    await call("update_bidding_seasonality_adjustment", {
      customerId: "1", seasonalityAdjustmentId: "5", campaignIds: [],
    });
    const op = lastOps()[0].bidding_seasonality_adjustment_operation;
    expect(op.update.campaigns).toBeUndefined();
    expect(op.update_mask.paths).toEqual(["campaigns"]);
  });

  it("remove_bidding_seasonality_adjustment sends remove resource name", async () => {
    await call("remove_bidding_seasonality_adjustment", { customerId: "123", seasonalityAdjustmentId: "5" });
    expect(lastOps()[0].bidding_seasonality_adjustment_operation.remove).toBe("customers/123/biddingSeasonalityAdjustments/5");
  });

  // ---- create_bidding_data_exclusion --------------------------------------

  it("create_data_exclusion minimal", async () => {
    await call("create_bidding_data_exclusion", {
      customerId: "1", name: "Ex", startDateTime: "a", endDateTime: "b",
    });
    const create = lastOps()[0].bidding_data_exclusion_operation.create;
    // No zod default is applied (handler receives raw args), so scope is undefined.
    expect(create).toEqual({
      name: "Ex",
      scope: undefined,
      start_date_time: "a",
      end_date_time: "b",
    });
  });

  it("create_data_exclusion with all optional fields", async () => {
    await call("create_bidding_data_exclusion", {
      customerId: "123", name: "Ex", scope: "CAMPAIGN", status: "ENABLED",
      startDateTime: "a", endDateTime: "b", description: "d",
      devices: ["OTHER"], campaignIds: ["7"], advertisingChannelTypes: ["VIDEO"],
    });
    const create = lastOps()[0].bidding_data_exclusion_operation.create;
    expect(create.status).toBe("ENABLED");
    expect(create.description).toBe("d");
    expect(create.devices).toEqual(["OTHER"]);
    expect(create.campaigns).toEqual(["customers/123/campaigns/7"]);
    expect(create.advertising_channel_types).toEqual(["VIDEO"]);
  });

  it("create_data_exclusion ignores empty arrays", async () => {
    await call("create_bidding_data_exclusion", {
      customerId: "1", name: "Ex", startDateTime: "a", endDateTime: "b",
      devices: [], campaignIds: [], advertisingChannelTypes: [],
    });
    const create = lastOps()[0].bidding_data_exclusion_operation.create;
    expect(create.devices).toBeUndefined();
    expect(create.campaigns).toBeUndefined();
    expect(create.advertising_channel_types).toBeUndefined();
  });

  // ---- update_bidding_data_exclusion --------------------------------------

  it("update_data_exclusion errors when no fields given", async () => {
    const res = await call("update_bidding_data_exclusion", { customerId: "1", dataExclusionId: "5" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
  });

  it("update_data_exclusion covers all fields", async () => {
    await call("update_bidding_data_exclusion", {
      customerId: "123", dataExclusionId: "5",
      name: "N", scope: "CHANNEL", status: "REMOVED",
      startDateTime: "s", endDateTime: "e", description: "d",
      devices: ["CONNECTED_TV"], campaignIds: ["7"], advertisingChannelTypes: ["SEARCH"],
    });
    const op = lastOps()[0].bidding_data_exclusion_operation;
    expect(op.update.resource_name).toBe("customers/123/biddingDataExclusions/5");
    expect(op.update.campaigns).toEqual(["customers/123/campaigns/7"]);
    expect(op.update_mask.paths).toEqual([
      "name", "scope", "status", "start_date_time", "end_date_time",
      "description", "devices", "campaigns", "advertising_channel_types",
    ]);
  });

  it("update_data_exclusion with empty-string description still sets it", async () => {
    await call("update_bidding_data_exclusion", {
      customerId: "1", dataExclusionId: "5", description: "",
    });
    const op = lastOps()[0].bidding_data_exclusion_operation;
    expect(op.update.description).toBe("");
    expect(op.update_mask.paths).toEqual(["description"]);
  });

  it("update_data_exclusion with empty campaignIds maps to undefined campaigns", async () => {
    await call("update_bidding_data_exclusion", {
      customerId: "1", dataExclusionId: "5", campaignIds: [],
    });
    const op = lastOps()[0].bidding_data_exclusion_operation;
    expect(op.update.campaigns).toBeUndefined();
    expect(op.update_mask.paths).toEqual(["campaigns"]);
  });

  it("remove_bidding_data_exclusion sends remove resource name", async () => {
    await call("remove_bidding_data_exclusion", { customerId: "123", dataExclusionId: "5" });
    expect(lastOps()[0].bidding_data_exclusion_operation.remove).toBe("customers/123/biddingDataExclusions/5");
  });
});
