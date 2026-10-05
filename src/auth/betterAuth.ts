import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization, admin, bearer, mcp } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { getPrisma } from "../services/db.js";
import config from "../config/env.js";
import logger from "../observability/logger.js";
import { sendActionEmail, isEmailConfigured } from "../services/email.js";
import { bindAuthorization, mcpTokenHooks, MCP_OIDC_CONFIG } from "./mcpPolicy.js";

/**
 * Canonical Better Auth instance — the single source of truth for employee
 * identity (Faza 6). Serves both a web app and remote MCP connectors:
 *
 * - `organization` plugin: agency = organization, employee = member + role.
 * - `admin` plugin: agency admins manage members/bans.
 * - `bearer` plugin: token auth for API/MCP clients (Authorization: Bearer).
 * - `mcp` plugin: OAuth/OIDC discovery so Claude-style connectors can authorize.
 *
 * Login methods (per product decision): email+password AND Google social SSO.
 *
 * Secrets come from env. The Google social provider reuses the project's
 * Google OAuth client; its callback `${BETTER_AUTH_URL}/api/auth/callback/google`
 * must be registered as an authorized redirect URI in Google Cloud.
 */

const baseURL = config.BETTER_AUTH_URL ?? "http://localhost:3000";
// Where the web dashboard lives — invitation/accept links must point here, not
// at the API. Falls back to the API origin if no separate web app is configured.
const webAppOrigin = process.env.WEB_APP_ORIGIN ?? baseURL;

const trustedOrigins = Array.from(
  new Set(
    [
      baseURL,
      "http://localhost:3000",
      process.env.WEB_APP_ORIGIN,
    ].filter((value): value is string => Boolean(value))
  )
);

export const auth = betterAuth({
  baseURL,
  secret: config.BETTER_AUTH_SECRET,
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  trustedOrigins,
  hooks: mcpTokenHooks,
  databaseHooks: {
    verification: {
      create: {
        before: async (verification, ctx) => {
          if (!ctx?.context.session) return;
          // The MCP plugin can resume authorization in a sign-in after-hook.
          // Identify OAuth codes by their data, rather than only the route name.
          let value: Record<string, unknown>;
          try { value = JSON.parse(verification.value); } catch { return; }
          if (!value || typeof value !== "object" || typeof value.clientId !== "string" || typeof value.redirectURI !== "string" || !Array.isArray(value.scope)) return;
          const session = ctx.context.session;
          return { data: { ...verification, value: await bindAuthorization(verification.value, {
            user: session.user,
            session: { activeOrganizationId: typeof session.session.activeOrganizationId === "string" ? session.session.activeOrganizationId : null },
          }) } };
        },
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    // Require verification when explicitly on, or whenever a real email provider
    // is configured (so prod with Resend is secure by default; dev without a
    // provider stays usable since EMAIL_VERIFICATION defaults off).
    requireEmailVerification: config.EMAIL_VERIFICATION === "on" || (config.EMAIL_VERIFICATION !== "off" && isEmailConfigured()),
    minPasswordLength: 12,
    sendResetPassword: async ({ user, url }) => {
      await sendActionEmail(user.email, "Reset your password", {
        heading: "Reset your password",
        body: "We received a request to reset your password. This link expires shortly.",
        url,
        cta: "Reset password",
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendActionEmail(user.email, "Verify your email", {
        heading: "Verify your email",
        body: "Confirm your email address to finish setting up your Google Ads MCP account.",
        url,
        cta: "Verify email",
      });
    },
  },

  socialProviders: {
    google: {
      clientId: config.GOOGLE_ADS_CLIENT_ID,
      clientSecret: config.GOOGLE_ADS_CLIENT_SECRET,
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },

  advanced: {
    // Behind a reverse proxy (Caddy), derive the client IP from the forwarded
    // header so rate limiting attributes requests to the real client.
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
    },
  },

  plugins: [
    organization({
      async sendInvitationEmail(data) {
        const url = `${webAppOrigin}/accept-invitation/${data.id}`;
        await sendActionEmail(data.email, `You're invited to ${data.organization.name}`, {
          heading: `Join ${data.organization.name}`,
          body: `${data.inviter.user.name || data.inviter.user.email} invited you to the ${data.organization.name} workspace on Google Ads MCP.`,
          url,
          cta: "Accept invitation",
        });
      },
    }),
    admin(),
    bearer(),
    // Enterprise SSO (SAML 2.0 + OIDC). Providers are registered per agency at
    // runtime (POST /api/auth/sso/register) and used via /api/auth/sign-in/sso.
    // A federated user is linked to their org so existing RBAC/grants apply.
    sso({
      provisionUser: async ({ user }) => {
        logger.info({ userId: user.id, email: user.email }, "SSO user provisioned");
      },
    }),
    mcp({ loginPage: `${webAppOrigin}/sign-in`, oidcConfig: { ...MCP_OIDC_CONFIG, loginPage: `${webAppOrigin}/sign-in` } }),
  ],
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
