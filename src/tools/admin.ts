import { z } from "zod";
import prisma, { getUserStatusData } from "../services/db.js";

const TargetUserSchema = z.object({
  targetUserId: z.string().describe("ID of the user to inspect (admin only)."),
});

export const GetUserStatusToolSchema = TargetUserSchema;

/** Report a user's org memberships, owned connections (MCCs) and account grants. */
export async function getUserStatus(args: z.infer<typeof TargetUserSchema>) {
  const status = await getUserStatusData(args.targetUserId);
  if (!status) {
    throw new Error(`User ${args.targetUserId} not found.`);
  }
  return status;
}

export async function listUsers() {
  return prisma.user.findMany({
    select: { id: true, email: true, name: true },
  });
}
