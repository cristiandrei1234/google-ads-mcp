import { describe, it, expect, beforeEach, vi } from "vitest";

const { getClient, listConnectionsForUser, reachableCustomerIds, getIdentity } = vi.hoisted(() => ({
  getClient: vi.fn(),
  listConnectionsForUser: vi.fn(),
  reachableCustomerIds: vi.fn(),
  getIdentity: vi.fn(),
}));

vi.mock("../services/google-ads/client.js", () => ({ getClient }));
vi.mock("../services/db.js", () => ({ listConnectionsForUser, reachableCustomerIds }));
vi.mock("../auth/identityContext.js", () => ({ getIdentity }));
vi.mock("../config/env.js", () => ({ default: { GOOGLE_ADS_REFRESH_TOKEN: "" } }));

import { listAccounts } from "./listAccounts.js";
import config from "../config/env.js";

/**
 * Build a fake google-ads client. `customerData` maps a customer_id to its
 * manager flag and child ids. The discovery query routes by the customer_id
 * the Customer() factory was created with.
 */
function buildClient(opts: {
  resourceNames: string[];
  customerData?: Record<string, { manager?: boolean; children?: string[]; throwChild?: boolean }>;
}) {
  getClient.mockReturnValue({
    listAccessibleCustomers: vi.fn(async () => ({ resource_names: opts.resourceNames })),
    Customer: vi.fn(({ customer_id }: { customer_id: string }) => {
      const data = opts.customerData?.[customer_id] ?? {};
      return {
        query: vi.fn(async (q: string) => {
          if (q.includes("customer.manager")) {
            return [{ customer: { manager: data.manager ?? false } }];
          }
          // customer_client children query
          if (data.throwChild) throw new Error("child boom");
          return (data.children ?? []).map((id) => ({ customer_client: { id } }));
        }),
      };
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (config as any).GOOGLE_ADS_REFRESH_TOKEN = "";
});

describe("listAccounts - env mode", () => {
  it("throws when no refresh token is configured", async () => {
    getIdentity.mockReturnValue(undefined);
    (config as any).GOOGLE_ADS_REFRESH_TOKEN = "";
    await expect(listAccounts({})).rejects.toThrow(/GOOGLE_ADS_REFRESH_TOKEN is missing/);
  });

  it("discovers from env token, expanding a manager into children", async () => {
    getIdentity.mockReturnValue(undefined);
    (config as any).GOOGLE_ADS_REFRESH_TOKEN = "env-token";
    buildClient({
      resourceNames: ["customers/100"],
      customerData: { "100": { manager: true, children: ["200", "300"] } },
    });
    const res = await listAccounts({});
    expect(res).toEqual(["customers/100", "customers/200", "customers/300"]);
  });

  it("normalizes resource names with dashes and slashes", async () => {
    getIdentity.mockReturnValue(undefined);
    (config as any).GOOGLE_ADS_REFRESH_TOKEN = "env-token";
    buildClient({
      resourceNames: ["customers/12-34-56"],
      customerData: { "123456": { manager: false } },
    });
    const res = await listAccounts({});
    expect(res).toEqual(["customers/123456"]);
  });

  it("skips empty resource names", async () => {
    getIdentity.mockReturnValue(undefined);
    (config as any).GOOGLE_ADS_REFRESH_TOKEN = "env-token";
    // a resource name that normalizes to empty: "customers/" -> "" after split/replace
    buildClient({
      resourceNames: ["", "customers/100"],
      customerData: { "100": { manager: false } },
    });
    const res = await listAccounts({});
    expect(res).toEqual(["customers/100"]);
  });

  it("falls back to the raw value when split() yields an empty trailing segment", async () => {
    getIdentity.mockReturnValue(undefined);
    (config as any).GOOGLE_ADS_REFRESH_TOKEN = "env-token";
    // "customers/" -> split = ["customers",""], pop() === "" (falsy) -> `|| raw`
    // -> "customers/" -> replace(/-/g) -> "customers/" (non-empty)
    buildClient({
      resourceNames: ["customers/"],
      customerData: { "customers/": { manager: false } },
    });
    const res = await listAccounts({});
    expect(res).toEqual(["customers/customers/"]);
  });

  it("does not expand a non-manager account", async () => {
    getIdentity.mockReturnValue(undefined);
    (config as any).GOOGLE_ADS_REFRESH_TOKEN = "env-token";
    buildClient({
      resourceNames: ["customers/100"],
      customerData: { "100": { manager: false, children: ["999"] } },
    });
    const res = await listAccounts({});
    expect(res).toEqual(["customers/100"]);
  });

  it("ignores blank child ids", async () => {
    getIdentity.mockReturnValue(undefined);
    (config as any).GOOGLE_ADS_REFRESH_TOKEN = "env-token";
    buildClient({
      resourceNames: ["customers/100"],
      customerData: { "100": { manager: true, children: ["", "  ", "200"] } },
    });
    const res = await listAccounts({});
    expect(res).toEqual(["customers/100", "customers/200"]);
  });

  it("swallows a child-discovery error and keeps the manager", async () => {
    getIdentity.mockReturnValue(undefined);
    (config as any).GOOGLE_ADS_REFRESH_TOKEN = "env-token";
    buildClient({
      resourceNames: ["customers/100"],
      customerData: { "100": { manager: true, throwChild: true } },
    });
    const res = await listAccounts({});
    expect(res).toEqual(["customers/100"]);
  });

  it("handles a missing resource_names list", async () => {
    getIdentity.mockReturnValue(undefined);
    (config as any).GOOGLE_ADS_REFRESH_TOKEN = "env-token";
    getClient.mockReturnValue({
      listAccessibleCustomers: vi.fn(async () => ({})),
      Customer: vi.fn(),
    });
    const res = await listAccounts({});
    expect(res).toEqual([]);
  });
});

describe("listAccounts - userId mode", () => {
  it("returns grants only when there are no connections (no discovery)", async () => {
    getIdentity.mockReturnValue({ userId: "u-1", orgId: "o-1" });
    reachableCustomerIds.mockResolvedValue(["100", "200"]);
    listConnectionsForUser.mockResolvedValue([]);
    const res = await listAccounts({});
    expect(reachableCustomerIds).toHaveBeenCalledWith("u-1", "o-1");
    expect(res).toEqual(["customers/100", "customers/200"]);
  });

  it("narrows grants to the discovered intersection", async () => {
    getIdentity.mockReturnValue({ userId: "u-1", orgId: "o-1" });
    reachableCustomerIds.mockResolvedValue(["100", "200", "300"]);
    listConnectionsForUser.mockResolvedValue([{ connectionId: "c1", refreshToken: "rt1" }]);
    buildClient({
      resourceNames: ["customers/100", "customers/200"],
      customerData: { "100": { manager: false }, "200": { manager: false } },
    });
    const res = await listAccounts({});
    // 300 is granted but not discovered -> filtered out
    expect(res).toEqual(["customers/100", "customers/200"]);
  });

  it("falls back to grants when discovery for a connection throws", async () => {
    getIdentity.mockReturnValue({ userId: "u-1", orgId: undefined });
    reachableCustomerIds.mockResolvedValue(["100", "200"]);
    listConnectionsForUser.mockResolvedValue([{ connectionId: "c1", refreshToken: "rt1" }]);
    getClient.mockReturnValue({
      listAccessibleCustomers: vi.fn(async () => {
        throw new Error("discovery boom");
      }),
      Customer: vi.fn(),
    });
    const res = await listAccounts({});
    // discovered stays empty -> grants used as-is
    expect(res).toEqual(["customers/100", "customers/200"]);
  });

  it("returns empty when grants and discovery do not intersect", async () => {
    getIdentity.mockReturnValue({ userId: "u-1", orgId: "o-1" });
    reachableCustomerIds.mockResolvedValue(["999"]);
    listConnectionsForUser.mockResolvedValue([{ connectionId: "c1", refreshToken: "rt1" }]);
    buildClient({
      resourceNames: ["customers/100"],
      customerData: { "100": { manager: false } },
    });
    const res = await listAccounts({});
    expect(res).toEqual([]);
  });
});
