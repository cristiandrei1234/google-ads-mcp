import { z } from "zod";
import prisma from "../services/db";
import logger from "../observability/logger";

const UserIdSchema = z.object({
  userId: z.string().describe("SaaS User ID"),
});

export const GetUserStatusToolSchema = UserIdSchema;
export async function getUserStatus(args: z.infer<typeof UserIdSchema>) {
  const { userId } = args;
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      credentials: true,
      accounts: true,
    }
  });

  if (!user) {
    throw new Error(`User ${userId} not found.`);
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isConnected: !!user.credentials,
    linkedAccounts: user.accounts.map(a => a.customerId),
    selectedAccounts: user.accounts.filter(a => a.isDefault).map(a => a.customerId),
  };
}

const ListAllUsersSchema = z.object({}); // For admin debugging
export async function listUsers() {
    return prisma.user.findMany({
        select: { id: true, email: true, name: true }
    });
}
