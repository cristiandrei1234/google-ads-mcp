import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerCampaignCrudTools } from "./campaignCrud.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerCampaignCrudTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ campaign: { id: "1" } }]);
});

describe("campaignCrud tools", () => {
  it("registers all 8 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "attach_campaign_budget",
        "create_campaign",
        "create_campaign_budget",
        "detach_campaign_budget",
        "list_campaigns",
        "set_campaign_network_settings",
        "update_campaign_budget",
        "update_campaign_settings",
      ].sort()
    );
  });

  it("list_campaigns builds GAQL with and without a status filter", async () => {
    await call("list_campaigns", { customerId: "1", limit: 5 });
    expect((runQuery as any).mock.calls[0][0].query).not.toContain("WHERE");
    await call("list_campaigns", { customerId: "1", limit: 5, status: "ENABLED" });
    expect((runQuery as any).mock.calls[1][0].query).toContain("WHERE campaign.status = ENABLED");
  });

  it("create_campaign_budget sends a create mutation", async () => {
    await call("create_campaign_budget", { customerId: "1", name: "B", amountMicros: 1000 });
    const ops = (runMutation as any).mock.calls[0][1];
    expect(ops[0].campaign_budget_operation.create).toMatchObject({ name: "B", amount_micros: 1000 });
  });

  it("update_campaign_budget builds an update mask from provided fields", async () => {
    await call("update_campaign_budget", { customerId: "1", budgetId: "9", name: "X", amountMicros: 5 });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_budget_operation;
    expect(op.update_mask.paths).toEqual(["name", "amount_micros"]);
  });

  it("update_campaign_budget builds a mask from only deliveryMethod", async () => {
    await call("update_campaign_budget", { customerId: "1", budgetId: "9", deliveryMethod: "ACCELERATED" });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_budget_operation;
    expect(op.update.delivery_method).toBe("ACCELERATED");
    expect(op.update_mask.paths).toEqual(["delivery_method"]);
  });

  it("update_campaign_budget errors when no fields are given", async () => {
    const res = await call("update_campaign_budget", { customerId: "1", budgetId: "9" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
  });

  it("create_campaign chooses the bidding strategy branch", async () => {
    for (const [biddingStrategy, key] of [
      ["MANUAL_CPC", "manual_cpc"],
      ["MAXIMIZE_CONVERSIONS", "maximize_conversions"],
      ["MAXIMIZE_CONVERSION_VALUE", "maximize_conversion_value"],
    ] as const) {
      vi.clearAllMocks();
      (getCustomer as any).mockResolvedValue(fakeCustomer());
      (runMutation as any).mockResolvedValue({});
      await call("create_campaign", { customerId: "1", name: "C", budgetId: "9", biddingStrategy, startDate: "2026-01-01", endDate: "2026-02-01" });
      const create = (runMutation as any).mock.calls[0][1][0].campaign_operation.create;
      expect(create).toHaveProperty(key);
      expect(create.start_date).toBe("2026-01-01");
    }
  });

  it("create_campaign omits start/end dates when not provided", async () => {
    await call("create_campaign", { customerId: "1", name: "C", budgetId: "9" });
    const create = (runMutation as any).mock.calls[0][1][0].campaign_operation.create;
    expect(create).not.toHaveProperty("start_date");
    expect(create).not.toHaveProperty("end_date");
  });

  it("update_campaign_settings covers all fields and the empty-mask error", async () => {
    await call("update_campaign_settings", { customerId: "1", campaignId: "7", name: "N", status: "PAUSED", startDate: "2026-01-01", endDate: "2026-02-01" });
    expect((runMutation as any).mock.calls[0][1][0].campaign_operation.update_mask.paths).toEqual([
      "name",
      "status",
      "start_date",
      "end_date",
    ]);
    const res = await call("update_campaign_settings", { customerId: "1", campaignId: "7" });
    expect(res.isError).toBe(true);
  });

  it("attach / detach / set network settings issue update mutations", async () => {
    await call("attach_campaign_budget", { customerId: "1", campaignId: "7", budgetId: "9" });
    expect((runMutation as any).mock.calls[0][1][0].campaign_operation.update_mask.paths).toEqual(["campaign_budget"]);

    vi.clearAllMocks();
    (getCustomer as any).mockResolvedValue(fakeCustomer());
    (runMutation as any).mockResolvedValue({});
    await call("detach_campaign_budget", { customerId: "1", campaignId: "7", fallbackBudgetId: "2" });
    expect((runMutation as any).mock.calls[0][1][0].campaign_operation.update.campaign_budget).toContain("campaignBudgets/2");

    await call("set_campaign_network_settings", {
      customerId: "1",
      campaignId: "7",
      targetGoogleSearch: true,
      targetSearchNetwork: false,
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false,
    });
    expect((runMutation as any).mock.calls[1][1][0].campaign_operation.update.network_settings.target_google_search).toBe(true);
  });
});
