import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import {
  registerMutateCoverageV23Tools,
  MUTATE_COVERAGE_V23_EXPECTED_TOOL_NAMES,
} from "./mutateCoverageV23.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerMutateCoverageV23Tools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ ad_group_bid_modifier: { resource_name: "x" } }]);
});

describe("mutateCoverageV23 registration", () => {
  it("registers exactly the expected tool names", () => {
    expect([...tools.keys()].sort()).toEqual([...MUTATE_COVERAGE_V23_EXPECTED_TOOL_NAMES].sort());
  });

  it("does not register list/get for ad family (skipListTool + skipGetTool) but registers update", () => {
    expect(tools.has("list_ads")).toBe(false);
    expect(tools.has("get_ad")).toBe(false);
    expect(tools.has("update_ad")).toBe(true);
  });

  it("does not register create for keyword_plan_campaign (skipMutateTools includes create)", () => {
    expect(tools.has("create_keyword_plan_campaign")).toBe(false);
    expect(tools.has("update_keyword_plan_campaign")).toBe(true);
    expect(tools.has("remove_keyword_plan_campaign")).toBe(true);
  });

  it("registers no mutate tools for keyword_plan (all skipped) but keeps list/get", () => {
    expect(tools.has("list_keyword_plans")).toBe(true);
    expect(tools.has("get_keyword_plan")).toBe(true);
    expect(tools.has("create_keyword_plan")).toBe(false);
    expect(tools.has("update_keyword_plan")).toBe(false);
    expect(tools.has("remove_keyword_plan")).toBe(false);
  });

  it("registers only update for a single-verb family (customer)", () => {
    expect(tools.has("update_customer")).toBe(true);
    expect(tools.has("create_customer")).toBe(false);
    expect(tools.has("remove_customer")).toBe(false);
  });

  it("registers create+remove (no update) for create/remove families", () => {
    expect(tools.has("create_ad_group_label")).toBe(true);
    expect(tools.has("remove_ad_group_label")).toBe(true);
    expect(tools.has("update_ad_group_label")).toBe(false);
  });
});

