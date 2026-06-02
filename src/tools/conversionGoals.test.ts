import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerConversionGoalTools } from "./conversionGoals.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerConversionGoalTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ customer_conversion_goal: {} }]);
});

describe("conversionGoals tools", () => {
  it("registers all 4 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "list_customer_conversion_goals",
        "set_customer_conversion_goal",
        "list_campaign_conversion_goals",
        "set_campaign_conversion_goal",
      ].sort()
    );
  });

  describe("list_customer_conversion_goals", () => {
    it("omits WHERE by default and respects limit", async () => {
      await call("list_customer_conversion_goals", { customerId: "1", limit: 50 });
      const q = (runQuery as any).mock.calls[0][0];
      expect(q.customerId).toBe("1");
      expect(q.query).not.toContain("WHERE");
      expect(q.query).toContain("LIMIT 50");
    });

    it("adds biddable WHERE clause when includeOnlyBiddable", async () => {
      await call("list_customer_conversion_goals", {
        customerId: "1",
        includeOnlyBiddable: true,
        limit: 200,
      });
      expect((runQuery as any).mock.calls[0][0].query).toContain(
        "WHERE customer_conversion_goal.biddable = true"
      );
    });
  });

  describe("set_customer_conversion_goal", () => {
    it("uses the explicit resourceName when provided", async () => {
      await call("set_customer_conversion_goal", {
        customerId: "1",
        resourceName: "customers/1/customerConversionGoals/PURCHASE~WEBSITE",
        biddable: true,
      });
      const op = (runMutation as any).mock.calls[0][1][0].customer_conversion_goal_operation;
      expect(op.update.resource_name).toBe("customers/1/customerConversionGoals/PURCHASE~WEBSITE");
      expect(op.update.biddable).toBe(true);
      expect(op.update_mask.paths).toEqual(["biddable"]);
    });

    it("builds the resourceName from category+origin (normalizing customerId dashes)", async () => {
      await call("set_customer_conversion_goal", {
        customerId: "123-456-7890",
        category: "LEAD",
        origin: "WEBSITE",
        biddable: false,
      });
      const op = (runMutation as any).mock.calls[0][1][0].customer_conversion_goal_operation;
      expect(op.update.resource_name).toBe(
        "customers/1234567890/customerConversionGoals/LEAD~WEBSITE"
      );
      expect(op.update.biddable).toBe(false);
    });

    it("rejects when neither resourceName nor category+origin are provided (refine violated)", async () => {
      const res = await call("set_customer_conversion_goal", { customerId: "1", biddable: true });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or both category and origin/i);
      expect((runMutation as any)).not.toHaveBeenCalled();
    });

    it("rejects when only one of category/origin is provided (refine violated)", async () => {
      const res = await call("set_customer_conversion_goal", {
        customerId: "1",
        category: "LEAD",
        biddable: true,
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or both category and origin/i);
    });
  });

  describe("list_campaign_conversion_goals", () => {
    it("no filters by default", async () => {
      await call("list_campaign_conversion_goals", { customerId: "1", limit: 300 });
      expect((runQuery as any).mock.calls[0][0].query).not.toContain("WHERE");
    });

    it("filters by campaign id (extracting numeric id from resource name)", async () => {
      await call("list_campaign_conversion_goals", {
        customerId: "1",
        campaignId: "customers/1/campaigns/555",
        limit: 300,
      });
      const q = (runQuery as any).mock.calls[0][0].query;
      expect(q).toContain("WHERE campaign.id = 555");
      expect(q).not.toContain("AND");
    });

    it("combines campaign and biddable filters with AND", async () => {
      await call("list_campaign_conversion_goals", {
        customerId: "1",
        campaignId: "777",
        includeOnlyBiddable: true,
        limit: 300,
      });
      const q = (runQuery as any).mock.calls[0][0].query;
      expect(q).toContain("WHERE campaign.id = 777 AND campaign_conversion_goal.biddable = true");
    });

    it("only biddable filter without campaign", async () => {
      await call("list_campaign_conversion_goals", {
        customerId: "1",
        includeOnlyBiddable: true,
        limit: 300,
      });
      const q = (runQuery as any).mock.calls[0][0].query;
      expect(q).toContain("WHERE campaign_conversion_goal.biddable = true");
    });
  });

  describe("set_campaign_conversion_goal", () => {
    it("uses explicit resourceName", async () => {
      await call("set_campaign_conversion_goal", {
        customerId: "1",
        resourceName: "customers/1/campaignConversionGoals/555~PURCHASE~WEBSITE",
        biddable: true,
      });
      const op = (runMutation as any).mock.calls[0][1][0].campaign_conversion_goal_operation;
      expect(op.update.resource_name).toBe(
        "customers/1/campaignConversionGoals/555~PURCHASE~WEBSITE"
      );
      expect(op.update_mask.paths).toEqual(["biddable"]);
    });

    it("builds resourceName from campaignId+category+origin", async () => {
      await call("set_campaign_conversion_goal", {
        customerId: "123-456-7890",
        campaignId: "customers/1/campaigns/555",
        category: "PURCHASE",
        origin: "WEBSITE",
        biddable: true,
      });
      const op = (runMutation as any).mock.calls[0][1][0].campaign_conversion_goal_operation;
      expect(op.update.resource_name).toBe(
        "customers/1234567890/campaignConversionGoals/555~PURCHASE~WEBSITE"
      );
    });

    it("rejects when campaignId is provided but category/origin missing (refine violated)", async () => {
      const res = await call("set_campaign_conversion_goal", {
        customerId: "1",
        campaignId: "555",
        biddable: true,
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or campaignId\+category\+origin/i);
      expect((runMutation as any)).not.toHaveBeenCalled();
    });

    it("rejects when neither resourceName nor campaignId+category+origin are provided (refine violated)", async () => {
      const res = await call("set_campaign_conversion_goal", {
        customerId: "1",
        biddable: true,
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or campaignId\+category\+origin/i);
    });

    it("propagates normalizeNumericId error for an invalid campaignId", async () => {
      const res = await call("set_campaign_conversion_goal", {
        customerId: "1",
        campaignId: "abc",
        category: "PURCHASE",
        origin: "WEBSITE",
        biddable: true,
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/Invalid campaigns identifier/i);
    });
  });
});
