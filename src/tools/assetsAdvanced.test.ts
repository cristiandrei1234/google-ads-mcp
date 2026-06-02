import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerAssetsAdvancedTools } from "./assetsAdvanced.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerAssetsAdvancedTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ asset: { id: "1" } }]);
});

const lastQuery = () => (runQuery as any).mock.calls.at(-1)[0].query as string;
const mut = (i = 0) => (runMutation as any).mock.calls[i][1][0];

describe("registerAssetsAdvancedTools", () => {
  it("registers all 13 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "create_asset_group",
        "link_ad_group_asset",
        "link_asset_group_asset",
        "link_campaign_asset",
        "link_customer_asset",
        "list_asset_groups",
        "list_asset_links",
        "remove_asset_group",
        "unlink_ad_group_asset",
        "unlink_asset_group_asset",
        "unlink_campaign_asset",
        "unlink_customer_asset",
        "update_asset_group",
      ].sort()
    );
  });
});

describe("list_asset_groups", () => {
  it("queries without a filter", async () => {
    await call("list_asset_groups", { customerId: "1", limit: 100 });
    expect(lastQuery()).not.toContain("WHERE");
    expect(lastQuery()).toContain("LIMIT 100");
  });

  it("adds a campaign filter", async () => {
    await call("list_asset_groups", { customerId: "1", campaignId: "customers/1/campaigns/55", limit: 7 });
    expect(lastQuery()).toContain("WHERE campaign.id = 55");
    expect(lastQuery()).toContain("LIMIT 7");
  });
});

describe("create_asset_group", () => {
  it("creates with only required fields", async () => {
    await call("create_asset_group", { customerId: "1234567890", campaignId: "55", name: "G", status: "PAUSED" });
    const create = mut().asset_group_operation.create;
    expect(create).toMatchObject({
      campaign: "customers/1234567890/campaigns/55",
      name: "G",
      status: "PAUSED",
    });
    expect(create.final_urls).toBeUndefined();
    expect(create.path1).toBeUndefined();
    expect(create.path2).toBeUndefined();
  });

  it("includes optional fields when provided", async () => {
    await call("create_asset_group", {
      customerId: "1234567890",
      campaignId: "55",
      name: "G",
      status: "ENABLED",
      finalUrls: ["https://example.com"],
      path1: "shoes",
      path2: "men",
    });
    const create = mut().asset_group_operation.create;
    expect(create.final_urls).toEqual(["https://example.com"]);
    expect(create.path1).toBe("shoes");
    expect(create.path2).toBe("men");
    expect(create.status).toBe("ENABLED");
  });

  it("ignores an empty finalUrls array", async () => {
    await call("create_asset_group", { customerId: "1234567890", campaignId: "55", name: "G", finalUrls: [] });
    expect(mut().asset_group_operation.create.final_urls).toBeUndefined();
  });
});

