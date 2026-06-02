import "dotenv/config";
import { PrismaClient, type AccessLevel, type GoogleAdsConnection } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import config from "../config/env.js";
import { encryptSecret, decryptWithKeys, loadEncryptionKeys, type EncryptionKeys } from "./crypto.js";
import { normalizeCustomerId } from "./google-ads/resourceNames.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to initialize Prisma with PostgreSQL.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export default prisma;

let cachedKeys: EncryptionKeys | undefined;

/**
 * Resolve the at-rest encryption keys (primary + previous for rotation),
 * validated once and cached.
 * @throws {CryptoError} `invalid_key` if a key is missing/invalid.
 */
function getEncryptionKeys(): EncryptionKeys {
  if (!cachedKeys) {
    cachedKeys = loadEncryptionKeys(config.TOKEN_ENCRYPTION_KEY, config.TOKEN_ENCRYPTION_KEY_PREVIOUS);
  }
  return cachedKeys;
}

/**
 * AAD binding a connection's encrypted token to its row. The pair
 * (organizationId, mccCustomerId) is unique, so a ciphertext copied into another
 * connection row fails decryption.
 */
function connectionAad(organizationId: string, mccCustomerId: string): string {
  return `conn:${organizationId}:${normalizeCustomerId(mccCustomerId)}`;
}

/** Decrypt a connection's refresh token, binding the AAD to its org + MCC. */
function decryptConnectionToken(
  connection: Pick<GoogleAdsConnection, "refreshTokenEnc" | "organizationId" | "mccCustomerId">,
  keys: EncryptionKeys
): string {
  return decryptWithKeys(
    connection.refreshTokenEnc,
    keys.all,
    connectionAad(connection.organizationId, connection.mccCustomerId)
  );
}

// ---------------------------------------------------------------------------
// Connections (one MCC + encrypted refresh token, owned by a member)
// ---------------------------------------------------------------------------

export interface CreateConnectionInput {
  organizationId: string;
  ownerMemberId: string;
  label: string;
  mccCustomerId: string;
  /** Plaintext Google OAuth refresh token; encrypted before storage. */
  refreshToken: string;
  isAgencyRoot?: boolean;
}

/** Create (or update by org+MCC) a Google Ads connection with an encrypted token. */
export async function upsertConnection(input: CreateConnectionInput): Promise<GoogleAdsConnection> {
  const mccCustomerId = normalizeCustomerId(input.mccCustomerId);
  const refreshTokenEnc = encryptSecret(
    input.refreshToken,
    getEncryptionKeys().primary,
    connectionAad(input.organizationId, mccCustomerId)
  );
  return prisma.googleAdsConnection.upsert({
    where: {
      organizationId_mccCustomerId: {
        organizationId: input.organizationId,
        mccCustomerId,
      },
    },
    update: {
      label: input.label,
      refreshTokenEnc,
      ownerMemberId: input.ownerMemberId,
      isAgencyRoot: input.isAgencyRoot ?? false,
    },
    create: {
      organizationId: input.organizationId,
      ownerMemberId: input.ownerMemberId,
      label: input.label,
      mccCustomerId,
      refreshTokenEnc,
      isAgencyRoot: input.isAgencyRoot ?? false,
    },
  });
}

export interface ResolvedConnection {
  connectionId: string;
  mccCustomerId: string;
  /** Decrypted refresh token — keep in memory only, never log or persist. */
  refreshToken: string;
  accessLevel: AccessLevel;
}

/**
 * Resolve the connection a user may use to act on a client account.
 *
 * A user (via any of their org memberships) must hold an AccountGrant for the
 * target customerId. Returns the owning connection with its decrypted token,
 * or null if no grant exists.
 */
export async function getConnectionForCustomer(
  userId: string,
  customerId: string,
  orgId?: string | null
): Promise<ResolvedConnection | null> {
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const grant = await prisma.accountGrant.findFirst({
    where: {
      customerId: normalizedCustomerId,
      member: { userId, ...(orgId ? { organizationId: orgId } : {}) },
    },
    include: { connection: true },
    orderBy: { accessLevel: "desc" },
  });

  if (!grant) {
    return null;
  }

  return {
    connectionId: grant.connectionId,
    mccCustomerId: grant.connection.mccCustomerId,
    refreshToken: decryptConnectionToken(grant.connection, getEncryptionKeys()),
    accessLevel: grant.accessLevel,
  };
}

