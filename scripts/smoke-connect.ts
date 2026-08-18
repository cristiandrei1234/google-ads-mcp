/**
 * Live smoke for the onboarding surface: admin connection/member listing, grant
 * CRUD, and the Google Ads OAuth connect redirect. Requires the server running
 * (PORT) and a live DB.
 *
 *   $env:PORT=3939; npx tsx scripts/smoke-connect.ts
 *
 * The OAuth code-exchange itself needs Google consent (a browser), so this
 * verifies the redirect is built + auth-gated, and seeds a connection directly
 * to exercise the admin endpoints end to end. Cleans up what it creates.
 */
import { getPrisma, upsertConnection } from "../src/services/db.js";

const PORT = process.env.PORT ?? "3939";
const BASE = `http://localhost:${PORT}`;
const ORIGIN = "http://localhost:3000";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const email = `smoke-connect-${process.pid}@example.test`;
  const password = "correct-horse-battery";
  let orgId = "";
  try {
    await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ email, password, name: "Smoke Connect" }),
    });
    const user = await getPrisma().user.update({ where: { email }, data: { emailVerified: true } });
    const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ email, password }),
    });
    const token = signIn.headers.get("set-auth-token");
    assert(token, "got a bearer token");

    const org = await getPrisma().organization.create({ data: { name: `Org ${email}` } });
    orgId = org.id;
    const member = await getPrisma().member.create({ data: { organizationId: org.id, userId: user.id, role: "admin" } });
    await getPrisma().session.updateMany({ where: { userId: user.id }, data: { activeOrganizationId: org.id } });
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // Seed a connection (simulating a completed OAuth connect).
    const connection = await upsertConnection({
      organizationId: org.id,
      ownerMemberId: member.id,
      label: "Smoke MCC",
      mccCustomerId: "1234567890",
      refreshToken: "smoke-refresh-token",
    });
    console.log("✓ seeded a Google Ads connection");

    // 1) connect redirect is auth-gated and points at Google's consent screen
    const noAuth = await fetch(`${BASE}/connect/google-ads`, { redirect: "manual" });
    assert(noAuth.status === 401, `connect without auth should be 401, got ${noAuth.status}`);
    const redirect = await fetch(`${BASE}/connect/google-ads`, { headers: auth, redirect: "manual" });
    assert(redirect.status === 302, `connect should 302, got ${redirect.status}`);
    const location = redirect.headers.get("location") ?? "";
    assert(location.startsWith("https://accounts.google.com/"), "redirects to Google consent");
    assert(location.includes("adwords"), "requests the adwords scope");
    console.log("✓ GET /connect/google-ads -> 302 to Google consent (adwords scope)");

    // 2) admin lists connections + members
    const conns = await (await fetch(`${BASE}/admin/connections`, { headers: auth })).json();
    assert(conns.connections.some((c: any) => c.id === connection.id), "connection is listed");
    const members = await (await fetch(`${BASE}/admin/members`, { headers: auth })).json();
    assert(members.members.some((m: any) => m.id === member.id), "member is listed");
    console.log("✓ GET /admin/connections + /admin/members");

    // 3) grant CRUD
    const grantRes = await fetch(`${BASE}/admin/grants`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ memberId: member.id, connectionId: connection.id, customerId: "111-222-3333", accessLevel: "WRITE" }),
    });
    assert(grantRes.status === 200, `grant should be 200, got ${grantRes.status}`);
    const grant = await grantRes.json();
    assert(grant.grant.accessLevel === "WRITE" && grant.grant.customerId === "1112223333", "grant normalized + level set");
    console.log("✓ POST /admin/grants (WRITE)");

    // a grant for a member outside the org is rejected
    const badMember = await fetch(`${BASE}/admin/grants`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ memberId: "not-in-org", connectionId: connection.id, customerId: "1", accessLevel: "READ" }),
    });
    assert(badMember.status === 404, `cross-org member grant should be 404, got ${badMember.status}`);
    console.log("✓ cross-org grant rejected");

    const del = await fetch(`${BASE}/admin/grants`, {
      method: "DELETE",
      headers: auth,
      body: JSON.stringify({ memberId: member.id, connectionId: connection.id, customerId: "1112223333" }),
    });
    const delJson = await del.json();
    assert(del.status === 200 && delJson.removed === 1, "grant removed");
    console.log("✓ DELETE /admin/grants");

    // 4) invite a teammate (Better Auth organization plugin)
    const invite = await fetch(`${BASE}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: { ...auth, Origin: ORIGIN },
      body: JSON.stringify({ email: `invitee-${process.pid}@example.test`, role: "member", organizationId: org.id }),
    });
    assert(invite.ok, `invite-member should succeed, got ${invite.status}: ${await invite.clone().text()}`);
    const invitationCount = await getPrisma().invitation.count({ where: { organizationId: org.id, status: "pending" } });
    assert(invitationCount === 1, `one pending invitation expected, got ${invitationCount}`);
    console.log("✓ POST /api/auth/organization/invite-member -> pending invitation created");

    console.log("\nALL CONNECT/ONBOARDING SMOKE CHECKS PASSED");
  } finally {
    if (orgId) {
      await getPrisma().accountGrant.deleteMany({ where: { connection: { organizationId: orgId } } });
      await getPrisma().googleAdsConnection.deleteMany({ where: { organizationId: orgId } });
      await getPrisma().member.deleteMany({ where: { organizationId: orgId } });
      await getPrisma().organization.deleteMany({ where: { id: orgId } });
    }
    await getPrisma().user.deleteMany({ where: { email } });
    await getPrisma().$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
