/**
 * Re-encrypt every stored Google Ads refresh token under a NEW primary key.
 *
 * Key rotation flow (zero-downtime):
 *   1. Generate a new key:           openssl rand -base64 32
 *   2. Set env for this run:
 *        TOKEN_ENCRYPTION_KEY          = <NEW key>
 *        TOKEN_ENCRYPTION_KEY_PREVIOUS = <OLD key>[,<older keys...>]
 *   3. Run:  npx tsx scripts/rotate-encryption-key.ts [--dry-run]
 *   4. Once it reports success, drop the old key from TOKEN_ENCRYPTION_KEY_PREVIOUS
 *      in your real environment and restart the server.
 *
 * Each token is decrypted with whichever key still works (primary or previous)
 * and re-encrypted with the primary, preserving the per-row AAD binding. Rows
 * already on the primary key are rewritten harmlessly. Idempotent and safe to
 * re-run.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import config from "../src/config/env.js";
import { encryptSecret, decryptWithKeys, loadEncryptionKeys } from "../src/services/crypto.js";
import { normalizeCustomerId } from "../src/services/google-ads/resourceNames.js";

/** Mirror of db.ts's private AAD scheme: bind ciphertext to (org, MCC). */
function connectionAad(organizationId: string, mccCustomerId: string): string {
  return `conn:${organizationId}:${normalizeCustomerId(mccCustomerId)}`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }
  const keys = loadEncryptionKeys(config.TOKEN_ENCRYPTION_KEY, config.TOKEN_ENCRYPTION_KEY_PREVIOUS);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let rotated = 0;
  let failed = 0;
  try {
    const connections = await prisma.googleAdsConnection.findMany({
      select: { id: true, organizationId: true, mccCustomerId: true, refreshTokenEnc: true },
    });
    console.log(`Found ${connections.length} connection(s). ${dryRun ? "(dry run)" : ""}`);

    for (const conn of connections) {
      const aad = connectionAad(conn.organizationId, conn.mccCustomerId);
      try {
        const plaintext = decryptWithKeys(conn.refreshTokenEnc, keys.all, aad);
        const reEncrypted = encryptSecret(plaintext, keys.primary, aad);
        if (!dryRun) {
          await prisma.googleAdsConnection.update({
            where: { id: conn.id },
            data: { refreshTokenEnc: reEncrypted },
          });
        }
        rotated += 1;
      } catch (err) {
        failed += 1;
        console.error(`  ✗ ${conn.id}: ${(err as Error).message}`);
      }
    }
    console.log(`Done. Re-encrypted ${rotated}, failed ${failed}.`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
