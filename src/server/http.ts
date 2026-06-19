import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { auth } from "../auth/betterAuth.js";
import { createMcpServer } from "../createServer.js";
import { runWithIdentity, type AuthContext } from "../auth/identityContext.js";
import prisma, {
  upsertConnection,
  listConnectionsForOrg,
  getOrgConnection,
  listOrgMembers,
  memberInOrg,
  addGrant,
  removeGrant,
} from "../services/db.js";
import type { AccessLevel } from "@prisma/client";
import { signConnectState, verifyConnectState } from "../auth/connectState.js";
import {
  getConsentUrl,
  exchangeCodeForRefreshToken,
  detectLoginCustomerId,
  listClientAccounts,
} from "../services/google-ads/oauth.js";
import config, { assertHttpServerConfig } from "../config/env.js";
import logger from "../observability/logger.js";
import { toErrorMessage } from "../observability/errorMessage.js";
import { SessionStore } from "./sessionStore.js";
import { checkDatabase, shutdown, installSignalHandlers } from "./lifecycle.js";
import {
  metricsText,
  metricsContentType,
  setActiveSessions,
  enableDefaultMetrics,
} from "../observability/metrics.js";

enableDefaultMetrics();

// Fail closed: refuse to start without a real signing key, encryption key, and
// public URL (no default-secret / localhost-origin boot in production).
assertHttpServerConfig();

const app = express();

// Behind a reverse proxy: trust exactly N hops (default 1 = a single Caddy) so
// req.ip is the real, non-spoofable client. NEVER `true` (trusts the whole
// X-Forwarded-For chain, lets clients spoof their IP and defeat rate limiting).
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

app.use(helmet());

// One Streamable HTTP transport per MCP session, bound to its owning user, with
// inactivity expiry and bulk teardown (see SessionStore).
const sessions = new SessionStore<StreamableHTTPServerTransport>();

// Inactivity sweep: evict sessions idle past the TTL so a crashed transport
// that never fired `onclose` can't leak forever. Unref'd so it never blocks exit.
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 30 * 60_000);
const SESSION_SWEEP_MS = Number(process.env.SESSION_SWEEP_MS ?? 60_000);
const sweepTimer = setInterval(() => {
  void sessions.sweepExpired(SESSION_TTL_MS).then((evicted) => {
    if (evicted > 0) logger.info({ evicted, remaining: sessions.size }, "swept idle MCP sessions");
  });
}, SESSION_SWEEP_MS);
sweepTimer.unref();

// CORS: only the agency's own web origins may call the API with credentials.
const allowedOrigins = [config.BETTER_AUTH_URL, process.env.WEB_APP_ORIGIN, "http://localhost:3000"].filter(
  (value): value is string => Boolean(value)
);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id", "mcp-protocol-version"],
    exposedHeaders: ["mcp-session-id", "x-request-id"],
  })
);

// Per-request correlation id + structured access log.
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  (req as Request & { requestId: string }).requestId = requestId;
  res.setHeader("x-request-id", requestId);
  const startedAt = Date.now();
  res.on("finish", () => {
    logger.info(
      { requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - startedAt },
      "http"
    );
  });
  next();
});

// Better Auth routes (sign-in/up, OAuth, OIDC/MCP discovery). Mounted BEFORE
// express.json so Better Auth can read the raw request body itself.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "1mb" }));

// Liveness: the process is up. Cheap and dependency-free (do not touch the DB
// here, or a brief DB blip would make orchestrators kill an otherwise-fine pod).
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Readiness: can we actually serve traffic? Verifies Postgres answers. Returns
// 503 when the DB is unreachable so the reverse proxy stops routing to us.
app.get("/health/ready", async (_req: Request, res: Response) => {
  const dbOk = await checkDatabase(prisma, logger);
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ready" : "degraded",
    checks: { database: dbOk ? "ok" : "down" },
    sessions: sessions.size,
  });
});

