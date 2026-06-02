import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn() }));

import { startIdentityVerification, getIdentityVerification } from "./identityVerification.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";

function customerWithIdentity(impl: Record<string, any> = {}) {
  const c: any = fakeCustomer([]);
  c.identityVerifications = {
    startIdentityVerification: vi.fn(async () => ({ started: true })),
    getIdentityVerification: vi.fn(async () => ({ status: "OK" })),
    ...impl,
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startIdentityVerification", () => {
  it("starts verification with the advertiser program", async () => {
    const c = customerWithIdentity();
    (getCustomer as any).mockResolvedValue(c);
    const res = await startIdentityVerification({ customerId: "1" });
    expect(getCustomer).toHaveBeenCalledWith("1", undefined);
    expect(c.identityVerifications.startIdentityVerification).toHaveBeenCalledWith({
      customer_id: "1",
      verification_program: "ADVERTISER_IDENTITY_VERIFICATION",
    });
    expect(res).toEqual({ started: true });
  });

  it("rethrows on failure", async () => {
    const c = customerWithIdentity({
      startIdentityVerification: vi.fn(async () => {
        throw new Error("start boom");
      }),
    });
    (getCustomer as any).mockResolvedValue(c);
    await expect(startIdentityVerification({ customerId: "1", userId: "u" })).rejects.toThrow("start boom");
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
  });
});

describe("getIdentityVerification", () => {
  it("fetches verification status", async () => {
    const c = customerWithIdentity();
    (getCustomer as any).mockResolvedValue(c);
    const res = await getIdentityVerification({ customerId: "1" });
    expect(c.identityVerifications.getIdentityVerification).toHaveBeenCalledWith({ customer_id: "1" });
    expect(res).toEqual({ status: "OK" });
  });

  it("rethrows on failure", async () => {
    const c = customerWithIdentity({
      getIdentityVerification: vi.fn(async () => {
        throw new Error("get boom");
      }),
    });
    (getCustomer as any).mockResolvedValue(c);
    await expect(getIdentityVerification({ customerId: "1" })).rejects.toThrow("get boom");
  });
});
