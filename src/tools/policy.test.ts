import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));

import { listPolicyFindings } from "./policy.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPolicyFindings", () => {
  it("queries ad_group_ad for non-approved findings with default limit", async () => {
    const c = fakeCustomer([{ p: 1 }]);
    (getCustomer as any).mockResolvedValue(c);
    const res = await listPolicyFindings({ customerId: "1", limit: 50 });
    expect(getCustomer).toHaveBeenCalledWith("1", undefined);
    const q = c.query.mock.calls[0][0];
    expect(q).toContain("FROM ad_group_ad");
    expect(q).toContain("approval_status != 'APPROVED'");
    expect(q).toContain("LIMIT 50");
    expect(res).toEqual([{ p: 1 }]);
  });

  it("honors a custom limit and userId", async () => {
    const c = fakeCustomer([]);
    (getCustomer as any).mockResolvedValue(c);
    await listPolicyFindings({ customerId: "1", limit: 3, userId: "u" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
    expect(c.query.mock.calls[0][0]).toContain("LIMIT 3");
  });
});
