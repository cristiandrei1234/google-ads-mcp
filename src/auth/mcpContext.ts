import { auth } from "./betterAuth.js";
import { getPrisma } from "../services/db.js";
import { validateBinding } from "./mcpPolicy.js";
import type { AuthContext } from "./identityContext.js";

export async function resolveMcpContext(headers: Headers, requestId?: string): Promise<AuthContext | null> {
  const oauth = await auth.api.getMcpSession({ headers });
  if (oauth) {
    const token = await getPrisma().oauthAccessToken.findUnique({ where: { accessToken: oauth.accessToken } });
    if (!token?.userId || !token.organizationId || !await validateBinding({
      userId: token.userId, organizationId: token.organizationId, authVersion: token.authVersion,
    })) return null;
    const member = await getPrisma().member.findFirst({ where: { userId: token.userId, organizationId: token.organizationId } });
    if (!member) return null;
    return { userId: token.userId, orgId: token.organizationId, memberId: member.id, role: member.role, requestId };
  }
  // Keep existing dashboard cookies and login-issued bearer tokens working.
  // A supplied bearer credential must not fall back to an unrelated cookie.
  const sessionHeaders = new Headers(headers);
  if (sessionHeaders.has("authorization")) sessionHeaders.delete("cookie");
  const login = await auth.api.getSession({ headers: sessionHeaders });
  if (!login) return null;
  const orgId = login.session.activeOrganizationId ?? null;
  const member = orgId ? await getPrisma().member.findFirst({ where: { userId: login.user.id, organizationId: orgId } }) : null;
  return { userId: login.user.id, orgId, memberId: member?.id ?? null, role: member?.role ?? null, requestId };
}

export function mcpResourceMetadata(baseURL: string) {
  return {
    resource: new URL("/mcp", baseURL).href,
    authorization_servers: [new URL("/api/auth", baseURL).href],
    scopes_supported: ["openid", "offline_access"],
    bearer_methods_supported: ["header"],
  };
}

export function mcpAuthChallenge(baseURL: string): string {
  return `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", baseURL).href}", scope="openid offline_access"`;
}
