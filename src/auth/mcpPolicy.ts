import { APIError, createAuthMiddleware } from "better-auth/api";
import { getPrisma } from "../services/db.js";

export const MCP_OIDC_CONFIG = {
  defaultScope: "openid offline_access",
  accessTokenExpiresIn: 60 * 60,
  refreshTokenExpiresIn: 30 * 24 * 60 * 60,
  requirePKCE: true,
};

interface Binding {
  userId: string;
  organizationId: string;
  authVersion: number;
  parentId?: string;
}

function invalidGrant(): never {
  throw new APIError("UNAUTHORIZED", { error: "invalid_grant", error_description: "Authorization expired or was revoked; reconnect the MCP client." });
}

export async function validateBinding(binding: Binding): Promise<boolean> {
  const db = getPrisma();
  const user = await db.user.findUnique({ where: { id: binding.userId } });
  if (!user || user.mcpAuthVersion !== binding.authVersion ||
      (user.banned && (!user.banExpires || user.banExpires > new Date()))) return false;
  return Boolean(await db.member.findFirst({ where: { userId: binding.userId, organizationId: binding.organizationId } }));
}

/** Pin the consenting organization to the code, rather than a mutable login session. */
export async function bindAuthorization(value: string, session: { user: { id: string }; session: { activeOrganizationId?: string | null } }): Promise<string> {
  if (JSON.parse(value).userId !== session.user.id) invalidGrant();
  const db = getPrisma();
  const memberships = await db.member.findMany({ where: { userId: session.user.id }, select: { organizationId: true } });
  const organizationId = session.session.activeOrganizationId ?? (memberships.length === 1 ? memberships[0].organizationId : null);
  if (!organizationId || !memberships.some(m => m.organizationId === organizationId)) {
    throw new APIError("FORBIDDEN", { message: "Select an organization in the dashboard before connecting MCP." });
  }
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } });
  const binding: Binding = { userId: user.id, organizationId, authVersion: user.mcpAuthVersion };
  if (!await validateBinding(binding)) invalidGrant();
  return JSON.stringify({ ...JSON.parse(value), mcpBinding: binding });
}

export const mcpTokenHooks = {
  before: createAuthMiddleware(async ctx => {
    if (ctx.path !== "/mcp/token") return;
    const db = getPrisma();
    let binding: Binding | undefined;
    if (ctx.body?.grant_type === "refresh_token") {
      const parent = await db.oauthAccessToken.findUnique({ where: { refreshToken: String(ctx.body.refresh_token ?? "") } });
      if (parent?.userId && parent.organizationId) binding = {
        userId: parent.userId, organizationId: parent.organizationId, authVersion: parent.authVersion, parentId: parent.id,
      };
    } else if (ctx.body?.grant_type === "authorization_code") {
      const code = await db.verification.findFirst({ where: { identifier: String(ctx.body.code ?? "") } });
      if (code) binding = JSON.parse(code.value).mcpBinding;
    }
    if (!binding || !await validateBinding(binding)) invalidGrant();
    return { context: { context: { mcpBinding: binding } } };
  }),
  after: createAuthMiddleware(async ctx => {
    if (ctx.path !== "/mcp/token") return;
    const result = ctx.context.returned as { access_token?: string } | undefined;
    if (!result?.access_token) return;
    const binding = (ctx.context as typeof ctx.context & { mcpBinding?: Binding }).mcpBinding;
    const db = getPrisma();
    try {
      if (!binding || !await validateBinding(binding)) invalidGrant();
      await db.$transaction(async tx => {
        if (binding.parentId) {
          // Consume the previous refresh token once, including concurrent retries.
          const claimed = await tx.oauthAccessToken.updateMany({
            where: { id: binding.parentId, refreshToken: String(ctx.body.refresh_token), authVersion: binding.authVersion },
            data: { refreshToken: null, refreshTokenExpiresAt: new Date(0) },
          });
          if (claimed.count !== 1) invalidGrant();
        }
        const updated = await tx.oauthAccessToken.updateMany({
          where: { accessToken: result.access_token, userId: binding.userId },
          data: { organizationId: binding.organizationId, authVersion: binding.authVersion },
        });
        if (updated.count !== 1) invalidGrant();
      });
    } catch (error) {
      await db.oauthAccessToken.deleteMany({ where: { accessToken: result.access_token } });
      throw error;
    }
  }),
};
