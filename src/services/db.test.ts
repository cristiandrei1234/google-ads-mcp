import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Env must be valid BEFORE the module graph (config/env.ts) is imported, since
// env.ts parses process.env at load time. A real 32-byte base64 key lets the
// crypto path encrypt/decrypt for real.
// ---------------------------------------------------------------------------
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";
process.env.TOKEN_ENCRYPTION_KEY = KEY_B64;
process.env.GOOGLE_ADS_CLIENT_ID = "cid";
process.env.GOOGLE_ADS_CLIENT_SECRET = "csecret";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "devtoken";

// Stub Prisma model methods we drive from tests. Declared via vi.hoisted so
// they exist before the hoisted vi.mock factories (and the import-time
// PrismaClient construction) reference them.
const m = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  findManyMock: vi.fn(),
  updateMock: vi.fn(),
  connFindFirstMock: vi.fn(),
  grantUpsertMock: vi.fn(),
  deleteManyMock: vi.fn(),
  grantFindFirstMock: vi.fn(),
  grantFindManyMock: vi.fn(),
  auditCreateMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
}));
const {
  upsertMock,
  findManyMock,
  updateMock,
  connFindFirstMock,
  grantUpsertMock,
  deleteManyMock,
  grantFindFirstMock,
  grantFindManyMock,
  auditCreateMock,
  userFindUniqueMock,
  memberFindManyMock,
  memberFindFirstMock,
} = m;

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.googleAdsConnection = {
      upsert: m.upsertMock,
      findMany: m.findManyMock,
      update: m.updateMock,
      findFirst: m.connFindFirstMock,
    };
    this.accountGrant = {
      findFirst: m.grantFindFirstMock,
      findMany: m.grantFindManyMock,
      upsert: m.grantUpsertMock,
      deleteMany: m.deleteManyMock,
    };
    this.auditLog = { create: m.auditCreateMock };
    this.user = { findUnique: m.userFindUniqueMock };
    this.member = { findMany: m.memberFindManyMock, findFirst: m.memberFindFirstMock };
  }),
}));

import {
  getPrisma,
  upsertConnection,
  getConnectionForCustomer,
  listConnectionsForUser,
  listConnectionsForOrg,
  getOrgConnection,
  listOrgMembers,
  memberInOrg,
  listGrantsForOrg,
  markConnectionReauthNeeded,
  addGrant,
  removeGrant,
  getGrantLevel,
  reachableCustomerIds,
  appendAuditLog,
  getUserStatusData,
} from "./db.js";
import { encryptSecret, loadEncryptionKey } from "./crypto.js";
import { PrismaPg } from "@prisma/adapter-pg";
import config from "../config/env.js";

// db.ts derives its key from config.TOKEN_ENCRYPTION_KEY. Use the SAME source
// here so ciphertexts we craft are decryptable by the module under test
// (dotenv precedence can otherwise make our local KEY_B64 diverge).
const KEY = loadEncryptionKey(config.TOKEN_ENCRYPTION_KEY ?? KEY_B64);

