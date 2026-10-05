/** Real OAuth/PKCE + expiry/refresh regression, using local CI fixtures only. */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { getPrisma } from "../src/services/db.js";

const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3939";
const db = getPrisma();
const nonce = randomBytes(8).toString("hex");
const redirectUri = "http://localhost:19999/oauth-callback";
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "oauth-regression", version: "1" } } };
const userIds: string[] = [], orgIds: string[] = [], codes: string[] = [];
let clientId: string | undefined;

async function login(suffix: string) {
  const email = `oauth-${nonce}-${suffix}@example.test`;
  const password = randomBytes(20).toString("base64url");
  // Distinct RFC 5737 fixture IPs avoid sharing Better Auth signup buckets
  // with the other CI smoke suites. Never change production rate-limit policy.
  const headers = { "Content-Type": "application/json", Origin: base, "X-Forwarded-For": suffix === "owner" ? "192.0.2.201" : "192.0.2.202" };
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers, body: JSON.stringify({ email, password, name: "OAuth fixture" }) });
  assert(signup.ok, "fixture sign-up succeeds");
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  userIds.push(user.id);
  const signin = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  assert(signin.ok, "fixture sign-in succeeds");
  const token = signin.headers.get("set-auth-token");
  assert(token, "login bearer issued");
  return { user, token, email, password };
}
async function organization(userId: string) {
  const org = await db.organization.create({ data: { name: `OAuth ${nonce}` } });
  orgIds.push(org.id);
  await db.member.create({ data: { userId, organizationId: org.id, role: "admin" } });
  await db.session.updateMany({ where: { userId }, data: { activeOrganizationId: org.id } });
  return org;
}
async function authorize(token: string, scope?: string) {
  const params = new URLSearchParams({ client_id: clientId!, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: nonce });
  if (scope) params.set("scope", scope);
  const res = await fetch(`${base}/api/auth/mcp/authorize?${params}`, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" });
  assert.equal(res.status, 302, "authorization redirects");
  const url = new URL(res.headers.get("location")!);
  assert.equal(url.origin, new URL(redirectUri).origin);
  assert.equal(url.searchParams.get("state"), nonce);
  const code = url.searchParams.get("code");
  assert(code, "authorization code issued");
  codes.push(code);
  return code;
}
async function exchange(values: Record<string, string>) {
  return fetch(`${base}/api/auth/mcp/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId!, ...values }) });
}
async function mcp(token?: string, sessionId?: string, body = init) {
  return fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(sessionId ? { "mcp-session-id": sessionId } : {}) }, body: JSON.stringify(body) });
}
async function grant(token: string, scope?: string) {
  const code = await authorize(token, scope);
  const res = await exchange({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
  assert.equal(res.status, 200, "PKCE token exchange succeeds");
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

try {
  const unauth = await mcp();
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get("www-authenticate")!, /resource_metadata=/);
  const resource = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then(r => r.json());
  assert.equal(resource.resource, `${base}/mcp`);
  assert(resource.scopes_supported.includes("offline_access"));
  const discovery = await fetch(`${base}/.well-known/oauth-authorization-server/api/auth`).then(r => r.json());
  assert(discovery.grant_types_supported.includes("refresh_token"));
  console.log("✓ resource discovery + OAuth challenge");

  const registration = await fetch(`${base}/api/auth/mcp/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Local OAuth regression", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
  assert.equal(registration.status, 201);
  clientId = (await registration.json()).client_id;
  const owner = await login("owner");
  const orgA = await organization(owner.user.id);
  // Exercise browser login resumption too: the code is created in a sign-in
  // after-hook, not directly on /mcp/authorize.
  const browserParams = new URLSearchParams({ client_id: clientId!, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: nonce });
  const browserStart = await fetch(`${base}/api/auth/mcp/authorize?${browserParams}`, { redirect: "manual" });
  assert.equal(browserStart.status, 302);
  const cookie = browserStart.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const browserLogin = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie, "X-Forwarded-For": "192.0.2.201" }, body: JSON.stringify({ email: owner.email, password: owner.password }), redirect: "manual" });
  assert.equal(browserLogin.status, 302, "browser login resumes pending OAuth authorization");
  const browserCode = new URL(browserLogin.headers.get("location")!).searchParams.get("code")!;
  assert(browserCode);
  codes.push(browserCode);
  const browserExchange = await exchange({ grant_type: "authorization_code", code: browserCode, redirect_uri: redirectUri, code_verifier: verifier });
  assert.equal(browserExchange.status, 200, "resumed authorization code is bound and usable");
  const browserAccess = (await browserExchange.json()).access_token;
  assert.equal((await db.oauthAccessToken.findUniqueOrThrow({ where: { accessToken: browserAccess } })).organizationId, orgA.id);
  const badCode = await authorize(owner.token);
  const badPkce = await exchange({ grant_type: "authorization_code", code: badCode, redirect_uri: redirectUri, code_verifier: "wrong" });
  assert.equal(badPkce.status, 401, "wrong PKCE denied");
  const tokens = await grant(owner.token);
  assert(tokens.refresh_token, "default scope issues offline refresh token");
  assert.equal(tokens.expires_in, 3600);
  const row = await db.oauthAccessToken.findUniqueOrThrow({ where: { accessToken: tokens.access_token } });
  assert.equal(row.organizationId, orgA.id);
  assert(row.refreshTokenExpiresAt!.getTime() > Date.now() + 29 * 86400000);
  console.log("✓ OAuth/PKCE, pinned organization, one-hour access / thirty-day refresh");

  const initialized = await mcp(tokens.access_token);
  assert.equal(initialized.status, 200);
  const sessionId = initialized.headers.get("mcp-session-id")!;
  assert(sessionId);
  await db.oauthAccessToken.update({ where: { id: row.id }, data: { accessTokenExpiresAt: new Date(0) } });
  const expired = await mcp(tokens.access_token, sessionId);
  assert.equal(expired.status, 401);
  assert(expired.headers.get("www-authenticate"));
  for (const method of ["GET", "DELETE"]) {
    const res = await fetch(`${base}/mcp`, { method, headers: { Authorization: `Bearer ${tokens.access_token}`, "mcp-session-id": sessionId } });
    assert.equal(res.status, 401);
    assert(res.headers.get("www-authenticate"), `${method} advertises OAuth on expiry`);
  }
  const refreshed = await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  assert.equal(refreshed.status, 200, "refresh requires no browser login");
  const renewed = await refreshed.json();
  assert.notEqual(renewed.refresh_token, tokens.refresh_token);
  assert.equal((await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })).status, 401, "old refresh token cannot be replayed");
  const tools = await mcp(renewed.access_token, sessionId, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } as typeof init);
  assert.equal(tools.status, 200, "renewed access token resumes the same MCP transport");
  console.log("✓ expired access -> refresh -> tools/list without login; refresh replay denied");

  const renewedRow = await db.oauthAccessToken.findUniqueOrThrow({ where: { accessToken: renewed.access_token } });
  await db.oauthAccessToken.update({ where: { id: renewedRow.id }, data: { refreshTokenExpiresAt: new Date(0) } });
  assert.equal((await exchange({ grant_type: "refresh_token", refresh_token: renewed.refresh_token })).status, 401, "expired refresh cannot renew");
  await db.oauthAccessToken.update({ where: { id: renewedRow.id }, data: { refreshTokenExpiresAt: renewedRow.refreshTokenExpiresAt } });

  const orgB = await organization(owner.user.id);
  const tokenB = await grant(owner.token, "openid offline_access");
  assert.equal((await mcp(tokenB.access_token, sessionId)).status, 404, "same user cannot reuse another organization's transport");
  assert.equal((await db.oauthAccessToken.findUniqueOrThrow({ where: { accessToken: renewed.access_token } })).organizationId, orgA.id, "dashboard switch does not move existing authorization");
  const attacker = await login("other-org");
  await organization(attacker.user.id);
  const deniedRevoke = await fetch(`${base}/admin/revoke-sessions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${attacker.token}` }, body: JSON.stringify({ userId: owner.user.id }) });
  assert.equal(deniedRevoke.status, 404, "cross-tenant revocation denied");
  await db.user.update({ where: { id: owner.user.id }, data: { banned: true } });
  assert.equal((await mcp(tokenB.access_token)).status, 401, "banned user's OAuth token denied");
  await db.user.update({ where: { id: owner.user.id }, data: { banned: false } });
  await db.member.deleteMany({ where: { userId: owner.user.id, organizationId: orgA.id } });
  assert.equal((await exchange({ grant_type: "refresh_token", refresh_token: renewed.refresh_token })).status, 401, "removed membership cannot refresh");
  const revoked = await fetch(`${base}/admin/revoke-sessions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ userId: owner.user.id }) });
  assert.equal(revoked.status, 200);
  assert.equal((await mcp(tokenB.access_token)).status, 401);
  assert.equal((await exchange({ grant_type: "refresh_token", refresh_token: tokenB.refresh_token! })).status, 401);
  assert.equal(await db.oauthAccessToken.count({ where: { userId: owner.user.id } }), 0);
  console.log("✓ organization isolation, bans, removed membership and full OAuth revocation");
  void orgB;
  console.log("ALL OAUTH REFRESH SMOKE CHECKS PASSED");
} finally {
  await db.oauthAccessToken.deleteMany({ where: { userId: { in: userIds } } });
  if (clientId) await db.oauthApplication.deleteMany({ where: { clientId } });
  await db.verification.deleteMany({ where: { identifier: { in: codes } } });
  await db.member.deleteMany({ where: { userId: { in: userIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
}
