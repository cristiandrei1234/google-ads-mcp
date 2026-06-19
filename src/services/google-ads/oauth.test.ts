import { describe, it, expect, beforeEach, vi } from "vitest";

const { OAuth2ClientMock, generateAuthUrl, getToken, listAccessibleCustomers, customerFactory } = vi.hoisted(
  () => {
    const generateAuthUrl = vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?scope=adwords");
    const getToken = vi.fn();
    const OAuth2ClientMock = vi.fn(function (this: any) {
      this.generateAuthUrl = generateAuthUrl;
      this.getToken = getToken;
    });
    const listAccessibleCustomers = vi.fn();
    const customerFactory = vi.fn();
    return { OAuth2ClientMock, generateAuthUrl, getToken, listAccessibleCustomers, customerFactory };
  }
);

vi.mock("google-auth-library", () => ({ OAuth2Client: OAuth2ClientMock }));
vi.mock("./client.js", () => ({ getClient: () => ({ listAccessibleCustomers, Customer: customerFactory }) }));
vi.mock("../../config/env.js", () => ({
  default: { GOOGLE_ADS_CLIENT_ID: "cid", GOOGLE_ADS_CLIENT_SECRET: "secret" },
}));

import {
  getConsentUrl,
  exchangeCodeForRefreshToken,
  detectLoginCustomerId,
  listClientAccounts,
} from "./oauth.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getConsentUrl", () => {
  it("requests offline access, the adwords scope, forced consent, and passes state", () => {
    const url = getConsentUrl("https://app/cb", "state-123");
    expect(url).toContain("adwords");
    expect(generateAuthUrl).toHaveBeenCalledWith({
      access_type: "offline",
      scope: "https://www.googleapis.com/auth/adwords",
      prompt: "consent",
      state: "state-123",
    });
  });
});

describe("exchangeCodeForRefreshToken", () => {
  it("returns the refresh token", async () => {
    getToken.mockResolvedValue({ tokens: { refresh_token: "rt-abc" } });
    await expect(exchangeCodeForRefreshToken("https://app/cb", "code")).resolves.toBe("rt-abc");
  });

  it("throws when Google returns no refresh token", async () => {
    getToken.mockResolvedValue({ tokens: { access_token: "at" } });
    await expect(exchangeCodeForRefreshToken("https://app/cb", "code")).rejects.toThrow(/did not return a refresh token/);
  });
});

describe("detectLoginCustomerId", () => {
  it("throws when there are no accessible accounts", async () => {
    listAccessibleCustomers.mockResolvedValue({ resource_names: [] });
    await expect(detectLoginCustomerId("rt")).rejects.toThrow(/no accessible Google Ads/);
  });

  it("prefers a manager (MCC) account", async () => {
    listAccessibleCustomers.mockResolvedValue({ resource_names: ["customers/111", "customers/222"] });
    customerFactory
      .mockReturnValueOnce({ query: vi.fn(async () => [{ customer: { manager: false } }]) })
      .mockReturnValueOnce({ query: vi.fn(async () => [{ customer: { manager: true } }]) });
    const result = await detectLoginCustomerId("rt");
    expect(result).toEqual({ mccCustomerId: "222", accessible: ["111", "222"] });
  });

  it("falls back to the first account when none is a manager (and skips query errors)", async () => {
    listAccessibleCustomers.mockResolvedValue({ resource_names: ["customers/111", "customers/222"] });
    customerFactory
      .mockReturnValueOnce({ query: vi.fn(async () => { throw new Error("no access"); }) })
      .mockReturnValueOnce({ query: vi.fn(async () => [{ customer: { manager: false } }]) });
    const result = await detectLoginCustomerId("rt");
    expect(result).toEqual({ mccCustomerId: "111", accessible: ["111", "222"] });
  });

  it("tolerates a missing resource_names array", async () => {
    listAccessibleCustomers.mockResolvedValue({});
    await expect(detectLoginCustomerId("rt")).rejects.toThrow(/no accessible Google Ads/);
  });
});

describe("listClientAccounts", () => {
  it("returns the MCC plus its client accounts, deduped and sorted", async () => {
    const query = vi.fn(async () => [
      { customer_client: { id: "333" } },
      { customer_client: { id: "222" } },
      { customer_client: {} }, // ignored (no id)
    ]);
    customerFactory.mockReturnValue({ query });
    const ids = await listClientAccounts("rt", "111");
    expect(ids).toEqual(["111", "222", "333"]);
    expect(customerFactory).toHaveBeenCalledWith({ customer_id: "111", refresh_token: "rt", login_customer_id: "111" });
  });

  it("tolerates a null query result", async () => {
    customerFactory.mockReturnValue({ query: vi.fn(async () => null) });
    expect(await listClientAccounts("rt", "111")).toEqual(["111"]);
  });
});
