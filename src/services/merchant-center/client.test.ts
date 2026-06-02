import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- Hoisted mock state ----------------------------------------------------
const { OAuth2Mock, setCredentialsSpy, contentMock, mockConfig, getConnectionForCustomer, getIdentity } =
  vi.hoisted(() => {
    const setCredentialsSpy = vi.fn();
    const OAuth2Mock = vi.fn(function (this: any, clientId: unknown, clientSecret: unknown) {
      this.__clientId = clientId;
      this.__clientSecret = clientSecret;
      this.setCredentials = setCredentialsSpy;
    });
    const contentMock = vi.fn((opts: unknown) => ({ __content: opts }));
    return {
      OAuth2Mock,
      setCredentialsSpy,
      contentMock,
      mockConfig: {
        GOOGLE_ADS_CLIENT_ID: "client-id-1234",
        GOOGLE_ADS_CLIENT_SECRET: "secret-5678",
        GOOGLE_ADS_REFRESH_TOKEN: undefined as string | undefined,
      },
      getConnectionForCustomer: vi.fn(),
      getIdentity: vi.fn(),
    };
  });

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: OAuth2Mock },
    content: contentMock,
  },
}));
vi.mock("../../config/env.js", () => ({ default: mockConfig }));
vi.mock("../../observability/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../db.js", () => ({ getConnectionForCustomer }));
vi.mock("../../auth/identityContext.js", () => ({
  getIdentity,
  runWithIdentity: (_c: unknown, f: () => unknown) => f(),
}));

// Re-import fresh so the module-level `authClientCache` Map is reset per test.
async function loadModule() {
  vi.resetModules();
  return import("./client.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.GOOGLE_ADS_CLIENT_ID = "client-id-1234";
  mockConfig.GOOGLE_ADS_CLIENT_SECRET = "secret-5678";
  mockConfig.GOOGLE_ADS_REFRESH_TOKEN = undefined;
  getConnectionForCustomer.mockReset();
  getIdentity.mockReset();
});

describe("getMerchantAuth - single-operator fallback (no identity)", () => {
  it("builds an OAuth2 client from env credentials and caches it under 'env'", async () => {
    getIdentity.mockReturnValue(undefined);
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = "env-refresh";
    const { getMerchantAuth } = await loadModule();

    const auth = await getMerchantAuth();

    expect(OAuth2Mock).toHaveBeenCalledTimes(1);
    expect(OAuth2Mock).toHaveBeenCalledWith("client-id-1234", "secret-5678");
    expect(setCredentialsSpy).toHaveBeenCalledWith({ refresh_token: "env-refresh" });
    expect((auth as any).__clientId).toBe("client-id-1234");
  });

  it("returns the cached auth client on a second call (cache hit)", async () => {
    getIdentity.mockReturnValue(undefined);
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = "env-refresh";
    const { getMerchantAuth } = await loadModule();

    const first = await getMerchantAuth();
    const second = await getMerchantAuth();

    expect(first).toBe(second);
    expect(OAuth2Mock).toHaveBeenCalledTimes(1);
  });

  it("treats an identity object without userId as fallback (uses env)", async () => {
    getIdentity.mockReturnValue({ userId: undefined });
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = "env-refresh";
    const { getMerchantAuth } = await loadModule();

    await getMerchantAuth();

    expect(getConnectionForCustomer).not.toHaveBeenCalled();
    expect(setCredentialsSpy).toHaveBeenCalledWith({ refresh_token: "env-refresh" });
  });

  it("throws when no env refresh token is configured", async () => {
    getIdentity.mockReturnValue(undefined);
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = undefined;
    const { getMerchantAuth } = await loadModule();

    await expect(getMerchantAuth()).rejects.toThrow(/GOOGLE_ADS_REFRESH_TOKEN is missing/);
    expect(OAuth2Mock).not.toHaveBeenCalled();
  });
});

describe("getMerchantAuth - multi-tenant (identity present)", () => {
  it("throws when a customerId is not supplied", async () => {
    getIdentity.mockReturnValue({ userId: "u1", orgId: "org1" });
    const { getMerchantAuth } = await loadModule();

    await expect(getMerchantAuth()).rejects.toThrow(
      /A customerId you hold a grant for is required/
    );
    expect(getConnectionForCustomer).not.toHaveBeenCalled();
  });

  it("resolves the grant connection token and caches under the connection id", async () => {
    getIdentity.mockReturnValue({ userId: "u1", orgId: "org1" });
    getConnectionForCustomer.mockResolvedValue({
      connectionId: "conn-9",
      refreshToken: "grant-refresh",
      mccCustomerId: "111",
      accessLevel: "WRITE",
    });
    const { getMerchantAuth } = await loadModule();

    const auth = await getMerchantAuth("1234567890");

    expect(getConnectionForCustomer).toHaveBeenCalledWith("u1", "1234567890", "org1");
    expect(setCredentialsSpy).toHaveBeenCalledWith({ refresh_token: "grant-refresh" });
    expect((auth as any).__clientId).toBe("client-id-1234");
  });

  it("passes a null orgId through to getConnectionForCustomer", async () => {
    getIdentity.mockReturnValue({ userId: "u2", orgId: null });
    getConnectionForCustomer.mockResolvedValue({
      connectionId: "conn-2",
      refreshToken: "tok",
      mccCustomerId: "1",
      accessLevel: "READ",
    });
    const { getMerchantAuth } = await loadModule();

    await getMerchantAuth("1234567890");

    expect(getConnectionForCustomer).toHaveBeenCalledWith("u2", "1234567890", null);
  });

  it("throws when the user holds no grant for the customer", async () => {
    getIdentity.mockReturnValue({ userId: "u3", orgId: "org" });
    getConnectionForCustomer.mockResolvedValue(null);
    const { getMerchantAuth } = await loadModule();

    await expect(getMerchantAuth("1234567890")).rejects.toThrow(
      /No grant for customer 1234567890; Merchant Center access denied/
    );
    expect(OAuth2Mock).not.toHaveBeenCalled();
  });
});

describe("getContentService", () => {
  it("builds the Content API v2.1 client with the resolved auth", async () => {
    getIdentity.mockReturnValue(undefined);
    mockConfig.GOOGLE_ADS_REFRESH_TOKEN = "env-refresh";
    const { getContentService } = await loadModule();

    const service = await getContentService();

    expect(contentMock).toHaveBeenCalledTimes(1);
    const callArg = contentMock.mock.calls[0][0] as any;
    expect(callArg.version).toBe("v2.1");
    expect(callArg.auth.__clientId).toBe("client-id-1234");
    expect((service as any).__content).toBeDefined();
  });

  it("propagates a customerId through to grant resolution", async () => {
    getIdentity.mockReturnValue({ userId: "u1", orgId: "org1" });
    getConnectionForCustomer.mockResolvedValue({
      connectionId: "conn-9",
      refreshToken: "grant-refresh",
      mccCustomerId: "111",
      accessLevel: "WRITE",
    });
    const { getContentService } = await loadModule();

    await getContentService("1234567890");

    expect(getConnectionForCustomer).toHaveBeenCalledWith("u1", "1234567890", "org1");
    expect(contentMock).toHaveBeenCalledTimes(1);
  });
});
