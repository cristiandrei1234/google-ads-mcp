import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));

import { pauseCampaign, enableCampaign, removeCampaign } from "./campaigns.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { fakeCustomer } from "../test/harness.js";

const customer = fakeCustomer();

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(customer);
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
});

describe("campaigns lifecycle tools", () => {
  it("pauseCampaign updates status to PAUSED with the status mask", async () => {
    await pauseCampaign({ customerId: "123", campaignId: "7" });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
    const op = (runMutation as any).mock.calls[0][1][0].campaign_operation;
    expect(op.update).toEqual({ resource_name: "customers/123/campaigns/7", status: "PAUSED" });
    expect(op.update_mask.paths).toEqual(["status"]);
    expect((runMutation as any).mock.calls[0][0]).toBe(customer);
  });

  it("enableCampaign updates status to ENABLED and forwards userId", async () => {
    await enableCampaign({ customerId: "123", campaignId: "7", userId: "u1" });
    expect(getCustomer).toHaveBeenCalledWith("123", "u1");
    const op = (runMutation as any).mock.calls[0][1][0].campaign_operation;
    expect(op.update.status).toBe("ENABLED");
    expect(op.update.resource_name).toBe("customers/123/campaigns/7");
  });

  it("removeCampaign issues a remove operation", async () => {
    await removeCampaign({ customerId: "123", campaignId: "7" });
    const op = (runMutation as any).mock.calls[0][1][0].campaign_operation;
    expect(op).toEqual({ remove: "customers/123/campaigns/7" });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
  });

  it("removeCampaign forwards userId", async () => {
    await removeCampaign({ customerId: "123", campaignId: "7", userId: "u2" });
    expect(getCustomer).toHaveBeenCalledWith("123", "u2");
  });
});
