import { z } from "zod";

const TargetUserSchema = z.object({
  targetUserId: z.string().describe("ID of the user to inspect (admin only)."),
});

export const GetUserStatusToolSchema = TargetUserSchema;

/**
 * Report a user's org memberships, owned connections (MCCs) and account grants.
 *
 * The database module is imported on demand: these admin tools are the only
 * reason a single-operator (stdio) process would ever load Prisma, and it is
 * not registered there at all.
 */
export async function getUserStatus(args: z.infer<typeof TargetUserSchema>) {
  const { getUserStatusData } = await import("../services/db.js");
  const status = await getUserStatusData(args.targetUserId);
  if (!status) {
    throw new Error(`User ${args.targetUserId} not found.`);
  }
  return status;
}

export async function listUsers() {
  const { getPrisma } = await import("../services/db.js");
  return getPrisma().user.findMany({
    select: { id: true, email: true, name: true },
  });
}
