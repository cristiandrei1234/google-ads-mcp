/**
 * Live smoke test for the Better Auth instance (run against a real Postgres).
 *
 *   $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/google_ads_mcp?schema=public"
 *   $env:TOKEN_ENCRYPTION_KEY/BETTER_AUTH_SECRET/GOOGLE_ADS_* from .env
 *   npx tsx scripts/smoke-auth.ts
 *
 * Verifies the Prisma adapter + new schema by signing up a user through the
 * Better Auth server API and confirming the row lands in the DB. Cleans up.
 */
import { auth } from "../src/auth/betterAuth.js";
import prisma from "../src/services/db.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const email = `smoke-auth-${process.pid}@example.test`;
  try {
    const apiKeys = Object.keys(auth.api);
    assert(apiKeys.includes("signUpEmail"), "email/password enabled (signUpEmail present)");
    assert(apiKeys.some((k) => k.toLowerCase().includes("organization")), "organization plugin loaded");
    assert(apiKeys.some((k) => k.toLowerCase().includes("oauth") || k.toLowerCase().includes("mcp")), "mcp/oidc plugin loaded");
    console.log(`✓ auth instance constructed; ${apiKeys.length} API endpoints`);

    await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery", name: "Smoke Auth" },
    });

    const user = await prisma.user.findUnique({ where: { email } });
    assert(user !== null, "user row created via Better Auth + Prisma adapter");
    const account = await prisma.account.findFirst({ where: { userId: user!.id, providerId: "credential" } });
    assert(account !== null, "credential account row created (password stored)");
    console.log("✓ email/password sign-up persisted through the adapter on live PG");

    console.log("\nALL AUTH SMOKE CHECKS PASSED");
  } finally {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