describe("update_asset_group", () => {
  it("builds an update mask from all fields", async () => {
    await call("update_asset_group", {
      customerId: "1234567890",
      assetGroupId: "99",
      name: "N",
      status: "REMOVED",
      finalUrls: ["https://e.com"],
      path1: "p1",
      path2: "p2",
    });
    const op = mut().asset_group_operation;
    expect(op.update.resource_name).toBe("customers/1234567890/assetGroups/99");
    expect(op.update_mask.paths).toEqual(["name", "status", "final_urls", "path1", "path2"]);
    expect(op.update.final_urls).toEqual(["https://e.com"]);
  });

  it("allows clearing path fields with empty strings", async () => {
    await call("update_asset_group", { customerId: "1234567890", assetGroupId: "99", path1: "", path2: "" });
    const op = mut().asset_group_operation;
    expect(op.update_mask.paths).toEqual(["path1", "path2"]);
    expect(op.update.path1).toBe("");
  });

  it("errors when no fields are given", async () => {
    const res = await call("update_asset_group", { customerId: "1234567890", assetGroupId: "99" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
  });
});

describe("remove_asset_group", () => {
  it("issues a remove mutation", async () => {
    await call("remove_asset_group", { customerId: "1234567890", assetGroupId: "99" });
    expect(mut().asset_group_operation.remove).toBe("customers/1234567890/assetGroups/99");
  });
});

describe("link_customer_asset", () => {
  it("creates a customer asset link with default status", async () => {
    await call("link_customer_asset", { customerId: "1234567890", assetId: "5", fieldType: "SITELINK", status: "ENABLED" });
    const create = mut().customer_asset_operation.create;
    expect(create).toEqual({
      asset: "customers/1234567890/assets/5",
      field_type: "SITELINK",
      status: "ENABLED",
    });
  });
});

describe("unlink_customer_asset", () => {
  it("uses an explicit resourceName", async () => {
    await call("unlink_customer_asset", { customerId: "1234567890", resourceName: "customers/1/customerAssets/5~SITELINK" });
    expect(mut().customer_asset_operation.remove).toBe("customers/1/customerAssets/5~SITELINK");
  });

  it("builds the resource name from assetId + fieldType", async () => {
    await call("unlink_customer_asset", { customerId: "1234567890", assetId: "5", fieldType: "SITELINK" });
    expect(mut().customer_asset_operation.remove).toBe("customers/1234567890/customerAssets/5~SITELINK");
  });

  it("errors when neither resourceName nor ids are provided", async () => {
    const res = await call("unlink_customer_asset", { customerId: "1234567890" });
    expect(res.isError).toBe(true);
  });

});

describe("link_campaign_asset", () => {
  it("creates a campaign asset link", async () => {
    await call("link_campaign_asset", {
      customerId: "1234567890",
      campaignId: "55",
      assetId: "5",
      fieldType: "SITELINK",
      status: "PAUSED",
    });
    expect(mut().campaign_asset_operation.create).toEqual({
      campaign: "customers/1234567890/campaigns/55",
      asset: "customers/1234567890/assets/5",
      field_type: "SITELINK",
      status: "PAUSED",
    });
  });
});

describe("unlink_campaign_asset", () => {
  it("uses an explicit resourceName", async () => {
    await call("unlink_campaign_asset", { customerId: "1", resourceName: "customers/1/campaignAssets/55~5~SITELINK" });
    expect(mut().campaign_asset_operation.remove).toBe("customers/1/campaignAssets/55~5~SITELINK");
  });

  it("builds the resource name from ids", async () => {
    await call("unlink_campaign_asset", { customerId: "1234567890", campaignId: "55", assetId: "5", fieldType: "SITELINK" });
    expect(mut().campaign_asset_operation.remove).toBe("customers/1234567890/campaignAssets/55~5~SITELINK");
  });

  it("errors when nothing usable is provided", async () => {
    const res = await call("unlink_campaign_asset", { customerId: "1", campaignId: "55" });
    expect(res.isError).toBe(true);
  });

});

describe("link_ad_group_asset", () => {
  it("creates an ad group asset link", async () => {
    await call("link_ad_group_asset", { customerId: "1234567890", adGroupId: "77", assetId: "5", fieldType: "SITELINK", status: "ENABLED" });
    expect(mut().ad_group_asset_operation.create).toEqual({
      ad_group: "customers/1234567890/adGroups/77",
      asset: "customers/1234567890/assets/5",
      field_type: "SITELINK",
      status: "ENABLED",
    });
  });
});

describe("unlink_ad_group_asset", () => {
  it("uses an explicit resourceName", async () => {
    await call("unlink_ad_group_asset", { customerId: "1", resourceName: "customers/1/adGroupAssets/77~5~SITELINK" });
    expect(mut().ad_group_asset_operation.remove).toBe("customers/1/adGroupAssets/77~5~SITELINK");
  });

  it("builds the resource name from ids", async () => {
    await call("unlink_ad_group_asset", { customerId: "1234567890", adGroupId: "77", assetId: "5", fieldType: "SITELINK" });
    expect(mut().ad_group_asset_operation.remove).toBe("customers/1234567890/adGroupAssets/77~5~SITELINK");
  });

  it("errors when nothing usable is provided", async () => {
    const res = await call("unlink_ad_group_asset", { customerId: "1" });
    expect(res.isError).toBe(true);
  });

});

describe("link_asset_group_asset", () => {
  it("creates an asset group asset link", async () => {
    await call("link_asset_group_asset", { customerId: "1234567890", assetGroupId: "88", assetId: "5", fieldType: "HEADLINE", status: "ENABLED" });
    expect(mut().asset_group_asset_operation.create).toEqual({
      asset_group: "customers/1234567890/assetGroups/88",
      asset: "customers/1234567890/assets/5",
      field_type: "HEADLINE",
      status: "ENABLED",
    });
  });
});

describe("unlink_asset_group_asset", () => {
  it("uses an explicit resourceName", async () => {
    await call("unlink_asset_group_asset", { customerId: "1", resourceName: "customers/1/assetGroupAssets/88~5~HEADLINE" });
    expect(mut().asset_group_asset_operation.remove).toBe("customers/1/assetGroupAssets/88~5~HEADLINE");
  });

  it("builds the resource name from ids", async () => {
    await call("unlink_asset_group_asset", { customerId: "1234567890", assetGroupId: "88", assetId: "5", fieldType: "HEADLINE" });
    expect(mut().asset_group_asset_operation.remove).toBe("customers/1234567890/assetGroupAssets/88~5~HEADLINE");
  });

  it("errors when nothing usable is provided", async () => {
    const res = await call("unlink_asset_group_asset", { customerId: "1" });
    expect(res.isError).toBe(true);
  });

});

describe("unlink refine enforcement", () => {
  // Each Unlink* tool is registered with `Schema.parse(args)` so the .refine()
  // predicate runs at call time. These cases assert both sides of every refine:
  // the satisfied side (valid -> mutation issued) and the violated side
  // (invalid -> ZodError surfaced as isError with the refine message).
  it("customer: violating input surfaces the refine message", async () => {
    const res = await call("unlink_customer_asset", { customerId: "1234567890", assetId: "5" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or both assetId and fieldType/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("customer: satisfied refine issues the mutation", async () => {
    const res = await call("unlink_customer_asset", { customerId: "1234567890", assetId: "5", fieldType: "SITELINK" });
    expect(res.isError).toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("campaign: violating input surfaces the refine message", async () => {
    const res = await call("unlink_campaign_asset", { customerId: "1", campaignId: "55", assetId: "5" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or campaignId\+assetId\+fieldType/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("ad_group: violating input surfaces the refine message", async () => {
    const res = await call("unlink_ad_group_asset", { customerId: "1", adGroupId: "77", assetId: "5" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or adGroupId\+assetId\+fieldType/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("asset_group: violating input surfaces the refine message", async () => {
    const res = await call("unlink_asset_group_asset", { customerId: "1", assetGroupId: "88", assetId: "5" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Provide resourceName or assetGroupId\+assetId\+fieldType/i);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("resourceName-only satisfies every refine", async () => {
    await call("unlink_campaign_asset", { customerId: "1", resourceName: "customers/1/campaignAssets/55~5~SITELINK" });
    await call("unlink_ad_group_asset", { customerId: "1", resourceName: "customers/1/adGroupAssets/77~5~SITELINK" });
    await call("unlink_asset_group_asset", { customerId: "1", resourceName: "customers/1/assetGroupAssets/88~5~HEADLINE" });
    expect(runMutation).toHaveBeenCalledTimes(3);
  });
});

describe("list_asset_links", () => {
  it("level=customer queries customer_asset", async () => {
    await call("list_asset_links", { customerId: "1", level: "customer", limit: 100 });
    expect(lastQuery()).toContain("FROM customer_asset");
    expect(lastQuery()).toContain("WHERE 1 = 1");
  });

  it("level=customer with asset type filter", async () => {
    await call("list_asset_links", { customerId: "1", level: "customer", assetTypes: ["text", "image!"] });
    expect(lastQuery()).toContain("AND asset.type IN ('TEXT','IMAGE')");
  });

  it("asset type filter that sanitizes down to empty is ignored", async () => {
    await call("list_asset_links", { customerId: "1", level: "customer", assetTypes: ["!!!", "   "] });
    expect(lastQuery()).not.toContain("AND asset.type IN");
  });

  it("level=campaign queries campaign_asset with optional filter", async () => {
    await call("list_asset_links", { customerId: "1", level: "campaign", campaignId: "55" });
    expect(lastQuery()).toContain("FROM campaign_asset");
    expect(lastQuery()).toContain("AND campaign.id = 55");
  });

  it("level=campaign without campaignId omits the filter", async () => {
    await call("list_asset_links", { customerId: "1", level: "campaign" });
    expect(lastQuery()).toContain("FROM campaign_asset");
    expect(lastQuery()).not.toContain("AND campaign.id =");
  });

  it("level=ad_group queries ad_group_asset with optional filter", async () => {
    await call("list_asset_links", { customerId: "1", level: "ad_group", adGroupId: "77" });
    expect(lastQuery()).toContain("FROM ad_group_asset");
    expect(lastQuery()).toContain("AND ad_group.id = 77");
  });

  it("level=ad_group without adGroupId omits the filter", async () => {
    await call("list_asset_links", { customerId: "1", level: "ad_group" });
    expect(lastQuery()).not.toContain("AND ad_group.id =");
  });

  it("level=asset_group queries asset_group_asset with optional filter", async () => {
    await call("list_asset_links", { customerId: "1", level: "asset_group", assetGroupId: "88" });
    expect(lastQuery()).toContain("FROM asset_group_asset");
    expect(lastQuery()).toContain("AND asset_group.id = 88");
  });

  it("level=asset_group without assetGroupId omits the filter", async () => {
    await call("list_asset_links", { customerId: "1", level: "asset_group" });
    expect(lastQuery()).not.toContain("AND asset_group.id =");
  });

  it("level=all runs all four queries and aggregates", async () => {
    const res = await call("list_asset_links", { customerId: "1", level: "all" });
    expect((runQuery as any).mock.calls.length).toBe(4);
    const json = toolJson(res) as any;
    expect(json).toHaveProperty("customer");
    expect(json).toHaveProperty("campaign");
    expect(json).toHaveProperty("adGroup");
    expect(json).toHaveProperty("assetGroup");
  });

  it("defaults to level=all when level is omitted", async () => {
    await call("list_asset_links", { customerId: "1" });
    expect((runQuery as any).mock.calls.length).toBe(4);
  });
});
