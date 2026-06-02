import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));

import {
  addAdGroupNegativeKeyword,
  removeAdGroupNegativeKeyword,
  addCampaignNegativeKeyword,
  removeCampaignNegativeKeyword,
} from "./negativeKeywords.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { fakeCustomer } from "../test/harness.js";

const customer = fakeCustomer();

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(customer);
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
});

describe("negativeKeywords tools", () => {
  it("addAdGroupNegativeKeyword builds a negative ad_group_criterion create op", async () => {
    const res = await addAdGroupNegativeKeyword({
      customerId: "123",
      adGroupId: "456",
      text: "free stuff",
      matchType: "PHRASE",
    });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
    const op = (runMutation as any).mock.calls[0][1][0];
    expect(op.ad_group_criterion_operation.create).toEqual({
      ad_group: "customers/123/adGroups/456",
      negative: true,
      keyword: { text: "free stuff", match_type: "PHRASE" },
      status: "ENABLED",
    });
    expect((runMutation as any).mock.calls[0][0]).toBe(customer);
    expect(res).toEqual({ results: [{ resource_name: "rn" }] });
  });

  it("addAdGroupNegativeKeyword forwards userId to getCustomer", async () => {
    await addAdGroupNegativeKeyword({
      customerId: "123",
      adGroupId: "456",
      text: "x",
      matchType: "BROAD",
      userId: "user-1",
    });
    expect(getCustomer).toHaveBeenCalledWith("123", "user-1");
  });

  it("removeAdGroupNegativeKeyword builds a remove op with composite resource name", async () => {
    await removeAdGroupNegativeKeyword({
      customerId: "123",
      adGroupId: "456",
      criterionId: "789",
    });
    const op = (runMutation as any).mock.calls[0][1][0];
    expect(op.ad_group_criterion_operation.remove).toBe(
      "customers/123/adGroupCriteria/456~789",
    );
  });

  it("addCampaignNegativeKeyword builds a negative campaign_criterion create op", async () => {
    await addCampaignNegativeKeyword({
      customerId: "123",
      campaignId: "55",
      text: "cheap",
      matchType: "EXACT",
    });
    const op = (runMutation as any).mock.calls[0][1][0];
    expect(op.campaign_criterion_operation.create).toEqual({
      campaign: "customers/123/campaigns/55",
      negative: true,
      keyword: { text: "cheap", match_type: "EXACT" },
      status: "ENABLED",
    });
  });

  it("removeCampaignNegativeKeyword builds a remove op with composite resource name", async () => {
    await removeCampaignNegativeKeyword({
      customerId: "123",
      campaignId: "55",
      criterionId: "99",
    });
    const op = (runMutation as any).mock.calls[0][1][0];
    expect(op.campaign_criterion_operation.remove).toBe(
      "customers/123/campaignCriteria/55~99",
    );
  });

  it("exposes the tool schemas", async () => {
    const mod = await import("./negativeKeywords.js");
    expect(mod.AddAdGroupNegativeKeywordToolSchema).toBeDefined();
    expect(mod.RemoveAdGroupNegativeKeywordToolSchema).toBeDefined();
    expect(mod.AddCampaignNegativeKeywordToolSchema).toBeDefined();
    expect(mod.RemoveCampaignNegativeKeywordToolSchema).toBeDefined();
  });
});
