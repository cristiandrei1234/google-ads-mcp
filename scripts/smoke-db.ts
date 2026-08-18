/**
 * Live smoke test for the production data layer (run against a real Postgres).
 *
 *   $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/google_ads_mcp?schema=public"
 *   $env:TOKEN_ENCRYPTION_KEY="<base64 32 bytes>"
 *   npx tsx scripts/smoke-db.ts
 *
 * Exercises: org/member seeding, encrypted connection upsert, grant, grant-based
 * connection resolution (decrypt round-trip), audit append, user status read.
 * Cleans up everything it creates.
 */
import { getPrisma,
  upsertConnection,
  addGrant,
  getConnectionForCustomer,
  reachableCustomerIds,
  appendAuditLog,
  getUserStatusData,
} from "../src/services/db.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const stamp = `smoke-${process.pid}-${Math.floor(performance.now())}`;
  const REFRESH = "1//0-fake-refresh-token-for-smoke";
  const CUSTOMER = "111-222-3333";
  let orgId = "";

  try {
    const user = await getPrisma().user.create({
      data: { email: `${stamp}@example.test`, name: "Smoke User" },
    });
    const org = await getPrisma().organization.create({ data: { name: `Org ${stamp}` } });
    orgId = org.id;
    const member = await getPrisma().member.create({
      data: { organizationId: org.id, userId: user.id, role: "owner" },
    });

    const connection = await upsertConnection({
      organizationId: org.id,
      ownerMemberId: member.id,
      label: "Employee MCC",
      mccCustomerId: "999-888-7777",
      refreshToken: REFRESH,
      isAgencyRoot: false,
    });
    assert(/^v\d+:/.test(connection.refreshTokenEnc), "token stored encrypted (versioned)");
    assert(connection.refreshTokenEnc.startsWith("v2:"), "token uses AAD-bound v2 scheme");
    assert(!connection.refreshTokenEnc.includes(REFRESH), "plaintext token not in DB row");
    console.log("✓ connection created with encrypted token");

    await addGrant({
      memberId: member.id,
      connectionId: connection.id,
      customerId: CUSTOMER,
      accessLevel: "WRITE",
    });
    console.log("✓ grant added");

    const resolved = await getConnectionForCustomer(user.id, CUSTOMER);
    assert(resolved !== null, "connection resolved for granted customer");
    assert(resolved!.refreshToken === REFRESH, "decrypt round-trip matches");
    assert(resolved!.mccCustomerId === "9998887777", "login MCC normalized");
    assert(resolved!.accessLevel === "WRITE", "access level carried");
    console.log("✓ grant-based resolution + decrypt round-trip OK");

    const denied = await getConnectionForCustomer(user.id, "000-000-0000");
    assert(denied === null, "ungranted customer is denied (null)");
    console.log("✓ ungranted customer denied");

    const reachable = await reachableCustomerIds(user.id);
    assert(reachable.includes("1112223333"), "reachable list includes granted customer");
    console.log("✓ reachableCustomerIds OK");

    await appendAuditLog({
      organizationId: org.id,
      memberId: member.id,
      userId: user.id,
      tool: "remove_campaign",
      customerId: CUSTOMER,
      outcome: "ok",
      argsSummary: { campaignId: "123", confirm: true },
    });
    const auditCount = await getPrisma().auditLog.count({ where: { organizationId: org.id } });
    assert(auditCount === 1, "audit row appended");
    console.log("✓ audit append OK");

    const status = await getUserStatusData(user.id);
    assert(status?.memberships.length === 1, "user status has one membership");
    assert(status!.memberships[0]!.connections.length === 1, "status lists the connection");
    assert(status!.memberships[0]!.grants.length === 1, "status lists the grant");
    console.log("✓ getUserStatusData OK");

    console.log("\nALL SMOKE CHECKS PASSED");
  } finally {
    if (orgId) {
      // Cascades to members, connections, grants, audit logs.
      await getPrisma().organization.deleteMany({ where: { id: orgId } });
    }
    await getPrisma().user.deleteMany({ where: { email: { startsWith: stamp } } });
    await getPrisma().$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
