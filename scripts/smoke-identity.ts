/**
 * Live smoke for step 8: the AsyncLocalStorage identity drives account access.
 *
 *   $env:DATABASE_URL=local; $env:TOKEN_ENCRYPTION_KEY + GOOGLE_ADS_* from .env
 *   npx tsx scripts/smoke-identity.ts
 *
 * Proves getCustomer resolves a connection ONLY for accounts the identity holds
 * a grant for, ignores any caller-supplied userId, and falls back to env when
 * there is no identity. No network/Google calls (api.Customer is local).
 */
import prisma, { upsertConnection, addGrant, getGrantLevel } from "../src/services/db.js";
import { getCustomer } from "../src/services/google-ads/client.js";
import { runWithIdentity } from "../src/auth/identityContext.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const stamp = `smoke-id-${process.pid}`;
  const GRANTED = "111-111-1111";
  const UNGRANTED = "222-222-2222";
  let orgId = "";
  try {
    const user = await prisma.user.create({ data: { email: `${stamp}@example.test`, name: "Id" } });
    const org = await prisma.organization.create({ data: { name: `Org ${stamp}` } });
    orgId = org.id;
    const member = await prisma.member.create({
      data: { organizationId: org.id, userId: user.id, role: "member" },
    });
    const connection = await upsertConnection({
      organizationId: org.id,
      ownerMemberId: member.id,
      label: "MCC",
      mccCustomerId: "999-000-1111",
      refreshToken: "1//0-fake",
    });
    await addGrant({ memberId: member.id, connectionId: connection.id, customerId: GRANTED, accessLevel: "WRITE" });

    assert((await getGrantLevel(user.id, GRANTED)) === "WRITE", "grant level is WRITE for granted account");
    assert((await getGrantLevel(user.id, UNGRANTED)) === null, "grant level is null for ungranted account");
    console.log("✓ getGrantLevel reports WRITE / null correctly");

    const identity = { userId: user.id, orgId: org.id, memberId: member.id, role: "member" };

    await runWithIdentity(identity, async () => {
      const customer = await getCustomer(GRANTED);
      assert(customer, "granted customer resolves a client under the identity");
      console.log("✓ identity + grant -> getCustomer resolves the account");

      let denied = false;
      try {
        await getCustomer(UNGRANTED);
      } catch (e: any) {
        denied = /no grant/i.test(e.message);
      }
      assert(denied, "ungranted customer is refused (no grant)");
      console.log("✓ ungranted account refused under the same identity");

      // Impersonation attempt: a bogus userId argument must be ignored — access
      // is still decided by the ALS identity, so the ungranted account stays denied.
      let stillDenied = false;
      try {
        await getCustomer(UNGRANTED, "some-other-user-id");
      } catch (e: any) {
        stillDenied = /no grant/i.test(e.message);
      }
      assert(stillDenied, "caller-supplied userId is ignored (no impersonation)");
      console.log("✓ caller-supplied userId ignored (anti-impersonation)");
    });

    // No identity -> env path (NOT the grant path), regardless of env token presence.
    let usedEnvPath = false;
    try {
      await getCustomer(GRANTED);
      usedEnvPath = true; // resolved via env credentials
    } catch (e: any) {
      usedEnvPath = !/no grant/i.test(e.message); // any non-grant error = env branch
    }
    assert(usedEnvPath, "no identity -> env fallback path (not grant path)");
    console.log("✓ no identity -> env fallback path (not grant-based)");

    console.log("\nALL IDENTITY SMOKE CHECKS PASSED");
  } finally {
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: stamp } } });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
