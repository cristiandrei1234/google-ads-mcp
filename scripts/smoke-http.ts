/**
 * Live end-to-end smoke for the HTTP transport, auth gate, identity, and audit.
 * Requires the server running (npm run http:dev on $PORT) and a live DB.
 *
 *   $env:DATABASE_URL=...local...; $env:PORT=3939; npx tsx scripts/smoke-http.ts
 */
import prisma from "../src/services/db.js";

const PORT = process.env.PORT ?? "3939";
const BASE = `http://localhost:${PORT}`;
const ORIGIN = "http://localhost:3000";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const initBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-http", version: "1.0.0" },
  },
};

/** POST a JSON-RPC message to /mcp and parse the SSE/JSON response. */
async function rpc(body: unknown, opts: { token: string; sessionId?: string }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${opts.token}`,
  };
  if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;
  const res = await fetch(`${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  const dataLines = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  const last = dataLines.length ? JSON.parse(dataLines[dataLines.length - 1]!) : null;
  return { status: res.status, sessionId: res.headers.get("mcp-session-id"), requestId: res.headers.get("x-request-id"), json: last };
}

async function main() {
  const email = `smoke-http-${process.pid}@example.test`;
  const password = "correct-horse-battery";
  let orgId = "";
  try {
    // 1) unauth initialize -> 401
    const unauth = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(initBody),
    });
    assert(unauth.status === 401, `unauth /mcp should be 401, got ${unauth.status}`);
    console.log("✓ unauthenticated /mcp -> 401");

    // 2) sign up, force-verify, sign in (bearer token)
    const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ email, password, name: "Smoke HTTP" }),
    });
    assert(signUp.ok, `sign-up should succeed, got ${signUp.status}: ${await signUp.text()}`);
    const user = await prisma.user.update({ where: { email }, data: { emailVerified: true } });

    const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ email, password }),
    });
    assert(signIn.ok, `sign-in should succeed, got ${signIn.status}`);
    const token = signIn.headers.get("set-auth-token");
    assert(token, "sign-in returned a bearer token (set-auth-token)");
    console.log("✓ sign-up + sign-in issued a bearer token");

    // 3) make the caller an org admin and set the active org on their session(s)
    const org = await prisma.organization.create({ data: { name: `Org ${email}` } });
    orgId = org.id;
    await prisma.member.create({ data: { organizationId: org.id, userId: user.id, role: "admin" } });
    await prisma.session.updateMany({ where: { userId: user.id }, data: { activeOrganizationId: org.id } });

    // 4) authenticated initialize -> 200 + mcp-session-id + x-request-id
    const init = await rpc(initBody, { token: token! });
    assert(init.status === 200, `authed initialize should be 200, got ${init.status}`);
    assert(init.sessionId, "initialize returned an mcp-session-id");
    assert(init.requestId, "response carries an x-request-id");
    const sessionId = init.sessionId!;
    console.log(`✓ authenticated initialize -> 200 (session ${sessionId}, req ${init.requestId})`);

    // MCP handshake: notify initialized.
    await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    // 5) tools/list -> the advertised schema must NOT expose userId
    const list = await rpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { token: token!, sessionId }
    );
    assert(list.status === 200 && list.json?.result?.tools?.length, "tools/list returns tools");
    const runQueryTool = list.json.result.tools.find((t: any) => t.name === "run_gaql_query");
    assert(runQueryTool, "run_gaql_query is listed");
    const props = runQueryTool.inputSchema?.properties ?? {};
    assert(!("userId" in props), "userId is NOT advertised in tool input schema");
    console.log(`✓ tools/list OK (${list.json.result.tools.length} tools); userId not advertised`);

    // 6) tools/call -> withRbac runs, writes an AuditLog row attributed to the org
    const auditBefore = await prisma.auditLog.count({ where: { organizationId: org.id } });
    await rpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_accessible_accounts", arguments: {} } },
      { token: token!, sessionId }
    );
    // Audit is fire-and-forget on the server, so poll briefly for the row.
    let auditAfter = auditBefore;
    for (let i = 0; i < 20 && auditAfter <= auditBefore; i++) {
      await new Promise((r) => setTimeout(r, 100));
      auditAfter = await prisma.auditLog.count({ where: { organizationId: org.id } });
    }
    assert(auditAfter === auditBefore + 1, `tool call should append one audit row (before ${auditBefore}, after ${auditAfter})`);
    const row = await prisma.auditLog.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" } });
    assert(row?.tool === "list_accessible_accounts", "audit row records the tool");
    assert(row?.memberId && row?.userId === user.id, "audit row attributes member + user");
    console.log(`✓ authenticated tools/call -> AuditLog row (tool=${row!.tool}, outcome=${row!.outcome})`);

    // 7) admin /audit endpoint returns the row
    const auditRes = await fetch(`${BASE}/audit?limit=10`, { headers: { Authorization: `Bearer ${token}` } });
    assert(auditRes.status === 200, `/audit (admin) should be 200, got ${auditRes.status}`);
    const auditJson = await auditRes.json();
    assert(auditJson.count >= 1, "/audit returns at least one row");
    console.log(`✓ GET /audit (admin) -> ${auditJson.count} row(s)`);

    console.log("\nALL HTTP E2E CHECKS PASSED");
  } finally {
    if (orgId) {
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
