import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";
import { toErrorMessage } from "../observability/errorMessage";

const IdentityVerificationSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const StartIdentityVerificationToolSchema = IdentityVerificationSchema;
export async function startIdentityVerification(args: z.infer<typeof IdentityVerificationSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  try {
    const result = await customer.identityVerifications.startIdentityVerification({
      customer_id: args.customerId,
      verification_program: "ADVERTISER_IDENTITY_VERIFICATION",
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to start identity verification: ${toErrorMessage(error)}`);
    throw error;
  }
}

export const GetIdentityVerificationToolSchema = IdentityVerificationSchema;
export async function getIdentityVerification(args: z.infer<typeof IdentityVerificationSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  try {
    const result = await customer.identityVerifications.getIdentityVerification({
      customer_id: args.customerId,
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to get identity verification: ${toErrorMessage(error)}`);
    throw error;
  }
}
