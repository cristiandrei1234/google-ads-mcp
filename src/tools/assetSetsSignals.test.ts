import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerAssetSetsSignalsTools } from "./assetSetsSignals.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerAssetSetsSignalsTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

const CID = "123-456-7890";
const NCID = "1234567890";

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ asset_set: { id: "1" } }]);
});

describe("assetSetsSignals tools", () => {
  it("registers all 15 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "list_asset_sets",
        "create_asset_set",
        "update_asset_set",
        "remove_asset_set",
        "list_asset_set_assets",
        "link_asset_set_asset",
        "unlink_asset_set_asset",
        "list_campaign_asset_sets",
        "link_campaign_asset_set",
        "unlink_campaign_asset_set",
        "list_asset_group_signals",
        "create_asset_group_signal",
        "update_asset_group_signal",
        "remove_asset_group_signal",
      ].sort()
    );
  });

  // ---------------- list_asset_sets ----------------
  it("list_asset_sets without filters builds a query with no WHERE", async () => {
    await call("list_asset_sets", { customerId: CID, limit: 100 });
    const q = (runQuery as any).mock.calls[0][0];
    expect(q.customerId).toBe(CID);
    expect(q.query).not.toContain("WHERE");
    expect(q.query).toContain("LIMIT 100");
  });

  it("list_asset_sets with only type filter", async () => {
    await call("list_asset_sets", { customerId: CID, type: "PAGE_FEED", limit: 50 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain("WHERE asset_set.type = PAGE_FEED");
    expect(q).not.toContain("AND");
  });

  it("list_asset_sets with only status filter", async () => {
    await call("list_asset_sets", { customerId: CID, status: "ENABLED", limit: 50 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain("WHERE asset_set.status = ENABLED");
  });

  it("list_asset_sets with both type and status filters joins with AND", async () => {
    await call("list_asset_sets", { customerId: CID, type: "PAGE_FEED", status: "ENABLED", limit: 10 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain("WHERE asset_set.type = PAGE_FEED AND asset_set.status = ENABLED");
  });

  // ---------------- create_asset_set ----------------
  it("create_asset_set sends create mutation with defaults passed through", async () => {
    await call("create_asset_set", { customerId: CID, name: "S", type: "PAGE_FEED", status: "ENABLED" });
    expect(getCustomer).toHaveBeenCalledWith(CID, undefined);
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_operation;
    expect(op.create).toEqual({ name: "S", type: "PAGE_FEED", status: "ENABLED" });
  });

  // ---------------- update_asset_set ----------------
  it("update_asset_set with name only builds name path", async () => {
    await call("update_asset_set", { customerId: CID, assetSetId: "555", name: "NewName" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_operation;
    expect(op.update_mask.paths).toEqual(["name"]);
    expect(op.update.name).toBe("NewName");
    expect(op.update.resource_name).toBe(`customers/${NCID}/assetSets/555`);
  });

  it("update_asset_set with status only builds status path", async () => {
    await call("update_asset_set", { customerId: CID, assetSetId: "555", status: "REMOVED" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_operation;
    expect(op.update_mask.paths).toEqual(["status"]);
    expect(op.update.status).toBe("REMOVED");
  });

  it("update_asset_set with both fields builds both paths", async () => {
    await call("update_asset_set", { customerId: CID, assetSetId: "555", name: "N", status: "ENABLED" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_operation;
    expect(op.update_mask.paths).toEqual(["name", "status"]);
  });

  it("update_asset_set errors when no fields are given", async () => {
    const res = await call("update_asset_set", { customerId: CID, assetSetId: "555" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("update_asset_set accepts a full resource name passthrough", async () => {
    const rn = `customers/${NCID}/assetSets/777`;
    await call("update_asset_set", { customerId: CID, assetSetId: rn, name: "N" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_operation;
    expect(op.update.resource_name).toBe(rn);
  });

  // ---------------- remove_asset_set ----------------
  it("remove_asset_set sends a remove mutation", async () => {
    await call("remove_asset_set", { customerId: CID, assetSetId: "555" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_operation;
    expect(op.remove).toBe(`customers/${NCID}/assetSets/555`);
  });

  // ---------------- list_asset_set_assets ----------------
  it("list_asset_set_assets without filter has no WHERE", async () => {
    await call("list_asset_set_assets", { customerId: CID, limit: 200 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).not.toContain("WHERE");
    expect(q).toContain("FROM asset_set_asset");
  });

  it("list_asset_set_assets with assetSetId filter", async () => {
    await call("list_asset_set_assets", { customerId: CID, assetSetId: "555", limit: 200 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain(`WHERE asset_set_asset.asset_set = 'customers/${NCID}/assetSets/555'`);
  });

  // ---------------- link_asset_set_asset ----------------
  it("link_asset_set_asset sends create mutation", async () => {
    await call("link_asset_set_asset", { customerId: CID, assetSetId: "555", assetId: "888", status: "ENABLED" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_asset_operation;
    expect(op.create).toEqual({
      asset_set: `customers/${NCID}/assetSets/555`,
      asset: `customers/${NCID}/assets/888`,
      status: "ENABLED",
    });
  });

  // ---------------- unlink_asset_set_asset ----------------
  it("unlink_asset_set_asset uses explicit resourceName when given", async () => {
    const rn = `customers/${NCID}/assetSetAssets/555~888`;
    await call("unlink_asset_set_asset", { customerId: CID, resourceName: rn });
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_asset_operation;
    expect(op.remove).toBe(rn);
  });

  it("unlink_asset_set_asset builds resourceName from ids when resourceName absent", async () => {
    await call("unlink_asset_set_asset", { customerId: CID, assetSetId: "555", assetId: "888" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_asset_operation;
    expect(op.remove).toBe(`customers/${NCID}/assetSetAssets/555~888`);
  });

  // ---------------- list_campaign_asset_sets ----------------
  it("list_campaign_asset_sets without filter has no WHERE", async () => {
    await call("list_campaign_asset_sets", { customerId: CID, limit: 200 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).not.toContain("WHERE");
    expect(q).toContain("FROM campaign_asset_set");
  });

  it("list_campaign_asset_sets with campaignId filter", async () => {
    await call("list_campaign_asset_sets", { customerId: CID, campaignId: "999", limit: 200 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain(`WHERE campaign_asset_set.campaign = 'customers/${NCID}/campaigns/999'`);
  });

  // ---------------- link_campaign_asset_set ----------------
  it("link_campaign_asset_set sends create mutation", async () => {
    await call("link_campaign_asset_set", { customerId: CID, campaignId: "999", assetSetId: "555", status: "REMOVED" });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_asset_set_operation;
    expect(op.create).toEqual({
      campaign: `customers/${NCID}/campaigns/999`,
      asset_set: `customers/${NCID}/assetSets/555`,
      status: "REMOVED",
    });
  });

  // ---------------- unlink_campaign_asset_set ----------------
  it("unlink_campaign_asset_set uses explicit resourceName when given", async () => {
    const rn = `customers/${NCID}/campaignAssetSets/999~555`;
    await call("unlink_campaign_asset_set", { customerId: CID, resourceName: rn });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_asset_set_operation;
    expect(op.remove).toBe(rn);
  });

  it("unlink_campaign_asset_set builds resourceName from ids when resourceName absent", async () => {
    await call("unlink_campaign_asset_set", { customerId: CID, campaignId: "999", assetSetId: "555" });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_asset_set_operation;
    expect(op.remove).toBe(`customers/${NCID}/campaignAssetSets/999~555`);
  });

  // ---------------- list_asset_group_signals ----------------
  it("list_asset_group_signals without filter has no WHERE", async () => {
    await call("list_asset_group_signals", { customerId: CID, limit: 200 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).not.toContain("WHERE");
    expect(q).toContain("FROM asset_group_signal");
  });

  it("list_asset_group_signals with assetGroupId filter", async () => {
    await call("list_asset_group_signals", { customerId: CID, assetGroupId: "321", limit: 200 });
    const q = (runQuery as any).mock.calls[0][0].query;
    expect(q).toContain(`WHERE asset_group_signal.asset_group = 'customers/${NCID}/assetGroups/321'`);
  });

  // ---------------- create_asset_group_signal ----------------
  it("create_asset_group_signal with audienceId builds audience signal", async () => {
    await call("create_asset_group_signal", { customerId: CID, assetGroupId: "321", audienceId: "111" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_group_signal_operation;
    expect(op.create).toEqual({
      asset_group: `customers/${NCID}/assetGroups/321`,
      audience: { audience: `customers/${NCID}/audiences/111` },
    });
  });

  it("create_asset_group_signal with searchThemeText builds search_theme signal", async () => {
    await call("create_asset_group_signal", { customerId: CID, assetGroupId: "321", searchThemeText: "shoes" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_group_signal_operation;
    expect(op.create).toEqual({
      asset_group: `customers/${NCID}/assetGroups/321`,
      search_theme: { text: "shoes" },
    });
  });

  // ---------------- update_asset_group_signal ----------------
  it("update_asset_group_signal with audienceId builds audience path", async () => {
    const rn = `customers/${NCID}/assetGroupSignals/321~aud`;
    await call("update_asset_group_signal", { customerId: CID, resourceName: rn, audienceId: "111" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_group_signal_operation;
    expect(op.update.resource_name).toBe(rn);
    expect(op.update.audience).toEqual({ audience: `customers/${NCID}/audiences/111` });
    expect(op.update_mask.paths).toEqual(["audience"]);
  });

  it("update_asset_group_signal with searchThemeText builds search_theme path", async () => {
    const rn = `customers/${NCID}/assetGroupSignals/321~st`;
    await call("update_asset_group_signal", { customerId: CID, resourceName: rn, searchThemeText: "boots" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_group_signal_operation;
    expect(op.update.search_theme).toEqual({ text: "boots" });
    expect(op.update_mask.paths).toEqual(["search_theme"]);
  });

  it("update_asset_group_signal rejects when NEITHER audienceId nor searchThemeText is given", async () => {
    const rn = `customers/${NCID}/assetGroupSignals/321~none`;
    const res = await call("update_asset_group_signal", { customerId: CID, resourceName: rn });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/exactly one of audienceId or searchThemeText/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  // ---------------- remove_asset_group_signal ----------------
  it("remove_asset_group_signal sends a remove mutation", async () => {
    const rn = `customers/${NCID}/assetGroupSignals/321~x`;
    await call("remove_asset_group_signal", { customerId: CID, resourceName: rn });
    const op = (runMutation as any).mock.calls[0][1][0].asset_group_signal_operation;
    expect(op.remove).toBe(rn);
  });

  // ---------------- error propagation through asTool ----------------
  it("surfaces an error from getCustomer via asTool", async () => {
    (getCustomer as any).mockRejectedValue(new Error("boom"));
    const res = await call("create_asset_set", { customerId: CID, name: "S", type: "PAGE_FEED", status: "ENABLED" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/boom/);
  });

  // ---------------- unlink_asset_set_asset: handler with resourceName falsy ----------------
  // Exercises the right-hand side of `args.resourceName || toAssetSetAssetResourceName(...)`
  // when resourceName is the empty string (falsy) — the ids branch must build the name.
  it("unlink_asset_set_asset falls back to ids when resourceName is empty string", async () => {
    await call("unlink_asset_set_asset", { customerId: CID, resourceName: "", assetSetId: "555", assetId: "888" });
    const op = (runMutation as any).mock.calls[0][1][0].asset_set_asset_operation;
    expect(op.remove).toBe(`customers/${NCID}/assetSetAssets/555~888`);
  });

  it("unlink_campaign_asset_set falls back to ids when resourceName is empty string", async () => {
    await call("unlink_campaign_asset_set", { customerId: CID, resourceName: "", campaignId: "999", assetSetId: "555" });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_asset_set_operation;
    expect(op.remove).toBe(`customers/${NCID}/campaignAssetSets/999~555`);
  });

  // ---------------- enforced .refine() validation (Decision A) ----------------
  // Registration now validates args against the FULL refined schema before the
  // handler runs (Schema.parse(args)), so refine violations throw a ZodError that
  // asTool turns into an isError result. These tests cover BOTH sides of each
  // refine predicate (valid + violating).

  it("create_asset_group_signal rejects when BOTH audienceId and searchThemeText are given", async () => {
    const res = await call("create_asset_group_signal", {
      customerId: CID,
      assetGroupId: "321",
      audienceId: "111",
      searchThemeText: "shoes",
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/exactly one of audienceId or searchThemeText/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("create_asset_group_signal rejects when NEITHER audienceId nor searchThemeText is given", async () => {
    const res = await call("create_asset_group_signal", { customerId: CID, assetGroupId: "321" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/exactly one of audienceId or searchThemeText/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("update_asset_group_signal rejects when BOTH audienceId and searchThemeText are given", async () => {
    const rn = `customers/${NCID}/assetGroupSignals/321~both`;
    const res = await call("update_asset_group_signal", {
      customerId: CID,
      resourceName: rn,
      audienceId: "111",
      searchThemeText: "boots",
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/exactly one of audienceId or searchThemeText/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("unlink_asset_set_asset rejects when neither resourceName nor assetSetId+assetId is given", async () => {
    const res = await call("unlink_asset_set_asset", { customerId: CID });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or assetSetId\+assetId/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("unlink_campaign_asset_set rejects when neither resourceName nor campaignId+assetSetId is given", async () => {
    const res = await call("unlink_campaign_asset_set", { customerId: CID });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or campaignId\+assetSetId/i);
    expect(runMutation).not.toHaveBeenCalled();
  });
});
