import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to initialize Prisma with PostgreSQL.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export default prisma;

function normalizeCustomerId(customerId: string): string {
  return customerId.replace(/-/g, "");
}

export async function getUserCredentials(userId: string) {
  return prisma.googleAdsCredential.findUnique({
    where: { userId },
  });
}

export async function storeUserCredentials(userId: string, refreshToken: string) {
  return prisma.googleAdsCredential.upsert({
    where: { userId },
    update: { refreshToken },
    create: { userId, refreshToken },
  });
}

export async function associateAccount(userId: string, customerId: string) {
  const normalizedCustomerId = normalizeCustomerId(customerId);
  return prisma.accountAssociation.upsert({
    where: { 
      userId_customerId: { userId, customerId: normalizedCustomerId } 
    },
    update: {},
    create: { userId, customerId: normalizedCustomerId },
  });
}

export async function getUserAccounts(userId: string) {
  return prisma.accountAssociation.findMany({
    where: { userId },
    orderBy: { customerId: "asc" },
  });
}

export async function setSelectedAccounts(userId: string, customerIds: string[]) {
  const uniqueCustomerIds = [...new Set(customerIds.map(normalizeCustomerId))];

  await prisma.$transaction(async tx => {
    await tx.accountAssociation.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    if (uniqueCustomerIds.length > 0) {
      await tx.accountAssociation.updateMany({
        where: {
          userId,
          customerId: { in: uniqueCustomerIds },
        },
        data: { isDefault: true },
      });
    }
  });

  return getUserAccounts(userId);
}

export async function setSingleDefaultAccount(userId: string, customerId: string) {
  return setSelectedAccounts(userId, [customerId]);
}

export async function removeAccountAssociation(userId: string, customerId: string) {
  const normalizedCustomerId = normalizeCustomerId(customerId);

  await prisma.accountAssociation.deleteMany({
    where: {
      userId,
      customerId: normalizedCustomerId,
    },
  });

  return getUserAccounts(userId);
}

export async function canUseAccount(userId: string, customerId: string): Promise<boolean> {
  const normalizedCustomerId = normalizeCustomerId(customerId);

  const [accountAssociation, hasSelectionFilter] = await Promise.all([
    prisma.accountAssociation.findUnique({
      where: {
        userId_customerId: {
          userId,
          customerId: normalizedCustomerId,
        },
      },
    }),
    prisma.accountAssociation.count({
      where: {
        userId,
        isDefault: true,
      },
    }),
  ]);

  if (!accountAssociation) {
    return false;
  }

  if (hasSelectionFilter > 0 && !accountAssociation.isDefault) {
    return false;
  }

  return true;
}
