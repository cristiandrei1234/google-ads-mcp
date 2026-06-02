import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerAudiencesAdvancedTools } from "./audiencesAdvanced.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerAudiencesAdvancedTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

// mutateCustomAudiences uses customer.loadService(...).mutateCustomAudiences and customer.callHeaders.
let mutateCustomAudiencesFn: ReturnType<typeof vi.fn>;
function customAudienceCustomer(rows: unknown = { resource_names: ["customers/1/customAudiences/5"] }) {
  const c = fakeCustomer() as any;
  mutateCustomAudiencesFn = vi.fn(async () => [rows]);
  c.loadService = vi.fn(() => ({ mutateCustomAudiences: mutateCustomAudiencesFn }));
  c.callHeaders = { "x-h": "1" };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GOOGLE_ADS_VALIDATE_ONLY;
  (getCustomer as any).mockResolvedValue(customAudienceCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ custom_audience: { id: "1" } }]);
});

afterEach(() => {
  delete process.env.GOOGLE_ADS_VALIDATE_ONLY;
});

describe("audiencesAdvanced tools", () => {
  it("registers all 11 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "add_ad_group_combined_audience_targeting",
        "add_ad_group_custom_audience_targeting",
        "add_campaign_combined_audience_targeting",
        "add_campaign_custom_audience_targeting",
        "create_custom_audience",
        "list_combined_audiences",
        "list_custom_audiences",
        "remove_ad_group_audience_targeting",
        "remove_campaign_audience_targeting",
        "remove_custom_audience",
        "update_custom_audience",
      ].sort()
    );
  });

  // --- list_custom_audiences ---
  it("list_custom_audiences builds GAQL with and without a status filter", async () => {
    await call("list_custom_audiences", { customerId: "1", limit: 5 });
    expect((runQuery as any).mock.calls[0][0].query).not.toContain("WHERE");
    expect((runQuery as any).mock.calls[0][0].query).toContain("LIMIT 5");

    await call("list_custom_audiences", { customerId: "1", limit: 7, status: "ENABLED", userId: "u" });
    const q = (runQuery as any).mock.calls[1][0];
    expect(q.query).toContain("WHERE custom_audience.status = ENABLED");
    expect(q.userId).toBe("u");
    expect(q.customerId).toBe("1");
  });

  // --- list_combined_audiences ---
  it("list_combined_audiences builds GAQL with and without a status filter", async () => {
    await call("list_combined_audiences", { customerId: "1", limit: 3 });
    expect((runQuery as any).mock.calls[0][0].query).not.toContain("WHERE");
    expect((runQuery as any).mock.calls[0][0].query).toContain("FROM combined_audience");

    await call("list_combined_audiences", { customerId: "1", limit: 3, status: "REMOVED" });
    expect((runQuery as any).mock.calls[1][0].query).toContain("WHERE combined_audience.status = REMOVED");
  });

  // --- create_custom_audience: each member type + description branch ---
  it("create_custom_audience builds KEYWORD member with description", async () => {
    await call("create_custom_audience", {
      customerId: "1",
      name: "Aud",
      type: "INTEREST",
      status: "ENABLED",
      description: "d",
      members: [{ memberType: "KEYWORD", keyword: "shoes" }],
    });
    const arg = mutateCustomAudiencesFn.mock.calls[0][0];
    expect(arg.operations[0].create).toMatchObject({
      name: "Aud",
      type: "INTEREST",
      status: "ENABLED",
      description: "d",
      members: [{ member_type: "KEYWORD", keyword: "shoes" }],
    });
    expect(arg.customer_id).toBe("1");
    expect(arg.validate_only).toBe(false);
  });

  it("create_custom_audience handles URL / PLACE_CATEGORY / APP members and omits description", async () => {
    await call("create_custom_audience", {
      customerId: "1",
      name: "Multi",
      members: [
        { memberType: "URL", url: "https://x" },
        { memberType: "PLACE_CATEGORY", placeCategory: 42 },
        { memberType: "APP", app: "com.x" },
      ],
    });
    const create = mutateCustomAudiencesFn.mock.calls[0][0].operations[0].create;
    // schema defaults are applied by the MCP layer (parse), not by the raw
    // handler captured here, so type/status pass through as provided/undefined.
    expect(create.description).toBeUndefined();
    expect(create.members).toEqual([
      { member_type: "URL", url: "https://x" },
      { member_type: "PLACE_CATEGORY", place_category: 42 },
      { member_type: "APP", app: "com.x" },
    ]);
  });

  it("create_custom_audience sets validate_only true when env flag enabled", async () => {
    process.env.GOOGLE_ADS_VALIDATE_ONLY = "TRUE";
    await call("create_custom_audience", {
      customerId: "1",
      name: "V",
      members: [{ memberType: "KEYWORD", keyword: "k" }],
    });
    expect(mutateCustomAudiencesFn.mock.calls[0][0].validate_only).toBe(true);
  });

  // member validation errors (asTool catches -> isError)
  it("create_custom_audience errors when KEYWORD member lacks keyword", async () => {
    const res = await call("create_custom_audience", {
      customerId: "1",
      name: "X",
      members: [{ memberType: "KEYWORD" }],
    });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/keyword is required/i);
  });

  it("create_custom_audience errors when URL member lacks url", async () => {
    const res = await call("create_custom_audience", {
      customerId: "1",
      name: "X",
      members: [{ memberType: "URL" }],
    });
    expect((toolJson(res) as any).__error).toMatch(/url is required/i);
  });

  it("create_custom_audience errors when PLACE_CATEGORY member lacks placeCategory", async () => {
    const res = await call("create_custom_audience", {
      customerId: "1",
      name: "X",
      members: [{ memberType: "PLACE_CATEGORY" }],
    });
    expect((toolJson(res) as any).__error).toMatch(/placeCategory is required/i);
  });

  it("create_custom_audience errors when APP member lacks app", async () => {
    const res = await call("create_custom_audience", {
      customerId: "1",
      name: "X",
      members: [{ memberType: "APP" }],
    });
    expect((toolJson(res) as any).__error).toMatch(/app is required/i);
  });

  // --- update_custom_audience: every field branch + empty error ---
  it("update_custom_audience builds an update_mask from all provided fields", async () => {
    await call("update_custom_audience", {
      customerId: "1",
      customAudienceId: "5",
      name: "N",
      description: "D",
      status: "REMOVED",
      type: "AUTO",
      members: [{ memberType: "KEYWORD", keyword: "k" }],
    });
    const op = mutateCustomAudiencesFn.mock.calls[0][0].operations[0];
    expect(op.update_mask.paths).toEqual(["name", "description", "status", "type", "members"]);
    expect(op.update.resource_name).toBe("customers/1/customAudiences/5");
    expect(op.update.members).toEqual([{ member_type: "KEYWORD", keyword: "k" }]);
  });

  it("update_custom_audience supports an empty-string description (defined branch)", async () => {
    await call("update_custom_audience", {
      customerId: "1",
      customAudienceId: "5",
      description: "",
    });
    const op = mutateCustomAudiencesFn.mock.calls[0][0].operations[0];
    expect(op.update_mask.paths).toEqual(["description"]);
    expect(op.update.description).toBe("");
  });

  it("update_custom_audience errors when no fields are given", async () => {
    const res = await call("update_custom_audience", { customerId: "1", customAudienceId: "5" });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
  });

  // --- remove_custom_audience ---
  it("remove_custom_audience issues a remove operation", async () => {
    await call("remove_custom_audience", { customerId: "1", customAudienceId: "5" });
    const op = mutateCustomAudiencesFn.mock.calls[0][0].operations[0];
    expect(op.remove).toBe("customers/1/customAudiences/5");
  });

  // --- campaign / ad-group targeting (custom + combined, negative branches) ---
  it("add_campaign_custom_audience_targeting builds a campaign_criterion create (default negative)", async () => {
    await call("add_campaign_custom_audience_targeting", {
      customerId: "1",
      campaignId: "7",
      customAudienceId: "5",
    });
    const create = (runMutation as any).mock.calls[0][1][0].campaign_criterion_operation.create;
    expect(create.campaign).toBe("customers/1/campaigns/7");
    // negative default is applied by schema parse at the MCP layer, not here.
    expect(create.negative).toBeUndefined();
    expect(create.custom_audience.custom_audience).toBe("customers/1/customAudiences/5");
  });

  it("add_campaign_combined_audience_targeting honors negative=true", async () => {
    await call("add_campaign_combined_audience_targeting", {
      customerId: "1",
      campaignId: "7",
      combinedAudienceId: "8",
      negative: true,
    });
    const create = (runMutation as any).mock.calls[0][1][0].campaign_criterion_operation.create;
    expect(create.negative).toBe(true);
    expect(create.combined_audience.combined_audience).toBe("customers/1/combinedAudiences/8");
  });

  it("add_ad_group_custom_audience_targeting builds an ad_group_criterion create", async () => {
    await call("add_ad_group_custom_audience_targeting", {
      customerId: "1",
      adGroupId: "9",
      customAudienceId: "5",
    });
    const create = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation.create;
    expect(create.ad_group).toBe("customers/1/adGroups/9");
    expect(create.custom_audience.custom_audience).toBe("customers/1/customAudiences/5");
  });

  it("add_ad_group_combined_audience_targeting builds an ad_group_criterion create", async () => {
    await call("add_ad_group_combined_audience_targeting", {
      customerId: "1",
      adGroupId: "9",
      combinedAudienceId: "8",
    });
    const create = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation.create;
    expect(create.ad_group).toBe("customers/1/adGroups/9");
    expect(create.combined_audience.combined_audience).toBe("customers/1/combinedAudiences/8");
  });

  // --- remove targeting (criterion resource name builders) ---
  it("remove_campaign_audience_targeting builds a campaignCriteria resource name", async () => {
    await call("remove_campaign_audience_targeting", {
      customerId: "1",
      campaignId: "7",
      criterionId: "33",
    });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_criterion_operation;
    expect(op.remove).toBe("customers/1/campaignCriteria/7~33");
  });

  it("remove_ad_group_audience_targeting builds an adGroupCriteria resource name", async () => {
    await call("remove_ad_group_audience_targeting", {
      customerId: "1",
      adGroupId: "9",
      criterionId: "44",
    });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation;
    expect(op.remove).toBe("customers/1/adGroupCriteria/9~44");
  });

  // resource-name passthrough branch (already-qualified input)
  it("targeting accepts already-qualified resource names unchanged", async () => {
    await call("add_campaign_custom_audience_targeting", {
      customerId: "1",
      campaignId: "customers/999/campaigns/77",
      customAudienceId: "customers/999/customAudiences/55",
    });
    const create = (runMutation as any).mock.calls[0][1][0].campaign_criterion_operation.create;
    expect(create.campaign).toBe("customers/999/campaigns/77");
    expect(create.custom_audience.custom_audience).toBe("customers/999/customAudiences/55");
  });
});
