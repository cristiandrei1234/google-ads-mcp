import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));

import { addKeyword, pauseKeyword, enableKeyword, removeKeyword } from "./keywords.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { fakeCustomer } from "../test/harness.js";

const customer = fakeCustomer();

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(customer);
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
});

describe("keywords lifecycle tools", () => {
  it("addKeyword creates an ENABLED keyword criterion", async () => {
    await addKeyword({ customerId: "123", adGroupId: "55", text: "shoes", matchType: "PHRASE" });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
    const create = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation.create;
    expect(create).toEqual({
      ad_group: "customers/123/adGroups/55",
      keyword: { text: "shoes", match_type: "PHRASE" },
      status: "ENABLED",
    });
    expect((runMutation as any).mock.calls[0][0]).toBe(customer);
  });

  it("addKeyword forwards userId and supports each match type", async () => {
    for (const matchType of ["BROAD", "PHRASE", "EXACT"] as const) {
      vi.clearAllMocks();
      (getCustomer as any).mockResolvedValue(customer);
      (runMutation as any).mockResolvedValue({});
      await addKeyword({ customerId: "1", adGroupId: "2", text: "t", matchType, userId: "u" });
      expect(getCustomer).toHaveBeenCalledWith("1", "u");
      const create = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation.create;
      expect(create.keyword.match_type).toBe(matchType);
    }
  });

  it("pauseKeyword builds the composite resource name and status mask", async () => {
    await pauseKeyword({ customerId: "123", adGroupId: "55", keywordId: "999" });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation;
    expect(op.update).toEqual({ resource_name: "customers/123/adGroupCriteria/55~999", status: "PAUSED" });
    expect(op.update_mask.paths).toEqual(["status"]);
  });

  it("enableKeyword updates status to ENABLED and forwards userId", async () => {
    await enableKeyword({ customerId: "123", adGroupId: "55", keywordId: "999", userId: "u1" });
    expect(getCustomer).toHaveBeenCalledWith("123", "u1");
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation;
    expect(op.update.status).toBe("ENABLED");
    expect(op.update.resource_name).toBe("customers/123/adGroupCriteria/55~999");
  });

  it("removeKeyword issues a remove operation", async () => {
    await removeKeyword({ customerId: "123", adGroupId: "55", keywordId: "999" });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_criterion_operation;
    expect(op).toEqual({ remove: "customers/123/adGroupCriteria/55~999" });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
  });

  it("removeKeyword forwards userId", async () => {
    await removeKeyword({ customerId: "123", adGroupId: "55", keywordId: "999", userId: "u2" });
    expect(getCustomer).toHaveBeenCalledWith("123", "u2");
  });
});