describe("list family resources", () => {
  it("builds GAQL without WHERE and with a default ORDER BY", async () => {
    const res = await call("list_ad_group_bid_modifiers", { customerId: "1", limit: 10 });
    expect(res.isError).toBeUndefined();
    const q = (runQuery as any).mock.calls[0][0];
    expect(q.customerId).toBe("1");
    expect(q.query).not.toContain("WHERE");
    expect(q.query).toContain("ORDER BY ad_group_bid_modifier.resource_name");
    expect(q.query).toContain("LIMIT 10");
  });

  it("builds GAQL with WHERE and custom ORDER BY", async () => {
    await call("list_ad_group_bid_modifiers", {
      customerId: "1",
      limit: 5,
      where: "ad_group_bid_modifier.bid_modifier > 1",
      orderBy: "ad_group_bid_modifier.bid_modifier DESC",
    });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain("WHERE ad_group_bid_modifier.bid_modifier > 1");
    expect(q).toContain("ORDER BY ad_group_bid_modifier.bid_modifier DESC");
  });

  it("rejects an unsafe where fragment", async () => {
    const res = await call("list_ad_group_bid_modifiers", {
      customerId: "1",
      limit: 5,
      where: "1=1; DROP TABLE x",
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Invalid 'where'/);
  });

  it("rejects an unsafe orderBy fragment", async () => {
    const res = await call("list_ad_group_bid_modifiers", {
      customerId: "1",
      limit: 5,
      orderBy: "SELECT 1",
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Invalid 'orderBy'/);
  });
});

describe("get family resource", () => {
  it("returns found=true with the first row and escapes the resource name", async () => {
    (runQuery as any).mockResolvedValue([{ ad_group_bid_modifier: { resource_name: "rn1" } }]);
    const res = await call("get_ad_group_bid_modifier", {
      customerId: "1",
      resourceName: "customers/1/adGroupBidModifiers/o'brien",
    });
    const json = toolJson(res) as any;
    expect(json.found).toBe(true);
    expect(json.row).toEqual({ ad_group_bid_modifier: { resource_name: "rn1" } });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain("o\\'brien");
    expect(q).toContain("LIMIT 1");
  });

  it("returns found=false and row=null when no rows", async () => {
    (runQuery as any).mockResolvedValue([]);
    const res = await call("get_ad_group_bid_modifier", {
      customerId: "1",
      resourceName: "customers/1/adGroupBidModifiers/9",
    });
    const json = toolJson(res) as any;
    expect(json.found).toBe(false);
    expect(json.row).toBeNull();
  });
});

describe("create family resource", () => {
  it("sends a create mutation with the raw payload", async () => {
    await call("create_ad_group_bid_modifier", {
      customerId: "1",
      payload: { ad_group: "customers/1/adGroups/7", bid_modifier: 1.5 },
    });
    const [customer, ops] = (runMutation as any).mock.calls[0];
    expect(customer).toBeDefined();
    expect(ops[0].ad_group_bid_modifier_operation.create).toEqual({
      ad_group: "customers/1/adGroups/7",
      bid_modifier: 1.5,
    });
    expect(getCustomer).toHaveBeenCalledWith("1", undefined);
  });
});

describe("update family resource", () => {
  it("infers update_mask paths from payload keys", async () => {
    await call("update_ad_group_bid_modifier", {
      customerId: "1",
      resourceName: "customers/1/adGroupBidModifiers/9",
      payload: { bid_modifier: 2 },
    });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_bid_modifier_operation;
    expect(op.update).toEqual({ resource_name: "customers/1/adGroupBidModifiers/9", bid_modifier: 2 });
    expect(op.update_mask.paths).toEqual(["bid_modifier"]);
  });

  it("uses explicit updateMaskPaths when provided", async () => {
    await call("update_ad_group_bid_modifier", {
      customerId: "1",
      resourceName: "customers/1/adGroupBidModifiers/9",
      payload: { bid_modifier: 2, foo: 3 },
      updateMaskPaths: ["bid_modifier"],
    });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_bid_modifier_operation;
    expect(op.update_mask.paths).toEqual(["bid_modifier"]);
  });

  it("falls back to inferred paths when updateMaskPaths is an empty array", async () => {
    await call("update_ad_group_bid_modifier", {
      customerId: "1",
      resourceName: "customers/1/adGroupBidModifiers/9",
      payload: { bid_modifier: 2 },
      updateMaskPaths: [],
    });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_bid_modifier_operation;
    expect(op.update_mask.paths).toEqual(["bid_modifier"]);
  });

  it("throws when no paths can be resolved", async () => {
    const res = await call("update_ad_group_bid_modifier", {
      customerId: "1",
      resourceName: "customers/1/adGroupBidModifiers/9",
      payload: {},
      updateMaskPaths: [],
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/No update paths were resolved/);
  });
});

describe("remove family resource", () => {
  it("sends a remove mutation with the resource name", async () => {
    await call("remove_ad_group_bid_modifier", {
      customerId: "1",
      resourceName: "customers/1/adGroupBidModifiers/9",
    });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_bid_modifier_operation;
    expect(op.remove).toBe("customers/1/adGroupBidModifiers/9");
  });
});

describe("payload schema refinements", () => {
  it("create payload rejects empty objects and accepts non-empty ones", () => {
    const payloadSchema = (getTool(tools, "create_ad_group_bid_modifier").config.inputSchema as any)
      .payload;
    expect(payloadSchema.safeParse({}).success).toBe(false);
    expect(payloadSchema.safeParse({ a: 1 }).success).toBe(true);
  });

  it("update payload rejects empty objects and accepts non-empty ones", () => {
    const payloadSchema = (getTool(tools, "update_ad_group_bid_modifier").config.inputSchema as any)
      .payload;
    expect(payloadSchema.safeParse({}).success).toBe(false);
    expect(payloadSchema.safeParse({ a: 1 }).success).toBe(true);
  });
});

describe("error wrapping (asTool)", () => {
  it("wraps runMutation errors as isError results", async () => {
    (runMutation as any).mockRejectedValue(new Error("boom"));
    const res = await call("create_ad_group_bid_modifier", {
      customerId: "1",
      payload: { ad_group: "g" },
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/boom/);
  });
});