/** Build a versioned v2 ciphertext bound to a connection's AAD. */
function encConnToken(plaintext: string, organizationId: string, mccCustomerId: string): string {
  return encryptSecret(plaintext, KEY, `conn:${organizationId}:${mccCustomerId}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("db: lazy Prisma init", () => {
  // MUST stay the first test in the file: getPrisma() memoises per module
  // instance, so this is the only point where the construction is observable.
  it("constructs Prisma once, with a PrismaPg adapter from DATABASE_URL", () => {
    const client = getPrisma();
    expect(client).toBeDefined();
    const adapterCall = (PrismaPg as any).mock.calls[0]?.[0];
    expect(adapterCall).toBeTruthy();
    expect(typeof adapterCall.connectionString).toBe("string");
    expect(adapterCall.connectionString).toMatch(/^postgres/);
    // Memoised: a second call reuses the instance instead of reconnecting.
    expect(getPrisma()).toBe(client);
    expect((PrismaPg as any).mock.calls).toHaveLength(1);
  });

  it("throws on first use when DATABASE_URL is unset", async () => {
    vi.resetModules();
    // Bypass env.ts's own parse (which would otherwise throw first), and the
    // heavy boundaries, so we exercise db.ts's own guard in isolation.
    vi.doMock("../config/env.js", () => ({ default: { TOKEN_ENCRYPTION_KEY: KEY_B64 } }));
    vi.doMock("@prisma/client", () => ({ PrismaClient: vi.fn() }));
    vi.doMock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
    try {
      // Importing must NOT throw any more — only reaching a call site does.
      const { getPrisma: freshGetPrisma } = await import("./db.js");
      expect(() => freshGetPrisma()).toThrow(/requires DATABASE_URL/);
    } finally {
      vi.doUnmock("../config/env.js");
      vi.doUnmock("@prisma/client");
      vi.doUnmock("@prisma/adapter-pg");
      vi.resetModules();
    }
  });
});

describe("upsertConnection", () => {
  it("normalizes the MCC id, encrypts the token, and defaults isAgencyRoot to false", async () => {
    upsertMock.mockResolvedValue({ id: "c1" });
    const result = await upsertConnection({
      organizationId: "org1",
      ownerMemberId: "m1",
      label: "Main",
      mccCustomerId: "123-456-7890",
      refreshToken: "secret-token",
    });
    expect(result).toEqual({ id: "c1" });

    const arg = upsertMock.mock.calls[0][0];
    expect(arg.where.organizationId_mccCustomerId).toEqual({
      organizationId: "org1",
      mccCustomerId: "1234567890",
    });
    expect(arg.update.label).toBe("Main");
    expect(arg.update.ownerMemberId).toBe("m1");
    expect(arg.update.isAgencyRoot).toBe(false);
    expect(arg.create.isAgencyRoot).toBe(false);
    expect(arg.create.mccCustomerId).toBe("1234567890");
    // Token is encrypted (v2 scheme, not plaintext).
    expect(arg.create.refreshTokenEnc).toMatch(/^v2:/);
    expect(arg.create.refreshTokenEnc).not.toContain("secret-token");
    expect(arg.update.refreshTokenEnc).toMatch(/^v2:/);
  });

  it("honors an explicit isAgencyRoot=true", async () => {
    upsertMock.mockResolvedValue({ id: "c2" });
    await upsertConnection({
      organizationId: "org1",
      ownerMemberId: "m1",
      label: "Agency",
      mccCustomerId: "1234567890",
      refreshToken: "tok",
      isAgencyRoot: true,
    });
    const arg = upsertMock.mock.calls[0][0];
    expect(arg.update.isAgencyRoot).toBe(true);
    expect(arg.create.isAgencyRoot).toBe(true);
  });

  it("caches encryption keys across calls (getEncryptionKeys memoization)", async () => {
    upsertMock.mockResolvedValue({ id: "c3" });
    await upsertConnection({
      organizationId: "o", ownerMemberId: "m", label: "L", mccCustomerId: "1", refreshToken: "t",
    });
    await upsertConnection({
      organizationId: "o", ownerMemberId: "m", label: "L", mccCustomerId: "1", refreshToken: "t",
    });
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });
});

describe("markConnectionReauthNeeded", () => {
  it("sets status to reauth_required for the connection", async () => {
    updateMock.mockResolvedValue({ id: "c1", status: "reauth_required" });
    await markConnectionReauthNeeded("c1");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "reauth_required" },
    });
  });

  it("swallows errors (e.g. connection already deleted)", async () => {
    updateMock.mockRejectedValue(new Error("record not found"));
    await expect(markConnectionReauthNeeded("gone")).resolves.toBeUndefined();
  });
});

describe("listConnectionsForOrg", () => {
  it("returns org connections without secrets", async () => {
    findManyMock.mockResolvedValue([{ id: "c1", label: "Agency MCC", mccCustomerId: "1", status: "active" }]);
    const rows = await listConnectionsForOrg("org1");
    expect(rows).toEqual([{ id: "c1", label: "Agency MCC", mccCustomerId: "1", status: "active" }]);
    const arg = findManyMock.mock.calls[0][0];
    expect(arg.where).toEqual({ organizationId: "org1" });
    expect(arg.select.refreshTokenEnc).toBeUndefined();
  });
});

describe("getOrgConnection", () => {
  it("returns the decrypted token when the connection belongs to the org", async () => {
    connFindFirstMock.mockResolvedValue({
      id: "c1",
      organizationId: "org1",
      mccCustomerId: "1234567890",
      refreshTokenEnc: encConnToken("rt-secret", "org1", "1234567890"),
    });
    const resolved = await getOrgConnection("c1", "org1");
    expect(resolved).toMatchObject({ connectionId: "c1", mccCustomerId: "1234567890", refreshToken: "rt-secret", accessLevel: "ADMIN" });
  });

  it("returns null when not found in the org", async () => {
    connFindFirstMock.mockResolvedValue(null);
    expect(await getOrgConnection("c1", "org1")).toBeNull();
  });
});

describe("listOrgMembers", () => {
  it("returns members with their user email/name", async () => {
    memberFindManyMock.mockResolvedValue([{ id: "m1", userId: "u1", role: "admin", user: { email: "a@x.io", name: "A" } }]);
    const members = await listOrgMembers("org1");
    expect(members[0]).toMatchObject({ id: "m1", role: "admin", user: { email: "a@x.io" } });
    expect(memberFindManyMock.mock.calls[0][0].where).toEqual({ organizationId: "org1" });
  });
});

describe("listGrantsForOrg", () => {
  it("flattens member email and connection label into each grant", async () => {
    grantFindManyMock.mockResolvedValue([
      {
        memberId: "m1",
        connectionId: "c1",
        customerId: "1234567890",
        accessLevel: "WRITE",
        member: { user: { email: "a@x.io" } },
        connection: { label: "Agency MCC" },
      },
    ]);
    const grants = await listGrantsForOrg("org1");
    expect(grants).toEqual([
      {
        memberId: "m1",
        memberEmail: "a@x.io",
        connectionId: "c1",
        connectionLabel: "Agency MCC",
        customerId: "1234567890",
        accessLevel: "WRITE",
      },
    ]);
    expect(grantFindManyMock.mock.calls[0][0].where).toEqual({ connection: { organizationId: "org1" } });
  });
});

describe("memberInOrg", () => {
  it("is true when the member belongs to the org", async () => {
    memberFindFirstMock.mockResolvedValue({ id: "m1" });
    expect(await memberInOrg("m1", "org1")).toBe(true);
  });

  it("is false otherwise", async () => {
    memberFindFirstMock.mockResolvedValue(null);
    expect(await memberInOrg("m1", "org9")).toBe(false);
  });
});

describe("getConnectionForCustomer", () => {
  it("returns null when no grant exists", async () => {
    grantFindFirstMock.mockResolvedValue(null);
    const res = await getConnectionForCustomer("u1", "123-456-7890");
    expect(res).toBeNull();
    // No orgId -> member filter has only userId.
    const where = grantFindFirstMock.mock.calls[0][0].where;
    expect(where.customerId).toBe("1234567890");
    expect(where.member).toEqual({ userId: "u1" });
  });

  it("resolves and decrypts the connection token (with orgId filter)", async () => {
    const enc = encConnToken("refresh-xyz", "org9", "5550001111");
    grantFindFirstMock.mockResolvedValue({
      connectionId: "conn1",
      accessLevel: "ADMIN",
      connection: {
        mccCustomerId: "5550001111",
        organizationId: "org9",
        refreshTokenEnc: enc,
      },
    });
    const res = await getConnectionForCustomer("u1", "5550001111", "org9");
    expect(res).toEqual({
      connectionId: "conn1",
      mccCustomerId: "5550001111",
      refreshToken: "refresh-xyz",
      accessLevel: "ADMIN",
    });
    const where = grantFindFirstMock.mock.calls[0][0].where;
    expect(where.member).toEqual({ userId: "u1", organizationId: "org9" });
  });

  it("ignores orgId when it is null (falls back to userId-only filter)", async () => {
    grantFindFirstMock.mockResolvedValue(null);
    await getConnectionForCustomer("u1", "1", null);
    expect(grantFindFirstMock.mock.calls[0][0].where.member).toEqual({ userId: "u1" });
  });
});

describe("listConnectionsForUser", () => {
  it("decrypts each connection token and maps to the public shape", async () => {
    const encA = encConnToken("tok-a", "orgA", "1111111111");
    const encB = encConnToken("tok-b", "orgB", "2222222222");
    findManyMock.mockResolvedValue([
      { id: "a", mccCustomerId: "1111111111", organizationId: "orgA", refreshTokenEnc: encA, label: "A" },
      { id: "b", mccCustomerId: "2222222222", organizationId: "orgB", refreshTokenEnc: encB, label: "B" },
    ]);
    const res = await listConnectionsForUser("u1", "orgA");
    expect(res).toEqual([
      { connectionId: "a", mccCustomerId: "1111111111", refreshToken: "tok-a", label: "A" },
      { connectionId: "b", mccCustomerId: "2222222222", refreshToken: "tok-b", label: "B" },
    ]);
    expect(findManyMock.mock.calls[0][0].where.owner).toEqual({ userId: "u1", organizationId: "orgA" });
  });

  it("omits org filter when orgId is undefined and returns empty list", async () => {
    findManyMock.mockResolvedValue([]);
    const res = await listConnectionsForUser("u1");
    expect(res).toEqual([]);
    expect(findManyMock.mock.calls[0][0].where.owner).toEqual({ userId: "u1" });
  });
});

describe("addGrant", () => {
  it("defaults accessLevel to READ when not supplied", async () => {
    grantUpsertMock.mockResolvedValue({ id: "g1" });
    await addGrant({ memberId: "m1", connectionId: "c1", customerId: "123-456-7890" });
    const arg = grantUpsertMock.mock.calls[0][0];
    expect(arg.where.memberId_connectionId_customerId).toEqual({
      memberId: "m1",
      connectionId: "c1",
      customerId: "1234567890",
    });
    expect(arg.update.accessLevel).toBe("READ");
    expect(arg.create.accessLevel).toBe("READ");
    expect(arg.create.customerId).toBe("1234567890");
  });

  it("uses the explicit accessLevel when provided", async () => {
    grantUpsertMock.mockResolvedValue({ id: "g2" });
    await addGrant({ memberId: "m1", connectionId: "c1", customerId: "1", accessLevel: "ADMIN" });
    const arg = grantUpsertMock.mock.calls[0][0];
    expect(arg.update.accessLevel).toBe("ADMIN");
    expect(arg.create.accessLevel).toBe("ADMIN");
  });
});

describe("removeGrant", () => {
  it("deletes by member/connection/normalized customer id", async () => {
    deleteManyMock.mockResolvedValue({ count: 1 });
    await removeGrant("m1", "c1", "123-456-7890");
    expect(deleteManyMock.mock.calls[0][0].where).toEqual({
      memberId: "m1",
      connectionId: "c1",
      customerId: "1234567890",
    });
  });
});

describe("getGrantLevel", () => {
  it("returns the access level when a grant exists", async () => {
    grantFindFirstMock.mockResolvedValue({ accessLevel: "ADMIN" });
    const level = await getGrantLevel("u1", "1", "org1");
    expect(level).toBe("ADMIN");
    expect(grantFindFirstMock.mock.calls[0][0].where.member).toEqual({ userId: "u1", organizationId: "org1" });
  });

  it("returns null when there is no grant (nullish coalescing branch)", async () => {
    grantFindFirstMock.mockResolvedValue(null);
    const level = await getGrantLevel("u1", "1");
    expect(level).toBeNull();
    expect(grantFindFirstMock.mock.calls[0][0].where.member).toEqual({ userId: "u1" });
  });
});

describe("reachableCustomerIds", () => {
  it("maps distinct grant customerIds (with orgId)", async () => {
    grantFindManyMock.mockResolvedValue([{ customerId: "111" }, { customerId: "222" }]);
    const ids = await reachableCustomerIds("u1", "org1");
    expect(ids).toEqual(["111", "222"]);
    expect(grantFindManyMock.mock.calls[0][0].where.member).toEqual({ userId: "u1", organizationId: "org1" });
  });

  it("works without an orgId", async () => {
    grantFindManyMock.mockResolvedValue([]);
    const ids = await reachableCustomerIds("u1");
    expect(ids).toEqual([]);
    expect(grantFindManyMock.mock.calls[0][0].where.member).toEqual({ userId: "u1" });
  });
});

describe("appendAuditLog", () => {
  it("writes with all optional fields supplied and normalized customerId", async () => {
    auditCreateMock.mockResolvedValue({ id: "a1" });
    await appendAuditLog({
      organizationId: "org1",
      memberId: "m1",
      userId: "u1",
      tool: "create_campaign",
      customerId: "123-456-7890",
      outcome: "ok",
      errorKind: "none",
      argsSummary: { foo: "bar" },
    });
    const data = auditCreateMock.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: "org1",
      memberId: "m1",
      userId: "u1",
      tool: "create_campaign",
      customerId: "1234567890",
      outcome: "ok",
      errorKind: "none",
      argsSummary: { foo: "bar" },
    });
  });

  it("nullifies missing optional fields and leaves argsSummary undefined", async () => {
    auditCreateMock.mockResolvedValue({ id: "a2" });
    await appendAuditLog({ organizationId: "org1", tool: "t", outcome: "error" });
    const data = auditCreateMock.mock.calls[0][0].data;
    expect(data.memberId).toBeNull();
    expect(data.userId).toBeNull();
    expect(data.customerId).toBeNull();
    expect(data.errorKind).toBeNull();
    expect(data.argsSummary).toBeUndefined();
  });
});

describe("getUserStatusData", () => {
  it("returns null when the user does not exist", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const res = await getUserStatusData("missing");
    expect(res).toBeNull();
  });

  it("shapes the membership read model when the user exists", async () => {
    userFindUniqueMock.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      members: [
        {
          organization: { id: "org1", name: "Org One" },
          role: "OWNER",
          ownedConnections: [{ id: "c1", label: "L", mccCustomerId: "1", isAgencyRoot: true }],
          grants: [{ customerId: "111", accessLevel: "READ" }],
        },
      ],
    });
    const res = await getUserStatusData("u1");
    expect(res).toEqual({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      memberships: [
        {
          organization: { id: "org1", name: "Org One" },
          role: "OWNER",
          connections: [{ id: "c1", label: "L", mccCustomerId: "1", isAgencyRoot: true }],
          grants: [{ customerId: "111", accessLevel: "READ" }],
        },
      ],
    });
    expect(userFindUniqueMock.mock.calls[0][0].where).toEqual({ id: "u1" });
  });
});
