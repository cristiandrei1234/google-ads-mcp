import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerKeywordsAdvancedTools } from "./keywordsAdvanced.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerKeywordsAdvancedTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([]);
});

describe("keywordsAdvanced tools", () => {
  it("registers all 5 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "bulk_add_keywords",
        "bulk_remove_keywords",
        "bulk_update_keywords",
        "list_keywords",
        "update_keyword",
      ].sort(),
    );
  });

  describe("list_keywords", () => {
    it("builds GAQL with only the default status filter", async () => {
      await call("list_keywords", { customerId: "1", limit: 200 });
      const arg = (runQuery as any).mock.calls[0][0];
      expect(arg.customerId).toBe("1");
      expect(arg.query).toContain("WHERE ad_group_criterion.status != 'REMOVED'");
      expect(arg.query).toContain("LIMIT 200");
      expect(arg.query).not.toContain("campaign.id =");
      expect(arg.query).not.toContain("ad_group.id =");
    });

    it("adds campaign and ad group filters and custom limit", async () => {
      await call("list_keywords", { customerId: "1", campaignId: "11", adGroupId: "22", limit: 50 });
      const q = (runQuery as any).mock.calls[0][0].query;
      expect(q).toContain("campaign.id = 11");
      expect(q).toContain("ad_group.id = 22");
      expect(q).toContain("LIMIT 50");
    });
  });

  describe("update_keyword (no text/match change)", () => {
    it("updates status and bid building the mask", async () => {
      await call("update_keyword", {
        customerId: "1",
        adGroupId: "5",
        keywordId: "7",
        status: "PAUSED",
        cpcBidMicros: 1000,
      });
      const op = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation;
      expect(op.update.resource_name).toBe("customers/1/adGroupCriteria/5~7");
      expect(op.update.status).toBe("PAUSED");
      expect(op.update.cpc_bid_micros).toBe(1000);
      expect(op.update_mask.paths).toEqual(["status", "cpc_bid_micros"]);
    });

    it("updates only status", async () => {
      await call("update_keyword", { customerId: "1", adGroupId: "5", keywordId: "7", status: "ENABLED" });
      const op = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation;
      expect(op.update_mask.paths).toEqual(["status"]);
      expect(op.update.cpc_bid_micros).toBeUndefined();
    });

    it("updates only cpc bid", async () => {
      await call("update_keyword", { customerId: "1", adGroupId: "5", keywordId: "7", cpcBidMicros: 42 });
      const op = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation;
      expect(op.update_mask.paths).toEqual(["cpc_bid_micros"]);
    });

    it("errors when no fields provided", async () => {
      const res = await call("update_keyword", { customerId: "1", adGroupId: "5", keywordId: "7" });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/No fields provided/i);
    });
  });

  describe("update_keyword (text/match replace flow)", () => {
    it("errors when keyword not found", async () => {
      (runQuery as any).mockResolvedValue([]);
      const res = await call("update_keyword", {
        customerId: "1",
        adGroupId: "5",
        keywordId: "7",
        text: "newword",
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/not found/i);
    });

    it("recreates the keyword using provided overrides", async () => {
      (runQuery as any).mockResolvedValue([
        {
          ad_group_criterion: {
            status: 3,
            cpc_bid_micros: 999,
            keyword: { text: "old", match_type: "BROAD" },
          },
        },
      ]);
      (runMutation as any).mockResolvedValueOnce({
        mutate_operation_responses: [{ ad_group_criterion_result: { resource_name: "newrn" } }],
      });
      (runMutation as any).mockResolvedValueOnce({});

      const res = await call("update_keyword", {
        customerId: "1",
        adGroupId: "5",
        keywordId: "7",
        text: "newword",
        matchType: "EXACT",
        status: "PAUSED",
        cpcBidMicros: 1234,
      });

      const create = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation.create;
      expect(create.ad_group).toBe("customers/1/adGroups/5");
      expect(create.status).toBe("PAUSED");
      expect(create.cpc_bid_micros).toBe(1234);
      expect(create.keyword).toEqual({ text: "newword", match_type: "EXACT" });

      const remove = (runMutation as any).mock.calls[1][1][0].ad_group_criterion_operation.remove;
      expect(remove).toBe("customers/1/adGroupCriteria/5~7");

      expect(toolJson(res)).toEqual({
        replacedKeywordId: "7",
        newKeywordResourceName: "newrn",
      });
    });

    it("derives status ENABLED from current status 2 and falls back to current values", async () => {
      (runQuery as any).mockResolvedValue([
        {
          ad_group_criterion: {
            status: 2,
            cpc_bid_micros: 500,
            keyword: { text: "currenttext", match_type: "PHRASE" },
          },
        },
      ]);
      // only matchType changes -> changingText true; no status/text/cpc overrides
      await call("update_keyword", {
        customerId: "1",
        adGroupId: "5",
        keywordId: "7",
        matchType: "EXACT",
      });
      const create = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation.create;
      expect(create.status).toBe("ENABLED");
      expect(create.cpc_bid_micros).toBe(500);
      expect(create.keyword).toEqual({ text: "currenttext", match_type: "EXACT" });
    });

    it("derives status PAUSED when current status is not 2 and handles missing current fields", async () => {
      (runQuery as any).mockResolvedValue([{ ad_group_criterion: {} }]);
      // Only matchType changes -> args.text is undefined, current text missing, so it
      // falls back to "" and current.match_type is undefined.
      await call("update_keyword", {
        customerId: "1",
        adGroupId: "5",
        keywordId: "7",
        matchType: "PHRASE",
      });
      const create = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation.create;
      expect(create.status).toBe("PAUSED");
      expect(create.cpc_bid_micros).toBe(0);
      expect(create.keyword.text).toBe("");
      expect(create.keyword.match_type).toBe("PHRASE");
    });

    it("handles a missing newKeywordResourceName / no responses", async () => {
      (runQuery as any).mockResolvedValue([{ ad_group_criterion: { keyword: { text: "t" } } }]);
      (runMutation as any).mockResolvedValueOnce({});
      (runMutation as any).mockResolvedValueOnce({});
      const res = await call("update_keyword", { customerId: "1", adGroupId: "5", keywordId: "7", text: "z" });
      expect(toolJson(res)).toEqual({ replacedKeywordId: "7", newKeywordResourceName: undefined });
    });
  });

  describe("bulk_add_keywords", () => {
    it("creates ops with and without cpc bids and reports count", async () => {
      const res = await call("bulk_add_keywords", {
        customerId: "1",
        adGroupId: "5",
        keywords: [
          { text: "a", matchType: "EXACT", status: "PAUSED", cpcBidMicros: 100 },
          { text: "b", matchType: "BROAD", status: "ENABLED" },
        ],
      });
      const ops = (runMutation as any).mock.calls[0][1];
      expect(ops[0].ad_group_criterion_operation.create).toEqual({
        ad_group: "customers/1/adGroups/5",
        status: "PAUSED",
        cpc_bid_micros: 100,
        keyword: { text: "a", match_type: "EXACT" },
      });
      expect(ops[1].ad_group_criterion_operation.create).toEqual({
        ad_group: "customers/1/adGroups/5",
        status: "ENABLED",
        keyword: { text: "b", match_type: "BROAD" },
      });
      expect(toolJson(res)).toEqual({ created: 2 });
    });

    it("chunks operations over 100 into multiple mutations", async () => {
      const keywords = Array.from({ length: 150 }, (_, i) => ({ text: `k${i}`, matchType: "EXACT" as const }));
      const res = await call("bulk_add_keywords", { customerId: "1", adGroupId: "5", keywords });
      expect((runMutation as any).mock.calls.length).toBe(2);
      expect((runMutation as any).mock.calls[0][1].length).toBe(100);
      expect((runMutation as any).mock.calls[1][1].length).toBe(50);
      expect(toolJson(res)).toEqual({ created: 150 });
    });

    it("does not call runMutation for an empty keyword list", async () => {
      const res = await call("bulk_add_keywords", { customerId: "1", adGroupId: "5", keywords: [] });
      expect((runMutation as any).mock.calls.length).toBe(0);
      expect(toolJson(res)).toEqual({ created: 0 });
    });
  });

  describe("bulk_update_keywords", () => {
    it("builds update ops, skipping entries with no changes", async () => {
      const res = await call("bulk_update_keywords", {
        customerId: "1",
        updates: [
          { adGroupId: "5", keywordId: "7", status: "PAUSED", cpcBidMicros: 50 },
          { adGroupId: "5", keywordId: "8", status: "ENABLED" },
          { adGroupId: "5", keywordId: "9", cpcBidMicros: 70 },
          { adGroupId: "5", keywordId: "10" }, // no fields -> skipped
        ],
      });
      const ops = (runMutation as any).mock.calls[0][1];
      expect(ops.length).toBe(3);
      expect(ops[0].ad_group_criterion_operation.update_mask.paths).toEqual(["status", "cpc_bid_micros"]);
      expect(ops[1].ad_group_criterion_operation.update_mask.paths).toEqual(["status"]);
      expect(ops[2].ad_group_criterion_operation.update_mask.paths).toEqual(["cpc_bid_micros"]);
      expect(ops[2].ad_group_criterion_operation.update.resource_name).toBe("customers/1/adGroupCriteria/5~9");
      expect(toolJson(res)).toEqual({ updated: 3 });
    });

    it("does not call runMutation when all entries are skipped", async () => {
      const res = await call("bulk_update_keywords", {
        customerId: "1",
        updates: [{ adGroupId: "5", keywordId: "7" }],
      });
      expect((runMutation as any).mock.calls.length).toBe(0);
      expect(toolJson(res)).toEqual({ updated: 0 });
    });

    it("chunks update operations over 100", async () => {
      const updates = Array.from({ length: 101 }, (_, i) => ({
        adGroupId: "5",
        keywordId: String(i),
        status: "ENABLED" as const,
      }));
      const res = await call("bulk_update_keywords", { customerId: "1", updates });
      expect((runMutation as any).mock.calls.length).toBe(2);
      expect(toolJson(res)).toEqual({ updated: 101 });
    });
  });

  describe("bulk_remove_keywords", () => {
    it("builds remove ops and reports count", async () => {
      const res = await call("bulk_remove_keywords", {
        customerId: "1",
        removals: [
          { adGroupId: "5", keywordId: "7" },
          { adGroupId: "5", keywordId: "8" },
        ],
      });
      const ops = (runMutation as any).mock.calls[0][1];
      expect(ops[0].ad_group_criterion_operation.remove).toBe("customers/1/adGroupCriteria/5~7");
      expect(ops[1].ad_group_criterion_operation.remove).toBe("customers/1/adGroupCriteria/5~8");
      expect(toolJson(res)).toEqual({ removed: 2 });
    });

    it("does not call runMutation for empty removals", async () => {
      const res = await call("bulk_remove_keywords", { customerId: "1", removals: [] });
      expect((runMutation as any).mock.calls.length).toBe(0);
      expect(toolJson(res)).toEqual({ removed: 0 });
    });

    it("chunks removals over 100", async () => {
      const removals = Array.from({ length: 200 }, (_, i) => ({ adGroupId: "5", keywordId: String(i) }));
      const res = await call("bulk_remove_keywords", { customerId: "1", removals });
      expect((runMutation as any).mock.calls.length).toBe(2);
      expect(toolJson(res)).toEqual({ removed: 200 });
    });

    it("surfaces errors from runMutation as isError", async () => {
      (runMutation as any).mockRejectedValueOnce(new Error("mut fail"));
      const res = await call("bulk_remove_keywords", {
        customerId: "1",
        removals: [{ adGroupId: "5", keywordId: "7" }],
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toContain("mut fail");
    });
  });
});