// Prometheus scrape endpoint. Guarded by a bearer token (METRICS_TOKEN): never
// exposed publicly, since metrics leak traffic shape and internal tool names.
// When METRICS_TOKEN is unset the endpoint is disabled (404) rather than open.
app.get("/metrics", async (req: Request, res: Response) => {
  const token = process.env.METRICS_TOKEN;
  if (!token) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  setActiveSessions(sessions.size);
  res.setHeader("Content-Type", metricsContentType);
  res.send(await metricsText());
});

// Admin-only audit trail for the caller's organization.
const ADMIN_ROLES = new Set(["owner", "admin"]);

// Force-logout: an org admin revokes all of a user's sessions (auth + live MCP).
// Deletes Better Auth Session rows (kills cookie/bearer) and closes the user's
// in-flight MCP transports. Body: { userId }.
app.post("/admin/revoke-sessions", async (req: Request, res: Response) => {
  const authCtx = await resolveAuthContext(req);
  if (!authCtx) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!authCtx.orgId || !ADMIN_ROLES.has(authCtx.role ?? "")) {
    res.status(403).json({ error: "forbidden", message: "Organization admin role required." });
    return;
  }
  const targetUserId = typeof req.body?.userId === "string" ? req.body.userId : undefined;
  if (!targetUserId) {
    res.status(400).json({ error: "bad_request", message: "Body must include a userId string." });
    return;
  }
  // Only revoke users who share the admin's organization (no cross-tenant reach).
  const member = await prisma.member.findFirst({
    where: { userId: targetUserId, organizationId: authCtx.orgId },
    select: { id: true },
  });
  if (!member) {
    res.status(404).json({ error: "not_found", message: "User is not a member of your organization." });
    return;
  }
  const { count } = await prisma.session.deleteMany({ where: { userId: targetUserId } });
  const closedMcp = await sessions.closeForUser(targetUserId);
  logger.info(
    { actor: authCtx.userId, targetUserId, authSessions: count, mcpSessions: closedMcp },
    "admin revoked user sessions"
  );
  res.json({ userId: targetUserId, revokedAuthSessions: count, closedMcpSessions: closedMcp });
});
app.get("/audit", async (req: Request, res: Response) => {
  const authCtx = await resolveAuthContext(req);
  if (!authCtx) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!authCtx.orgId || !ADMIN_ROLES.has(authCtx.role ?? "")) {
    res.status(403).json({ error: "forbidden", message: "Organization admin role required." });
    return;
  }
  const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
  const customerId = typeof req.query.customerId === "string" ? req.query.customerId.replace(/-/g, "") : undefined;
  const logs = await prisma.auditLog.findMany({
    where: { organizationId: authCtx.orgId, ...(customerId ? { customerId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  res.json({ organizationId: authCtx.orgId, count: logs.length, logs });
});

/**
 * Resolve the authenticated caller from the request (cookie session or bearer).
 * Returns null when there is no valid session.
 */
async function resolveAuthContext(req: Request): Promise<AuthContext | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    return null;
  }

  const userId = session.user.id;
  const orgId = session.session.activeOrganizationId ?? null;
  let memberId: string | null = null;
  let role: string | null = null;

  if (orgId) {
    const member = await prisma.member.findFirst({
      where: { userId, organizationId: orgId },
      select: { id: true, role: true },
    });
    if (member) {
      memberId = member.id;
      role = member.role;
    }
  }

  return { userId, orgId, memberId, role, requestId: (req as Request & { requestId?: string }).requestId };
}

// ---------------------------------------------------------------------------
// Google Ads connect (OAuth) + admin onboarding (connections, members, grants)
// ---------------------------------------------------------------------------

const webAppOrigin = process.env.WEB_APP_ORIGIN ?? config.BETTER_AUTH_URL ?? "http://localhost:3000";
const connectRedirectUri = `${config.BETTER_AUTH_URL}/connect/google-ads/callback`;

/** Resolve an authenticated org admin, or write 401/403 and return null. */
async function resolveOrgAdmin(req: Request, res: Response): Promise<AuthContext | null> {
  const authCtx = await resolveAuthContext(req);
  if (!authCtx) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  if (!authCtx.orgId || !ADMIN_ROLES.has(authCtx.role ?? "")) {
    res.status(403).json({ error: "forbidden", message: "Organization admin role required." });
    return null;
  }
  return authCtx;
}

// Begin the Google Ads OAuth connect: redirect the signed-in member to Google's
// consent screen (adwords scope). The signed `state` binds the flow to them.
app.get("/connect/google-ads", async (req: Request, res: Response) => {
  const authCtx = await resolveAuthContext(req);
  if (!authCtx) {
    res.status(401).json({ error: "unauthorized", message: "Sign in first." });
    return;
  }
  if (!authCtx.orgId || !authCtx.memberId) {
    res.status(403).json({ error: "forbidden", message: "Join an organization before connecting an account." });
    return;
  }
  const state = signConnectState({ memberId: authCtx.memberId, orgId: authCtx.orgId }, config.BETTER_AUTH_SECRET!);
  res.redirect(getConsentUrl(connectRedirectUri, state));
});

// OAuth callback: exchange the code, detect the login (MCC) customer, store the
// encrypted connection, then bounce back to the web app.
app.get("/connect/google-ads/callback", async (req: Request, res: Response) => {
  const result = (status: string, extra = "") =>
    res.redirect(`${webAppOrigin}/connect/result?status=${status}${extra}`);
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const stateToken = typeof req.query.state === "string" ? req.query.state : undefined;
  if (!code || !stateToken) {
    result("error", "&message=" + encodeURIComponent("Missing authorization code or state."));
    return;
  }
  const state = verifyConnectState(stateToken, config.BETTER_AUTH_SECRET!);
  if (!state) {
    result("error", "&message=" + encodeURIComponent("Invalid or expired authorization state."));
    return;
  }
  try {
    const refreshToken = await exchangeCodeForRefreshToken(connectRedirectUri, code);
    const { mccCustomerId } = await detectLoginCustomerId(refreshToken);
    await upsertConnection({
      organizationId: state.orgId,
      ownerMemberId: state.memberId,
      label: `Google Ads ${mccCustomerId}`,
      mccCustomerId,
      refreshToken,
    });
    logger.info({ orgId: state.orgId, memberId: state.memberId, mccCustomerId }, "Google Ads connection linked");
    result("connected", "&mcc=" + encodeURIComponent(mccCustomerId));
  } catch (err) {
    logger.error({ err }, "Google Ads connect failed");
    result("error", "&message=" + encodeURIComponent(toErrorMessage(err)));
  }
});

// List the org's connections (no secrets).
app.get("/admin/connections", async (req: Request, res: Response) => {
  const authCtx = await resolveOrgAdmin(req, res);
  if (!authCtx) return;
  res.json({ connections: await listConnectionsForOrg(authCtx.orgId!) });
});

// List the org's members (to assign grants to).
app.get("/admin/members", async (req: Request, res: Response) => {
  const authCtx = await resolveOrgAdmin(req, res);
  if (!authCtx) return;
  res.json({ members: await listOrgMembers(authCtx.orgId!) });
});

// List the client accounts reachable under a connection's MCC (for granting).
app.get("/admin/accessible-accounts", async (req: Request, res: Response) => {
  const authCtx = await resolveOrgAdmin(req, res);
  if (!authCtx) return;
  const connectionId = typeof req.query.connectionId === "string" ? req.query.connectionId : undefined;
  if (!connectionId) {
    res.status(400).json({ error: "bad_request", message: "connectionId is required." });
    return;
  }
  const connection = await getOrgConnection(connectionId, authCtx.orgId!);
  if (!connection) {
    res.status(404).json({ error: "not_found", message: "Connection not in your organization." });
    return;
  }
  try {
    res.json({ accounts: await listClientAccounts(connection.refreshToken, connection.mccCustomerId) });
  } catch (err) {
    res.status(502).json({ error: "google_ads_error", message: toErrorMessage(err) });
  }
});

const GRANT_LEVELS = new Set(["READ", "WRITE", "ADMIN"]);

// Grant a member access to a client account through a connection.
app.post("/admin/grants", async (req: Request, res: Response) => {
  const authCtx = await resolveOrgAdmin(req, res);
  if (!authCtx) return;
  const { memberId, connectionId, customerId, accessLevel } = req.body ?? {};
  if (typeof memberId !== "string" || typeof connectionId !== "string" || typeof customerId !== "string") {
    res.status(400).json({ error: "bad_request", message: "memberId, connectionId and customerId are required." });
    return;
  }
  // Both the connection and the member must belong to the admin's own org.
  if (!(await getOrgConnection(connectionId, authCtx.orgId!))) {
    res.status(404).json({ error: "not_found", message: "Connection not in your organization." });
    return;
  }
  if (!(await memberInOrg(memberId, authCtx.orgId!))) {
    res.status(404).json({ error: "not_found", message: "Member not in your organization." });
    return;
  }
  const level: AccessLevel = GRANT_LEVELS.has(accessLevel) ? accessLevel : "READ";
  const grant = await addGrant({ memberId, connectionId, customerId, accessLevel: level });
  res.json({ grant: { memberId, connectionId, customerId: grant.customerId, accessLevel: grant.accessLevel } });
});

// Revoke a member's grant.
app.delete("/admin/grants", async (req: Request, res: Response) => {
  const authCtx = await resolveOrgAdmin(req, res);
  if (!authCtx) return;
  const { memberId, connectionId, customerId } = req.body ?? {};
  if (typeof memberId !== "string" || typeof connectionId !== "string" || typeof customerId !== "string") {
    res.status(400).json({ error: "bad_request", message: "memberId, connectionId and customerId are required." });
    return;
  }
  if (!(await getOrgConnection(connectionId, authCtx.orgId!))) {
    res.status(404).json({ error: "not_found", message: "Connection not in your organization." });
    return;
  }
  const { count } = await removeGrant(memberId, connectionId, customerId);
  res.json({ removed: count });
});

// Per-IP rate limit for the MCP endpoint (auth endpoints are limited by Better Auth).
const mcpLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/mcp", mcpLimiter);

app.post("/mcp", async (req: Request, res: Response) => {
  const authCtx = await resolveAuthContext(req);
  if (!authCtx) {
    res.status(401).json({ error: "unauthorized", message: "Sign in via /api/auth first." });
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessions.getOwned(sessionId, authCtx.userId)?.transport;

  if (!transport) {
    // A session id that exists but isn't ours must not fall through to "create".
    if (sessionId) {
      res.status(404).json({ error: "not_found", message: "Unknown session." });
      return;
    }
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: "bad_request", message: "No valid session; send an initialize request first." });
      return;
    }
    const ownerUserId = authCtx.userId;
    const newTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.add(sid, newTransport, ownerUserId);
        logger.info({ sessionId: sid, userId: ownerUserId }, "MCP session initialized");
      },
    });
    newTransport.onclose = () => {
      if (newTransport.sessionId) {
        sessions.delete(newTransport.sessionId);
      }
    };
    const server = createMcpServer();
    await server.connect(newTransport);
    transport = newTransport;
  } else if (sessionId) {
    sessions.touch(sessionId);
  }

  await runWithIdentity(authCtx, () => transport!.handleRequest(req, res, req.body));
});

async function handleSessionRequest(req: Request, res: Response) {
  const authCtx = await resolveAuthContext(req);
  if (!authCtx) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessions.getOwned(sessionId, authCtx.userId);
  if (!session) {
    res.status(404).json({ error: "not_found", message: "Unknown or unauthorized mcp-session-id." });
    return;
  }
  sessions.touch(sessionId!);
  await runWithIdentity(authCtx, () => session.transport.handleRequest(req, res));
}

// SSE stream (server -> client) and session teardown.
app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

const port = Number(process.env.PORT ?? 3000);
const httpServer = app.listen(port, () => {
  logger.info(`Google Ads MCP HTTP server listening on :${port}`);
});

// Graceful shutdown: stop accepting connections, drain MCP sessions, close the
// DB pool. A watchdog forces exit if the drain hangs.
installSignalHandlers({
  process,
  logger,
  exit: (code) => process.exit(code),
  run: async () => {
    clearInterval(sweepTimer);
    await shutdown({ server: httpServer, sessions, prisma, logger });
  },
});
