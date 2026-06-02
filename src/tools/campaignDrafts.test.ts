import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerCampaignDraftTools } from "./campaignDrafts.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer, type FakeCustomer } from "../test/harness.js";

const tools = captureTools(registerCampaignDraftTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

function draftCustomer(overrides: Record<string, unknown> = {}): FakeCustomer {
  const c = fakeCustomer();
  (c as any).callHeaders = { "x-h": "1" };
  (c as any).loadService = vi.fn();
  Object.assign(c as any, overrides);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(draftCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
  (runQuery as any).mockResolvedValue([{ campaign_draft: { draft_id: "1" } }]);
  delete process.env.GOOGLE_ADS_VALIDATE_ONLY;
});

afterEach(() => {
  delete process.env.GOOGLE_ADS_VALIDATE_ONLY;
});

describe("campaignDrafts tools", () => {
  it("registers all 6 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "list_campaign_drafts",
        "create_campaign_draft",
        "update_campaign_draft",
        "remove_campaign_draft",
        "promote_campaign_draft",
        "list_campaign_draft_async_errors",
      ].sort()
    );
  });

  describe("list_campaign_drafts", () => {
    it("builds GAQL without a filter when no baseCampaignId", async () => {
      await call("list_campaign_drafts", { customerId: "123-456-7890", limit: 50 });
      const q = (runQuery as any).mock.calls[0][0].query;
      expect(q).not.toContain("WHERE");
      expect(q).toContain("LIMIT 50");
      expect(q).toContain("ORDER BY campaign_draft.draft_id DESC");
    });

    it("builds GAQL with a base_campaign filter (bare id resolved to resource name)", async () => {
      await call("list_campaign_drafts", { customerId: "123-456-7890", baseCampaignId: "999", limit: 10 });
      const q = (runQuery as any).mock.calls[0][0].query;
      expect(q).toContain(
        "WHERE campaign_draft.base_campaign = 'customers/1234567890/campaigns/999'"
      );
    });

    it("accepts an already-qualified base campaign resource name", async () => {
      await call("list_campaign_drafts", {
        customerId: "1234567890",
        baseCampaignId: "customers/1234567890/campaigns/555",
      });
      const q = (runQuery as any).mock.calls[0][0].query;
      expect(q).toContain("customers/1234567890/campaigns/555");
    });
  });

  describe("create_campaign_draft", () => {
    it("sends a create mutation with base_campaign and name", async () => {
      await call("create_campaign_draft", {
        customerId: "1234567890",
        baseCampaignId: "777",
        name: "My Draft",
      });
      const ops = (runMutation as any).mock.calls[0][1];
      expect(ops[0].campaign_draft_operation.create).toEqual({
        base_campaign: "customers/1234567890/campaigns/777",
        name: "My Draft",
      });
      expect((runMutation as any).mock.calls[0][0]).toBe(await (getCustomer as any).mock.results[0].value);
    });
  });

  describe("update_campaign_draft", () => {
    it("builds an update mask with both fields", async () => {
      await call("update_campaign_draft", {
        customerId: "1234567890",
        draftId: "42",
        name: "New Name",
        status: "PROMOTING",
      });
      const op = (runMutation as any).mock.calls[0][1][0].campaign_draft_operation;
      expect(op.update_mask.paths).toEqual(["name", "status"]);
      expect(op.update).toMatchObject({
        resource_name: "customers/1234567890/campaignDrafts/42",
        name: "New Name",
        status: "PROMOTING",
      });
    });

    it("builds an update mask with only name", async () => {
      await call("update_campaign_draft", { customerId: "1234567890", draftId: "42", name: "Only" });
      const op = (runMutation as any).mock.calls[0][1][0].campaign_draft_operation;
      expect(op.update_mask.paths).toEqual(["name"]);
    });

    it("builds an update mask with only status", async () => {
      await call("update_campaign_draft", { customerId: "1234567890", draftId: "42", status: "REMOVED" });
      const op = (runMutation as any).mock.calls[0][1][0].campaign_draft_operation;
      expect(op.update_mask.paths).toEqual(["status"]);
    });

    it("errors when no updatable fields are provided", async () => {
      const res = await call("update_campaign_draft", { customerId: "1234567890", draftId: "42" });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/at least one field/i);
    });
  });

  describe("remove_campaign_draft", () => {
    it("sends a remove mutation with the draft resource name", async () => {
      await call("remove_campaign_draft", { customerId: "1234567890", draftId: "42" });
      const op = (runMutation as any).mock.calls[0][1][0].campaign_draft_operation;
      expect(op.remove).toBe("customers/1234567890/campaignDrafts/42");
    });
  });

  describe("promote_campaign_draft", () => {
    it("uses explicit validateOnly override and does not wait when waitForCompletion is false", async () => {
      const promoteFn = vi.fn(async () => [
        { promise: vi.fn() },
        { name: "operations/abc" },
      ]);
      const service = { promoteCampaignDraft: promoteFn };
      const customer = draftCustomer();
      (customer as any).loadService = vi.fn(() => service);
      (getCustomer as any).mockResolvedValue(customer);

      const res = await call("promote_campaign_draft", {
        customerId: "1234567890",
        draftId: "42",
        validateOnly: true,
        waitForCompletion: false,
      });
      const out = toolJson(res) as any;
      expect(out.validateOnly).toBe(true);
      expect(out.campaignDraftResourceName).toBe("customers/1234567890/campaignDrafts/42");
      expect(out.operationName).toBe("operations/abc");
      expect(out.completion).toBeUndefined();
      // request payload
      const reqArg = promoteFn.mock.calls[0][0];
      expect(reqArg).toEqual({
        campaign_draft: "customers/1234567890/campaignDrafts/42",
        validate_only: true,
      });
      // headers passed
      expect(promoteFn.mock.calls[0][1].otherArgs.headers).toEqual({ "x-h": "1" });
      expect((customer as any).loadService).toHaveBeenCalledWith("CampaignDraftServiceClient");
    });

    it("waits for completion when waitForCompletion is true and operation.promise exists", async () => {
      const promiseFn = vi.fn(async () => ({ done: true }));
      const promoteFn = vi.fn(async () => [{ promise: promiseFn }, { name: "operations/xyz" }]);
      const customer = draftCustomer();
      (customer as any).loadService = vi.fn(() => ({ promoteCampaignDraft: promoteFn }));
      (getCustomer as any).mockResolvedValue(customer);

      const res = await call("promote_campaign_draft", {
        customerId: "1234567890",
        draftId: "42",
        waitForCompletion: true,
      });
      const out = toolJson(res) as any;
      expect(promiseFn).toHaveBeenCalledTimes(1);
      expect(out.completion).toEqual({ done: true });
    });

    it("does not wait when waitForCompletion is true but operation has no promise", async () => {
      const promoteFn = vi.fn(async () => [{}, { name: "operations/none" }]);
      const customer = draftCustomer();
      (customer as any).loadService = vi.fn(() => ({ promoteCampaignDraft: promoteFn }));
      (getCustomer as any).mockResolvedValue(customer);

      const res = await call("promote_campaign_draft", {
        customerId: "1234567890",
        draftId: "42",
        waitForCompletion: true,
      });
      const out = toolJson(res) as any;
      expect(out.completion).toBeUndefined();
    });

    it("defaults validateOnly from GOOGLE_ADS_VALIDATE_ONLY env when no override", async () => {
      process.env.GOOGLE_ADS_VALIDATE_ONLY = "yes";
      const promoteFn = vi.fn(async () => [{}, { name: "operations/env" }]);
      const customer = draftCustomer();
      (customer as any).loadService = vi.fn(() => ({ promoteCampaignDraft: promoteFn }));
      (getCustomer as any).mockResolvedValue(customer);

      const res = await call("promote_campaign_draft", { customerId: "1234567890", draftId: "42" });
      expect((toolJson(res) as any).validateOnly).toBe(true);
      expect(promoteFn.mock.calls[0][0].validate_only).toBe(true);
    });

    it("defaults validateOnly to false when env is unset/empty", async () => {
      const promoteFn = vi.fn(async () => [{}, { name: "operations/env2" }]);
      const customer = draftCustomer();
      (customer as any).loadService = vi.fn(() => ({ promoteCampaignDraft: promoteFn }));
      (getCustomer as any).mockResolvedValue(customer);

      const res = await call("promote_campaign_draft", { customerId: "1234567890", draftId: "42" });
      expect((toolJson(res) as any).validateOnly).toBe(false);
    });

    it("handles a missing rawOperation (operationName undefined)", async () => {
      const promoteFn = vi.fn(async () => [{}, undefined]);
      const customer = draftCustomer();
      (customer as any).loadService = vi.fn(() => ({ promoteCampaignDraft: promoteFn }));
      (getCustomer as any).mockResolvedValue(customer);

      const res = await call("promote_campaign_draft", { customerId: "1234567890", draftId: "42" });
      const out = toolJson(res) as any;
      expect(out.operationName).toBeUndefined();
    });
  });

  describe("list_campaign_draft_async_errors", () => {
    it("calls the service and surfaces statuses + nextPageToken", async () => {
      const listFn = vi.fn(async () => [
        [{ error: "e1" }],
        { resource_name: "rn" },
        { next_page_token: "tok-2" },
      ]);
      const customer = draftCustomer();
      (customer as any).loadService = vi.fn(() => ({ listCampaignDraftAsyncErrors: listFn }));
      (getCustomer as any).mockResolvedValue(customer);

      const res = await call("list_campaign_draft_async_errors", {
        customerId: "1234567890",
        draftId: "42",
        pageSize: 25,
        pageToken: "tok-1",
      });
      const out = toolJson(res) as any;
      expect(out.campaignDraftResourceName).toBe("customers/1234567890/campaignDrafts/42");
      expect(out.statuses).toEqual([{ error: "e1" }]);
      expect(out.nextPageToken).toBe("tok-2");
      const reqArg = listFn.mock.calls[0][0];
      expect(reqArg).toEqual({
        resource_name: "customers/1234567890/campaignDrafts/42",
        page_size: 25,
        page_token: "tok-1",
      });
      expect(listFn.mock.calls[0][1].otherArgs.headers).toEqual({ "x-h": "1" });
    });

    it("handles missing response (nextPageToken undefined) and passes pageSize/pageToken", async () => {
      const listFn = vi.fn(async () => [[], {}, undefined]);
      const customer = draftCustomer();
      (customer as any).loadService = vi.fn(() => ({ listCampaignDraftAsyncErrors: listFn }));
      (getCustomer as any).mockResolvedValue(customer);

      const res = await call("list_campaign_draft_async_errors", {
        customerId: "1234567890",
        draftId: "42",
        pageSize: 100,
      });
      const out = toolJson(res) as any;
      expect(out.nextPageToken).toBeUndefined();
      expect(listFn.mock.calls[0][0].page_size).toBe(100);
      expect(listFn.mock.calls[0][0].page_token).toBeUndefined();
    });
  });
});
