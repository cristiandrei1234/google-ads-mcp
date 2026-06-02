import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- Hoisted mock state ----------------------------------------------------
const { GoogleAdsApiMock, customerFactory, mockConfig, getConnectionForCustomer, getIdentity } =
  vi.hoisted(() => {
    const customerFactory = vi.fn((opts: unknown) => ({ __customer: opts }));
    const GoogleAdsApiMock = vi.fn(function (this: any, args: unknown) {
      this.__args = args;
      this.Customer = customerFactory;
    });
    return {
      GoogleAdsApiMock,
      customerFactory,
      mockConfig: {
        GOOGLE_ADS_CLIENT_ID: "client-id-1234",
        GOOGLE_ADS_CLIENT_SECRET: "secret-5678",
        GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
        GOOGLE_ADS_REFRESH_TOKEN: undefined as string | undefined,
        GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined as string | undefined,
      },
      getConnectionForCustomer: vi.fn(),
      getIdentity: vi.fn(),
    };
  });

vi.mock("google-ads-api", () => ({ GoogleAdsApi: GoogleAdsApiMock }));
vi.mock("../../config/env.js", () => ({ default: mockConfig }));
vi.mock("../../observability/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../db.js", () => ({ getConnectionForCustomer }));
vi.mock("../../auth/identityContext.js", () => ({
  getIdentity,
  runWithIdentity: (_c: unknown, f: () => unknown) => f(),
}));

// resourceNames is the real (pure) module.

// Re-import fresh so the module-level `apiInstance` singleton is reset per test.
async function loadModule() {
  vi.resetModules();
  return import("./client.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.GOOGLE_ADS_CLIENT_ID = "client-id-1234";
  mockConfig.GOOGLE_ADS_CLIENT_SECRET = "secret-5678";
  mockConfig.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  mockConfig.GOOGLE_ADS_REFRESH_TOKEN = undefined;
  mockConfig.GOOGLE_ADS_LOGIN_CUSTOMER_ID = undefined;
  getConnectionForCustomer.mockReset();
  getIdentity.mockReset();
});

describe("getClient", () => {
  it("constructs the GoogleAdsApi with credentials and caches the instance", async () => {
    const { getClient } = await loadModule();
    const first = getClient();
    const second = getClient();
    expect(first).toBe(second);
    expect(GoogleAdsApiMock).toHaveBeenCalledTimes(1);
    expect(GoogleAdsApiMock).toHaveBeenCalledWith({
      client_id: "client-id-1234",
      client_secret: "secret-5678",
      developer_token: "dev-token",
    });
  });

  it("throws when client id is missing", async () => {
    mockConfig.GOOGLE_ADS_CLIENT_ID = "";
    const { getClient } = await loadModule();
    expect(() => getClient()).toThrow(/Missing Google Ads API credentials/);
  });

  it("throws when client secret is missing", async () => {
    mockConfig.GOOGLE_ADS_CLIENT_SECRET = "";
    const { getClient } = await loadModule();
    expect(() => getClient()).toThrow(/Missing Google Ads API credentials/);
  });

  it("throws when developer token is missing", async () => {
    mockConfig.GOOGLE_ADS_DEVELOPER_TOKEN = "";
    const { getClient } = await loadModule();
    expect(() => getClient()).toThrow(/Missing Google Ads API credentials/);
  });
});

