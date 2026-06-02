import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));

import { pauseAdGroup, enableAdGroup, removeAdGroup } from "./adgroups.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { fakeCustomer } from "../test/harness.js";

const customer = fakeCustomer();

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(customer);
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
});

describe("adgroups lifecycle tools", () => {
  it("pauseAdGroup updates status to PAUSED with the status mask", async () => {
    await pauseAdGroup({ customerId: "123", adGroupId: "55" });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_operation;
    expect(op.update).toEqual({ resource_name: "customers/123/adGroups/55", status: "PAUSED" });
    expect(op.update_mask.paths).toEqual(["status"]);
    expect((runMutation as any).mock.calls[0][0]).toBe(customer);
  });

  it("enableAdGroup updates status to ENABLED and forwards userId", async () => {
    await enableAdGroup({ customerId: "123", adGroupId: "55", userId: "u1" });
    expect(getCustomer).toHaveBeenCalledWith("123", "u1");
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_operation;
    expect(op.update.status).toBe("ENABLED");
    expect(op.update.resource_name).toBe("customers/123/adGroups/55");
  });

  it("removeAdGroup issues a remove operation", async () => {
    await removeAdGroup({ customerId: "123", adGroupId: "55" });
    const op = (runMutation as any).mock.calls[0][1][0].ad_group_operation;
    expect(op).toEqual({ remove: "customers/123/adGroups/55" });
    expect(getCustomer).toHaveBeenCalledWith("123", undefined);
  });

  it("removeAdGroup forwards userId", async () => {
    await removeAdGroup({ customerId: "123", adGroupId: "55", userId: "u2" });
    expect(getCustomer).toHaveBeenCalledWith("123", "u2");
  });
});
