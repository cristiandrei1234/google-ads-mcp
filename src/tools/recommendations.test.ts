import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));

import {
  listRecommendations,
  applyRecommendation,
  dismissRecommendation,
} from "./recommendations.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";

function customerWithRecs(extra: Record<string, any> = {}) {
  const c: any = fakeCustomer([{ recommendation: { type: "X" } }]);
  c.recommendations = {
    applyRecommendation: vi.fn(async () => ({ applied: true })),
    dismissRecommendation: vi.fn(async () => ({ dismissed: true })),
    ...extra,
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listRecommendations", () => {
  it("builds the GAQL with the default limit", async () => {
    const c = customerWithRecs();
    (getCustomer as any).mockResolvedValue(c);
    const res = await listRecommendations({ customerId: "1", limit: 50 });
    expect(getCustomer).toHaveBeenCalledWith("1", undefined);
    expect(c.query.mock.calls[0][0]).toContain("FROM recommendation");
    expect(c.query.mock.calls[0][0]).toContain("LIMIT 50");
    expect(res).toEqual([{ recommendation: { type: "X" } }]);
  });

  it("honors a custom limit and userId", async () => {
    const c = customerWithRecs();
    (getCustomer as any).mockResolvedValue(c);
    await listRecommendations({ customerId: "1", limit: 7, userId: "u" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
    expect(c.query.mock.calls[0][0]).toContain("LIMIT 7");
  });
});

describe("applyRecommendation", () => {
  it("calls applyRecommendation with the operation", async () => {
    const c = customerWithRecs();
    (getCustomer as any).mockResolvedValue(c);
    const res = await applyRecommendation({ customerId: "1", recommendationResourceName: "rn/1" });
    expect(c.recommendations.applyRecommendation).toHaveBeenCalledWith({
      customer_id: "1",
      operations: [{ resource_name: "rn/1" }],
    });
    expect(res).toEqual({ applied: true });
  });

  it("rethrows on failure", async () => {
    const c = customerWithRecs({
      applyRecommendation: vi.fn(async () => {
        throw new Error("apply failed");
      }),
    });
    (getCustomer as any).mockResolvedValue(c);
    await expect(
      applyRecommendation({ customerId: "1", recommendationResourceName: "rn/1" })
    ).rejects.toThrow("apply failed");
  });
});

describe("dismissRecommendation", () => {
  it("calls dismissRecommendation with the operation", async () => {
    const c = customerWithRecs();
    (getCustomer as any).mockResolvedValue(c);
    const res = await dismissRecommendation({ customerId: "1", recommendationResourceName: "rn/2" });
    expect(c.recommendations.dismissRecommendation).toHaveBeenCalledWith({
      customer_id: "1",
      operations: [{ resource_name: "rn/2" }],
    });
    expect(res).toEqual({ dismissed: true });
  });

  it("rethrows on failure", async () => {
    const c = customerWithRecs({
      dismissRecommendation: vi.fn(async () => {
        throw new Error("dismiss failed");
      }),
    });
    (getCustomer as any).mockResolvedValue(c);
    await expect(
      dismissRecommendation({ customerId: "1", recommendationResourceName: "rn/2" })
    ).rejects.toThrow("dismiss failed");
  });
});
