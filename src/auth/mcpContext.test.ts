import { beforeEach, describe, expect, it, vi } from "vitest";
const { getMcpSession, getSession, validateBinding, db } = vi.hoisted(() => ({
  getMcpSession: vi.fn(), getSession: vi.fn(), validateBinding: vi.fn(),
  db: { oauthAccessToken: { findUnique: vi.fn() }, member: { findFirst: vi.fn() } },
}));
vi.mock("./betterAuth.js", () => ({ auth: { api: { getMcpSession, getSession } } }));
vi.mock("./mcpPolicy.js", () => ({ validateBinding }));
vi.mock("../services/db.js", () => ({ getPrisma: () => db }));
import { resolveMcpContext, mcpResourceMetadata, mcpAuthChallenge } from "./mcpContext.js";
beforeEach(() => vi.resetAllMocks());
describe("MCP identities", () => {
  it("uses the OAuth token's organization, live member and request identity", async () => {
    getMcpSession.mockResolvedValue({ accessToken: "oauth" });
    db.oauthAccessToken.findUnique.mockResolvedValue({ userId: "user", organizationId: "org", authVersion: 4 });
    validateBinding.mockResolvedValue(true);
    db.member.findFirst.mockResolvedValue({ id: "member", role: "admin" });
    expect(await resolveMcpContext(new Headers(), "request")).toEqual({ userId: "user", orgId: "org", memberId: "member", role: "admin", requestId: "request" });
    expect(getSession).not.toHaveBeenCalled();
  });
  it("fails closed on missing, unbound, revoked or removed OAuth membership", async () => {
    getMcpSession.mockResolvedValue({ accessToken: "oauth" });
    for (const token of [null, { userId: null }, { userId: "user" }, { userId: "user", organizationId: "org", authVersion: 0 }]) {
      db.oauthAccessToken.findUnique.mockResolvedValue(token);
      expect(await resolveMcpContext(new Headers())).toBeNull();
    }
    validateBinding.mockResolvedValue(true);
    expect(await resolveMcpContext(new Headers())).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });
  it("preserves cookies and login bearer authentication", async () => {
    expect(await resolveMcpContext(new Headers())).toBeNull();
    getSession.mockResolvedValue({ user: { id: "user" }, session: {} });
    const headers = new Headers({ cookie: "session=fixture" });
    expect(await resolveMcpContext(headers)).toEqual({ userId: "user", orgId: null, memberId: null, role: null });
    expect(getSession.mock.lastCall![0].headers.get("cookie")).toBe("session=fixture");
    getSession.mockResolvedValue({ user: { id: "user" }, session: { activeOrganizationId: "org" } });
    expect((await resolveMcpContext(headers))!.role).toBeNull();
    db.member.findFirst.mockResolvedValue({ id: "member", role: "viewer" });
    headers.set("authorization", "Bearer login");
    expect(await resolveMcpContext(headers)).toEqual({ userId: "user", orgId: "org", memberId: "member", role: "viewer" });
    expect(getSession.mock.lastCall![0].headers.has("cookie")).toBe(false);
    expect(headers.has("cookie")).toBe(true);
  });
  it("advertises canonical discovery and offline refresh in the challenge", () => {
    expect(mcpResourceMetadata("https://ads.example/subpath")).toEqual({ resource: "https://ads.example/mcp", authorization_servers: ["https://ads.example/api/auth"], scopes_supported: ["openid", "offline_access"], bearer_methods_supported: ["header"] });
    expect(mcpAuthChallenge("https://ads.example")).toBe('Bearer resource_metadata="https://ads.example/.well-known/oauth-protected-resource/mcp", scope="openid offline_access"');
  });
});
