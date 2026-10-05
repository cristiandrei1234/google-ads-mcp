import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: {
  user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  member: { findFirst: vi.fn(), findMany: vi.fn() },
  verification: { findFirst: vi.fn() },
  oauthAccessToken: { findUnique: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
} }));
vi.mock("../services/db.js", () => ({ getPrisma: () => db }));
vi.mock("better-auth/api", async () => ({ ...await vi.importActual("better-auth/api"), createAuthMiddleware: (fn: unknown) => fn }));
import { bindAuthorization, validateBinding, mcpTokenHooks, MCP_OIDC_CONFIG } from "./mcpPolicy.js";
const binding = { userId: "user", organizationId: "org", authVersion: 2 };
const user = { id: "user", mcpAuthVersion: 2, banned: false, banExpires: null };
const before = mcpTokenHooks.before as unknown as (ctx: any) => Promise<any>;
const after = mcpTokenHooks.after as unknown as (ctx: any) => Promise<any>;
beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue(user);
  db.user.findUniqueOrThrow.mockResolvedValue(user);
  db.member.findFirst.mockResolvedValue({ id: "member" });
  db.member.findMany.mockResolvedValue([{ organizationId: "org" }]);
  db.oauthAccessToken.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation((fn: any) => fn(db));
});
describe("MCP organization binding", () => {
  it("uses short access and offline refresh with PKCE", () => {
    expect(MCP_OIDC_CONFIG).toEqual({ defaultScope: "openid offline_access", accessTokenExpiresIn: 3600, refreshTokenExpiresIn: 2592000, requirePKCE: true });
  });
  it("pins the selected or sole organization and revocation version", async () => {
    for (const session of [{ activeOrganizationId: "org" }, {}]) {
      const value = await bindAuthorization(JSON.stringify({ userId: "user" }), { user: { id: "user" }, session });
      expect(JSON.parse(value).mcpBinding).toEqual(binding);
    }
  });
  it("requires a valid selection when membership is ambiguous or absent", async () => {
    db.member.findMany.mockResolvedValue([{ organizationId: "org" }, { organizationId: "other" }]);
    await expect(bindAuthorization('{"userId":"user"}', { user: { id: "user" }, session: {} })).rejects.toThrow("Select an organization");
    await expect(bindAuthorization('{"userId":"user"}', { user: { id: "user" }, session: { activeOrganizationId: "foreign" } })).rejects.toThrow("Select an organization");
  });
  it("denies a mismatched code identity and revoked user", async () => {
    await expect(bindAuthorization('{"userId":"other"}', { user: { id: "user" }, session: {} })).rejects.toThrow();
    db.user.findUnique.mockResolvedValue(null);
    await expect(bindAuthorization('{"userId":"user"}', { user: { id: "user" }, session: {} })).rejects.toThrow();
  });
  it("checks live membership, version, and permanent/temporary bans", async () => {
    expect(await validateBinding(binding)).toBe(true);
    for (const record of [null, { ...user, mcpAuthVersion: 3 }, { ...user, banned: true }, { ...user, banned: true, banExpires: new Date(Date.now() + 60000) }]) {
      db.user.findUnique.mockResolvedValue(record);
      expect(await validateBinding(binding)).toBe(false);
    }
    db.user.findUnique.mockResolvedValue({ ...user, banned: true, banExpires: new Date(0) });
    expect(await validateBinding(binding)).toBe(true);
    db.member.findFirst.mockResolvedValue(null);
    expect(await validateBinding(binding)).toBe(false);
  });
});
describe("MCP issuance and rotation hooks", () => {
  it("ignores unrelated routes and unsuccessful token responses", async () => {
    expect(await before({ path: "/sign-in/email" })).toBeUndefined();
    expect(await after({ path: "/sign-in/email" })).toBeUndefined();
    for (const returned of [undefined, {}, { error: "invalid_grant" }]) expect(await after({ path: "/mcp/token", context: { returned } })).toBeUndefined();
    expect(db.oauthAccessToken.updateMany).not.toHaveBeenCalled();
  });
  it("rejects unknown/missing grants, missing code/token and unbound legacy tokens", async () => {
    for (const body of [undefined, {}, { grant_type: "authorization_code" }, { grant_type: "refresh_token" }]) {
      await expect(before({ path: "/mcp/token", body })).rejects.toThrow();
    }
    db.oauthAccessToken.findUnique.mockResolvedValue({ userId: null });
    await expect(before({ path: "/mcp/token", body: { grant_type: "refresh_token", refresh_token: "old" } })).rejects.toThrow();
    db.oauthAccessToken.findUnique.mockResolvedValue({ userId: "user", organizationId: null });
    await expect(before({ path: "/mcp/token", body: { grant_type: "refresh_token", refresh_token: "old" } })).rejects.toThrow();
    db.verification.findFirst.mockResolvedValue({ value: "{}" });
    await expect(before({ path: "/mcp/token", body: { grant_type: "authorization_code", code: "code" } })).rejects.toThrow();
  });
  it("passes a code's binding to the token endpoint", async () => {
    db.verification.findFirst.mockResolvedValue({ value: JSON.stringify({ mcpBinding: binding }) });
    expect(await before({ path: "/mcp/token", body: { grant_type: "authorization_code", code: "code" } })).toEqual({ context: { context: { mcpBinding: binding } } });
    await after({ path: "/mcp/token", context: { returned: { access_token: "new" }, mcpBinding: binding } });
    expect(db.oauthAccessToken.updateMany).toHaveBeenCalledWith({ where: { accessToken: "new", userId: "user" }, data: { organizationId: "org", authVersion: 2 } });
  });
  it("consumes refresh once and binds the replacement to the same org/version", async () => {
    db.oauthAccessToken.findUnique.mockResolvedValue({ id: "parent", ...binding });
    const ctx = await before({ path: "/mcp/token", body: { grant_type: "refresh_token", refresh_token: "old" } });
    await after({ path: "/mcp/token", body: { refresh_token: "old" }, context: { returned: { access_token: "new" }, ...ctx.context.context } });
    expect(db.oauthAccessToken.updateMany).toHaveBeenCalledWith({ where: { id: "parent", refreshToken: "old", authVersion: 2 }, data: { refreshToken: null, refreshTokenExpiresAt: new Date(0) } });
    expect(db.oauthAccessToken.updateMany).toHaveBeenCalledTimes(2);
  });
  it("denies revoked refresh and deletes newly minted tokens on races or failed binding", async () => {
    db.oauthAccessToken.findUnique.mockResolvedValue({ id: "parent", ...binding });
    db.user.findUnique.mockResolvedValue({ ...user, mcpAuthVersion: 3 });
    await expect(before({ path: "/mcp/token", body: { grant_type: "refresh_token", refresh_token: "old" } })).rejects.toThrow();
    await expect(after({ path: "/mcp/token", context: { returned: { access_token: "new" }, mcpBinding: binding } })).rejects.toThrow();
    db.user.findUnique.mockResolvedValue(user);
    await expect(after({ path: "/mcp/token", context: { returned: { access_token: "new" } } })).rejects.toThrow();
    db.oauthAccessToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(after({ path: "/mcp/token", body: { refresh_token: "old" }, context: { returned: { access_token: "new" }, mcpBinding: { ...binding, parentId: "parent" } } })).rejects.toThrow();
    await expect(after({ path: "/mcp/token", context: { returned: { access_token: "new" }, mcpBinding: binding } })).rejects.toThrow();
    expect(db.oauthAccessToken.deleteMany).toHaveBeenCalledTimes(4);
  });
});
