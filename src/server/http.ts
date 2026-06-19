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
import prisma from "../services/db.js";
import config, { assertHttpServerConfig } from "../config/env.js";
import logger from "../observability/logger.js";
import { SessionStore } from "./sessionStore.js";
import { checkDatabase, shutdown, installSignalHandlers } from "./lifecycle.js";

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

// Admin-only audit trail for the caller's organization.
const ADMIN_ROLES = new Set(["owner", "admin"]);
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