describe("getCustomer - multi-tenant (identity present)", () => {
  it("resolves a grant and builds a Customer with the connection's MCC + token", async () => {
    getIdentity.mockReturnValue({ userId: "u1", orgId: "org1" });
    getConnectionForCustomer.mockResolvedValue({
      connectionId: "c1",
      accessLevel: "WRITE",
      refreshToken: "refresh-xyz",
      mccCustomerId: "9876543210",
    });
    const { getCustomer } = await loadModule();
    const result = await getCustomer("123-456-7890");
    expect(getConnectionForCustomer).toHaveBeenCalledWith("u1", "1234567890", "org1");
    expect(customerFactory).toHaveBeenCalledWith({
      customer_id: "1234567890",
      refresh_token: "refresh-xyz",
      login_customer_id: "9876543210",
    });
    expect(result).toEqual({
      __customer: {
        customer_id: "1234567890",
        refresh_token: "refresh-xyz",
        login_customer_id: "9876543210",
      },
    });
  });

  it("passes undefined orgId when identity has no orgId", async () => {
    getIdentity.mockReturnValue({ userId: "u2", orgId: null });
    getConnectionForCustomer.mockResolvedValue({
      connectionId: "c2",
      accessLevel: "READ",
      refreshToken: "tok",
      mccCustomerId: "111",
    });
    const { getCustomer } = await loadModule();
    await getCustomer("1234567890");
    expect(getConnectionForCustomer).toHaveBeenCalledWith("u2", "1234567890", null);
  });

  it("throws when the user has no grant for the customer", async () => {
    getIdentity.mockReturnValue({ userId: "u3", orgId: "org" });
    getConnectionForCustomer.mockResolvedValue(null);
    const { getCustomer } = await loadModule();
    await expect(getCustomer("1234567890")).rejects.toThrow(
      /User u3 has no grant for customer 1234567890/
    );
  });

  it("ignores the caller-supplied userId argument (uses identity)", async () => {
    getIdentity.mockReturnValue({ userId: "real-user", orgId: null });
    getConnectionForCustomer.mockResolvedValue({
      connectionId: "c",
      accessLevel: "WRITE",
      refreshToken: "t",
      mccCustomerId: "1",
    });
    const { getCustomer } = await loadModule();
    await getCustomer("1234567890", "attacker-user");
    expect(getConnectionForCustomer).toHaveBeenCalledWith("real-user", "1234567890", null);
  });
});

describe("getCustomer - single-operator fallback (no identity)", () => {
  it("builds a Customer from env refresh token + login customer id", async () => {
    getIdentity.mockReturnValue(undefined);
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = "env-refresh";
    mockConfig.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "555-666-7777";
    const { getCustomer } = await loadModule();
    await getCustomer("123-456-7890");
    expect(customerFactory).toHaveBeenCalledWith({
      customer_id: "1234567890",
      refresh_token: "env-refresh",
      login_customer_id: "5556667777",
    });
  });

  it("passes login_customer_id undefined when not configured", async () => {
    getIdentity.mockReturnValue(undefined);
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = "env-refresh";
    mockConfig.GOOGLE_ADS_LOGIN_CUSTOMER_ID = undefined;
    const { getCustomer } = await loadModule();
    await getCustomer("1234567890");
    expect(customerFactory).toHaveBeenCalledWith({
      customer_id: "1234567890",
      refresh_token: "env-refresh",
      login_customer_id: undefined,
    });
  });

  it("passes login_customer_id undefined when configured value normalizes to empty", async () => {
    getIdentity.mockReturnValue(undefined);
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = "env-refresh";
    // normalizeCustomerId("---") -> "" -> normalizeOptionalCustomerId returns undefined
    mockConfig.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "---";
    const { getCustomer } = await loadModule();
    await getCustomer("1234567890");
    expect(customerFactory.mock.calls[0][0].login_customer_id).toBeUndefined();
  });

  it("treats getIdentity()?.userId being undefined (identity object without userId) as fallback", async () => {
    getIdentity.mockReturnValue({ userId: undefined });
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = "env-refresh";
    const { getCustomer } = await loadModule();
    await getCustomer("1234567890");
    expect(getConnectionForCustomer).not.toHaveBeenCalled();
    expect(customerFactory).toHaveBeenCalled();
  });

  it("throws when no refresh token is configured", async () => {
    getIdentity.mockReturnValue(undefined);
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = undefined;
    const { getCustomer } = await loadModule();
    await expect(getCustomer("1234567890")).rejects.toThrow(
      /GOOGLE_ADS_REFRESH_TOKEN is missing/
    );
  });
});