/** List connections owned by any of a user's memberships (tokens decrypted). */
export async function listConnectionsForUser(
  userId: string,
  orgId?: string | null
): Promise<Array<{ connectionId: string; mccCustomerId: string; refreshToken: string; label: string }>> {
  const connections = await prisma.googleAdsConnection.findMany({
    where: { owner: { userId, ...(orgId ? { organizationId: orgId } : {}) } },
    orderBy: { createdAt: "asc" },
  });
  const keys = getEncryptionKeys();
  return connections.map((c) => ({
    connectionId: c.id,
    mccCustomerId: c.mccCustomerId,
    refreshToken: decryptConnectionToken(c, keys),
    label: c.label,
  }));
}

// ---------------------------------------------------------------------------
// Grants (which client accounts a member may act on, and at what level)
// ---------------------------------------------------------------------------

export interface AddGrantInput {
  memberId: string;
  connectionId: string;
  customerId: string;
  accessLevel?: AccessLevel;
}

export async function addGrant(input: AddGrantInput) {
  const customerId = normalizeCustomerId(input.customerId);
  return prisma.accountGrant.upsert({
    where: {
      memberId_connectionId_customerId: {
        memberId: input.memberId,
        connectionId: input.connectionId,
        customerId,
      },
    },
    update: { accessLevel: input.accessLevel ?? "READ" },
    create: {
      memberId: input.memberId,
      connectionId: input.connectionId,
      customerId,
      accessLevel: input.accessLevel ?? "READ",
    },
  });
}

export async function removeGrant(memberId: string, connectionId: string, customerId: string) {
  return prisma.accountGrant.deleteMany({
    where: { memberId, connectionId, customerId: normalizeCustomerId(customerId) },
  });
}

/** The highest access level a user holds for a customer, or null if no grant. */
export async function getGrantLevel(
  userId: string,
  customerId: string,
  orgId?: string | null
): Promise<AccessLevel | null> {
  const grant = await prisma.accountGrant.findFirst({
    where: {
      customerId: normalizeCustomerId(customerId),
      member: { userId, ...(orgId ? { organizationId: orgId } : {}) },
    },
    orderBy: { accessLevel: "desc" },
    select: { accessLevel: true },
  });
  return grant?.accessLevel ?? null;
}

/** All client customerIds a user may act on within the active org (or across all). */
export async function reachableCustomerIds(userId: string, orgId?: string | null): Promise<string[]> {
  const grants = await prisma.accountGrant.findMany({
    where: { member: { userId, ...(orgId ? { organizationId: orgId } : {}) } },
    select: { customerId: true },
    distinct: ["customerId"],
    orderBy: { customerId: "asc" },
  });
  return grants.map((g) => g.customerId);
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export interface AuditEntry {
  organizationId: string;
  memberId?: string | null;
  userId?: string | null;
  tool: string;
  customerId?: string | null;
  outcome: "ok" | "error" | "denied";
  errorKind?: string | null;
  argsSummary?: unknown;
}

export async function appendAuditLog(entry: AuditEntry) {
  return prisma.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      memberId: entry.memberId ?? null,
      userId: entry.userId ?? null,
      tool: entry.tool,
      customerId: entry.customerId ? normalizeCustomerId(entry.customerId) : null,
      outcome: entry.outcome,
      errorKind: entry.errorKind ?? null,
      argsSummary:
        entry.argsSummary === undefined ? undefined : (entry.argsSummary as object),
    },
  });
}

// ---------------------------------------------------------------------------
// User status (read model for admin/get_user_status)
// ---------------------------------------------------------------------------

export async function getUserStatusData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      members: {
        include: {
          organization: { select: { id: true, name: true } },
          ownedConnections: { select: { id: true, label: true, mccCustomerId: true, isAgencyRoot: true } },
          grants: { select: { customerId: true, accessLevel: true } },
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    memberships: user.members.map((m) => ({
      organization: m.organization,
      role: m.role,
      connections: m.ownedConnections,
      grants: m.grants,
    })),
  };
}
