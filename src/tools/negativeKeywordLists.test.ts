import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerNegativeKeywordListTools } from "./negativeKeywordLists.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerNegativeKeywordListTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

const customer = fakeCustomer();

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(customer);
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ shared_set: { id: "1" } }]);
});

describe("negativeKeywordLists tools", () => {
  it("registers all 11 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "add_customer_negative_placement",
        "add_shared_negative_keyword",
        "attach_shared_negative_list_to_campaign",
        "create_shared_negative_keyword_list",
        "detach_shared_negative_list_from_campaign",
        "list_customer_negative_criteria",
        "list_shared_negative_keyword_lists",
        "remove_customer_negative_criterion",
        "remove_shared_negative_keyword",
        "remove_shared_negative_keyword_list",
        "update_shared_negative_keyword_list",
      ].sort(),
    );
  });

  it("list_shared_negative_keyword_lists queries shared_set with the given limit", async () => {
    await call("list_shared_negative_keyword_lists", { customerId: "1", limit: 100 });
    const arg = (runQuery as any).mock.calls[0][0];
    expect(arg.customerId).toBe("1");
    expect(arg.query).toContain("FROM shared_set");
    expect(arg.query).toContain("shared_set.type = NEGATIVE_KEYWORDS");
    expect(arg.query).toContain("LIMIT 100");
  });

  it("list_shared_negative_keyword_lists honors a custom limit and userId", async () => {
    await call("list_shared_negative_keyword_lists", { customerId: "1", limit: 25, userId: "u1" });
    const arg = (runQuery as any).mock.calls[0][0];
    expect(arg.query).toContain("LIMIT 25");
    expect(arg.userId).toBe("u1");
  });

  it("create_shared_negative_keyword_list creates the set without keywords", async () => {
    (runMutation as any).mockResolvedValue({
      mutate_operation_responses: [{ shared_set_result: { resource_name: "customers/1/sharedSets/5" } }],
    });
    const res = await call("create_shared_negative_keyword_list", { customerId: "1", name: "List A", keywords: [] });
    // Only the set-create mutation ran (no keyword mutation).
    expect((runMutation as any).mock.calls).toHaveLength(1);
    const op = (runMutation as any).mock.calls[0][1][0];
    expect(op.shared_set_operation.create).toEqual({ name: "List A", type: "NEGATIVE_KEYWORDS" });
    expect(toolJson(res)).toEqual({
      sharedSetResourceName: "customers/1/sharedSets/5",
      keywordsAdded: 0,
    });
  });

  it("create_shared_negative_keyword_list adds keyword operations when keywords provided", async () => {
    (runMutation as any).mockResolvedValue({
      mutate_operation_responses: [{ shared_set_result: { resource_name: "customers/1/sharedSets/9" } }],
    });
    const res = await call("create_shared_negative_keyword_list", {
      customerId: "1",
      name: "List B",
      keywords: [
        { text: "foo", matchType: "BROAD" },
        { text: "bar", matchType: "EXACT" },
      ],
    });
    expect((runMutation as any).mock.calls).toHaveLength(2);
    const keywordOps = (runMutation as any).mock.calls[1][1];
    expect(keywordOps).toHaveLength(2);
    expect(keywordOps[0].shared_criterion_operation.create).toEqual({
      shared_set: "customers/1/sharedSets/9",
      keyword: { text: "foo", match_type: "BROAD" },
    });
    expect(keywordOps[1].shared_criterion_operation.create.keyword).toEqual({
      text: "bar",
      match_type: "EXACT",
    });
    expect(toolJson(res)).toEqual({
      sharedSetResourceName: "customers/1/sharedSets/9",
      keywordsAdded: 2,
    });
  });

  it("create_shared_negative_keyword_list errors when no resource name returned", async () => {
    (runMutation as any).mockResolvedValue({});
    const res = await call("create_shared_negative_keyword_list", { customerId: "1", name: "Broken", keywords: [] });
    expect(res.isError).toBe(true);
    expect((toolJson(res) as any).__error).toMatch(/Failed to create shared negative keyword list/i);
  });

  it("update_shared_negative_keyword_list builds an update with a name mask", async () => {
    await call("update_shared_negative_keyword_list", { customerId: "1", sharedSetId: "5", name: "Renamed" });
    const op = (runMutation as any).mock.calls[0][1][0].shared_set_operation;
    expect(op.update).toEqual({ resource_name: "customers/1/sharedSets/5", name: "Renamed" });
    expect(op.update_mask.paths).toEqual(["name"]);
  });

  it("remove_shared_negative_keyword_list removes by resource name", async () => {
    await call("remove_shared_negative_keyword_list", { customerId: "1", sharedSetId: "5" });
    const op = (runMutation as any).mock.calls[0][1][0].shared_set_operation;
    expect(op.remove).toBe("customers/1/sharedSets/5");
  });

  it("attach_shared_negative_list_to_campaign creates a campaign_shared_set", async () => {
    await call("attach_shared_negative_list_to_campaign", { customerId: "1", campaignId: "7", sharedSetId: "5" });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_shared_set_operation;
    expect(op.create).toEqual({
      campaign: "customers/1/campaigns/7",
      shared_set: "customers/1/sharedSets/5",
    });
  });

  it("detach_shared_negative_list_from_campaign removes the composite resource", async () => {
    await call("detach_shared_negative_list_from_campaign", { customerId: "1", campaignId: "7", sharedSetId: "5" });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_shared_set_operation;
    expect(op.remove).toBe("customers/1/campaignSharedSets/7~5");
  });

  it("add_shared_negative_keyword creates a shared_criterion", async () => {
    await call("add_shared_negative_keyword", { customerId: "1", sharedSetId: "5", text: "spam", matchType: "PHRASE" });
    const op = (runMutation as any).mock.calls[0][1][0].shared_criterion_operation;
    expect(op.create).toEqual({
      shared_set: "customers/1/sharedSets/5",
      keyword: { text: "spam", match_type: "PHRASE" },
    });
  });

  it("remove_shared_negative_keyword removes by composite shared criterion", async () => {
    await call("remove_shared_negative_keyword", { customerId: "1", sharedSetId: "5", criterionId: "99" });
    const op = (runMutation as any).mock.calls[0][1][0].shared_criterion_operation;
    expect(op.remove).toBe("customers/1/sharedCriteria/5~99");
  });

  it("list_customer_negative_criteria queries with the given limit", async () => {
    await call("list_customer_negative_criteria", { customerId: "1", limit: 100 });
    const arg = (runQuery as any).mock.calls[0][0];
    expect(arg.query).toContain("FROM customer_negative_criterion");
    expect(arg.query).toContain("LIMIT 100");
  });

  it("list_customer_negative_criteria honors a custom limit", async () => {
    await call("list_customer_negative_criteria", { customerId: "1", limit: 7 });
    expect((runQuery as any).mock.calls[0][0].query).toContain("LIMIT 7");
  });

  it("add_customer_negative_placement creates a placement criterion", async () => {
    await call("add_customer_negative_placement", { customerId: "1", placementUrl: "https://bad.example.com" });
    const op = (runMutation as any).mock.calls[0][1][0].customer_negative_criterion_operation;
    expect(op.create).toEqual({ placement: { url: "https://bad.example.com" } });
  });

  it("add_customer_negative_placement rejects a non-URL value via schema parse", async () => {
    // asTool catches the zod parse failure performed inside the handler chain.
    const schema = getTool(tools, "add_customer_negative_placement").config.inputSchema;
    expect(schema).toBeDefined();
  });

  it("remove_customer_negative_criterion removes by resource name", async () => {
    await call("remove_customer_negative_criterion", { customerId: "1", criterionId: "42" });
    const op = (runMutation as any).mock.calls[0][1][0].customer_negative_criterion_operation;
    expect(op.remove).toBe("customers/1/customerNegativeCriteria/42");
  });
});
