import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));
// Mock _schemas so `chunk` is controllable: by default it delegates to the real
// implementation, but individual tests can override it to inject an empty chunk
// and exercise the `if (opsChunk.length > 0)` false branch (line 154).
vi.mock("./_schemas.js", async () => {
  const actual = await vi.importActual<typeof import("./_schemas.js")>("./_schemas.js");
  return { ...actual, chunk: vi.fn(actual.chunk) };
});

import { registerAdGroupAdvancedTools } from "./adgroupsAdvanced.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { chunk } from "./_schemas.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerAdGroupAdvancedTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([]);
});

describe("adgroupsAdvanced tools", () => {
  it("registers all 4 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      ["clone_ad_group", "create_ad_group", "list_ad_groups", "update_ad_group"].sort()
    );
  });

  // ---- create_ad_group ----

  it("create_ad_group sends minimal create (no optional fields)", async () => {
    await call("create_ad_group", { customerId: "1", campaignId: "5", name: "AG", status: "PAUSED" });
    const create = (runMutation as any).mock.calls[0][1][0].ad_group_operation.create;
    expect(create).toEqual({
      campaign: "customers/1/campaigns/5",
      name: "AG",
      status: "PAUSED",
    });
    expect(create).not.toHaveProperty("type");
    expect(create).not.toHaveProperty("cpc_bid_micros");
  });

  it("create_ad_group includes type and cpcBidMicros when given", async () => {
    await call("create_ad_group", {
      customerId: "1",
      campaignId: "5",
      name: "AG",
      status: "ENABLED",
      type: "SEARCH_STANDARD",
      cpcBidMicros: 250000,
    });
    const create = (runMutation as any).mock.calls[0][1][0].ad_group_operation.create;
    expect(create.status).toBe("ENABLED");
    expect(create.type).toBe("SEARCH_STANDARD");
    expect(create.cpc_bid_micros).toBe(250000);
  });

  // ---- update_ad_group ----

  it("update_ad_group builds mask from all fields", async () => {
    await call("update_ad_group", {
      customerId: "1",
      adGroupId: "9",
      name: "X",
      status: "REMOVED",
      cpcBidMicros: 1000,
    });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_operation;
    expect(op.update.resource_name).toBe("customers/1/adGroups/9");
    expect(op.update.name).toBe("X");
    expect(op.update.status).toBe("REMOVED");
    expect(op.update.cpc_bid_micros).toBe(1000);
    expect(op.update_mask.paths).toEqual(["name", "status", "cpc_bid_micros"]);
  });

  it("update_ad_group with a single field builds a minimal mask", async () => {
    await call("update_ad_group", { customerId: "1", adGroupId: "9", status: "PAUSED" });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_operation;
    expect(op.update_mask.paths).toEqual(["status"]);
  });

  it("update_ad_group errors when no fields provided", async () => {
    const res = await call("update_ad_group", { customerId: "1", adGroupId: "9" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
  });

  // ---- list_ad_groups ----

  it("list_ad_groups builds GAQL without a campaign filter", async () => {
    await call("list_ad_groups", { customerId: "1", limit: 100 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).not.toContain("WHERE");
    expect(q).toContain("LIMIT 100");
    expect((runQuery as any).mock.calls[0][0].customerId).toBe("1");
  });

  it("list_ad_groups builds GAQL with a campaign filter and custom limit", async () => {
    await call("list_ad_groups", { customerId: "1", campaignId: "42", limit: 7 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain("WHERE campaign.id = 42");
    expect(q).toContain("LIMIT 7");
  });

  // ---- clone_ad_group ----

  it("clone_ad_group errors when source not found", async () => {
    (runQuery as any).mockResolvedValueOnce([]);
    const res = await call("clone_ad_group", { customerId: "1", sourceAdGroupId: "100" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/not found/i);
  });

  it("clone_ad_group errors when create returns no resource name", async () => {
    (runQuery as any).mockResolvedValueOnce([
      { ad_group: { name: "Src", type: "SEARCH_STANDARD", cpc_bid_micros: 500 }, campaign: { id: "7" } },
    ]);
    (runMutation as any).mockResolvedValueOnce({}); // no mutate_operation_responses
    const res = await call("clone_ad_group", { customerId: "1", sourceAdGroupId: "100" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/failed to create target ad group/i);
  });

  it("clone_ad_group copies fields, uses source campaign, default name, and copies keywords", async () => {
    // 1st runQuery: source ad group rows
    (runQuery as any).mockResolvedValueOnce([
      { ad_group: { name: "Src AG", type: "SEARCH_STANDARD", cpc_bid_micros: 500 }, campaign: { id: "7" } },
    ]);
    // create mutation returns a resource name
    (runMutation as any).mockResolvedValueOnce({
      mutate_operation_responses: [{ ad_group_result: { resource_name: "customers/1/adGroups/999" } }],
    });
    // 2nd runQuery: keyword rows (one valid, one empty-text filtered out)
    (runQuery as any).mockResolvedValueOnce([
      { ad_group_criterion: { status: 2, keyword: { text: "shoes", match_type: "BROAD" } } },
      { ad_group_criterion: { status: 3, keyword: { text: "", match_type: "EXACT" } } },
    ]);
    (runMutation as any).mockResolvedValueOnce({}); // keyword chunk mutation

    const res = await call("clone_ad_group", { customerId: "1", sourceAdGroupId: "100" });
    expect(res.isError).toBeUndefined();
    const out = toolJson(res) as any;
    expect(out).toEqual({
      sourceAdGroupId: "100",
      targetAdGroupId: "999",
      targetCampaignId: "7",
      keywordsCopied: 1,
    });

    // create op uses source campaign + default name + copied type/bid
    const createOp = (runMutation as any).mock.calls[0][1][0].ad_group_operation.create;
    expect(createOp.campaign).toBe("customers/1/campaigns/7");
    expect(createOp.name).toBe("Src AG - Copy");
    expect(createOp.type).toBe("SEARCH_STANDARD");
    expect(createOp.cpc_bid_micros).toBe(500);

    // keyword op references the new ad group, normalized status ENABLED (2)
    const kwOps = (runMutation as any).mock.calls[1][1];
    expect(kwOps).toHaveLength(1);
    const kwCreate = kwOps[0].ad_group_criterion_operation.create;
    expect(kwCreate.ad_group).toBe("customers/1/adGroups/999");
    expect(kwCreate.status).toBe("ENABLED");
    expect(kwCreate.keyword).toEqual({ text: "shoes", match_type: "BROAD" });
  });

  it("clone_ad_group uses target overrides, omits missing type/bid, and skips empty keyword mutations", async () => {
    (runQuery as any).mockResolvedValueOnce([
      { ad_group: { name: "Src AG" }, campaign: { id: "7" } }, // no type, no cpc_bid_micros
    ]);
    (runMutation as any).mockResolvedValueOnce({
      mutate_operation_responses: [{ ad_group_result: { resource_name: "customers/1/adGroups/777" } }],
    });
    (runQuery as any).mockResolvedValueOnce([]); // no keywords

    const res = await call("clone_ad_group", {
      customerId: "1",
      sourceAdGroupId: "100",
      targetCampaignId: "55",
      targetAdGroupName: "My Clone",
      status: "ENABLED",
    });
    const out = toolJson(res) as any;
    expect(out.targetCampaignId).toBe("55");
    expect(out.keywordsCopied).toBe(0);

    const createOp = (runMutation as any).mock.calls[0][1][0].ad_group_operation.create;
    expect(createOp.campaign).toBe("customers/1/campaigns/55");
    expect(createOp.name).toBe("My Clone");
    expect(createOp.status).toBe("ENABLED");
    expect(createOp).not.toHaveProperty("type");
    expect(createOp).not.toHaveProperty("cpc_bid_micros");

    // Only the create mutation ran (no keyword chunk mutation since list empty)
    expect((runMutation as any).mock.calls).toHaveLength(1);
  });

  it("clone_ad_group falls back to empty source campaign id and default 'Ad Group' name", async () => {
    // source row missing campaign and name -> sourceCampaignId "" and name fallback
    (runQuery as any).mockResolvedValueOnce([{ ad_group: {} }]);
    (runMutation as any).mockResolvedValueOnce({
      mutate_operation_responses: [{ ad_group_result: { resource_name: "customers/1/adGroups/321" } }],
    });
    (runQuery as any).mockResolvedValueOnce([]);

    const res = await call("clone_ad_group", { customerId: "1", sourceAdGroupId: "100" });
    const out = toolJson(res) as any;
    expect(out.targetCampaignId).toBe("");
    const createOp = (runMutation as any).mock.calls[0][1][0].ad_group_operation.create;
    expect(createOp.campaign).toBe("customers/1/campaigns/");
    expect(createOp.name).toBe("Ad Group - Copy");
  });

  it("clone_ad_group chunks large keyword sets into multiple mutations and normalizes status fallback", async () => {
    (runQuery as any).mockResolvedValueOnce([
      { ad_group: { name: "Src" }, campaign: { id: "7" } },
    ]);
    (runMutation as any).mockResolvedValueOnce({
      mutate_operation_responses: [{ ad_group_result: { resource_name: "customers/1/adGroups/12" } }],
    });
    // 150 keywords -> two chunks (100 + 50). Use status that doesn't match ENABLED/PAUSED
    // so normalizeStatus falls back to args.status (default PAUSED).
    const kwRows = Array.from({ length: 150 }, (_, i) => ({
      ad_group_criterion: { status: 99, keyword: { text: `kw${i}`, match_type: "BROAD" } },
    }));
    (runQuery as any).mockResolvedValueOnce(kwRows);
    (runMutation as any).mockResolvedValue({}); // remaining mutations

    const res = await call("clone_ad_group", { customerId: "1", sourceAdGroupId: "100" });
    const out = toolJson(res) as any;
    expect(out.keywordsCopied).toBe(150);
    // 1 create + 2 keyword chunks = 3 mutations
    expect((runMutation as any).mock.calls).toHaveLength(3);
    expect((runMutation as any).mock.calls[1][1]).toHaveLength(100);
    expect((runMutation as any).mock.calls[2][1]).toHaveLength(50);
    // fallback status (PAUSED) applied
    const status = (runMutation as any).mock.calls[1][1][0].ad_group_criterion_operation.create.status;
    expect(status).toBe("PAUSED");
  });

  it("clone_ad_group normalizes string PAUSED keyword status", async () => {
    (runQuery as any).mockResolvedValueOnce([{ ad_group: { name: "Src" }, campaign: { id: "7" } }]);
    (runMutation as any).mockResolvedValueOnce({
      mutate_operation_responses: [{ ad_group_result: { resource_name: "customers/1/adGroups/12" } }],
    });
    (runQuery as any).mockResolvedValueOnce([
      { ad_group_criterion: { status: "PAUSED", keyword: { text: "kw", match_type: "BROAD" } } },
    ]);
    (runMutation as any).mockResolvedValue({});
    const res = await call("clone_ad_group", { customerId: "1", sourceAdGroupId: "100", status: "ENABLED" });
    expect(res.isError).toBeUndefined();
    const status = (runMutation as any).mock.calls[1][1][0].ad_group_criterion_operation.create.status;
    expect(status).toBe("PAUSED");
  });

  it("clone_ad_group skips an empty chunk (opsChunk.length > 0 is false)", async () => {
    (runQuery as any).mockResolvedValueOnce([{ ad_group: { name: "Src" }, campaign: { id: "7" } }]);
    (runMutation as any).mockResolvedValueOnce({
      mutate_operation_responses: [{ ad_group_result: { resource_name: "customers/1/adGroups/55" } }],
    });
    (runQuery as any).mockResolvedValueOnce([
      { ad_group_criterion: { status: "PAUSED", keyword: { text: "kw", match_type: "BROAD" } } },
    ]);
    (runMutation as any).mockResolvedValue({});
    // Force chunk() to yield an empty sub-array first, then the real chunk, so the
    // loop iterates over an empty chunk and the `if (opsChunk.length > 0)` guard
    // takes its false branch (line 154).
    (chunk as any).mockReturnValueOnce([[], [
      {
        ad_group_criterion_operation: {
          create: {
            ad_group: "customers/1/adGroups/55",
            status: "PAUSED",
            keyword: { text: "kw", match_type: "BROAD" },
          },
        },
      },
    ]]);

    const res = await call("clone_ad_group", { customerId: "1", sourceAdGroupId: "100" });
    expect(res.isError).toBeUndefined();
    // 1 create mutation + 1 non-empty keyword chunk (empty chunk skipped) = 2 calls
    expect((runMutation as any).mock.calls).toHaveLength(2);
    expect((runMutation as any).mock.calls[1][1]).toHaveLength(1);
  });
});
