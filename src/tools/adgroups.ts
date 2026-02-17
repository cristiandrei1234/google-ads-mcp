import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";

// Schema for status update operations
const AdGroupStatusSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  adGroupId: z.string().describe("The ID of the ad group to modify"),
  userId: z.string().optional().describe("SaaS User ID"),
});

// Helper to update ad group status
async function updateAdGroupStatus(customerId: string, adGroupId: string, status: string, userId?: string) {
  const customer = await getCustomer(customerId, userId);
  const resourceName = `customers/${customerId}/adGroups/${adGroupId}`;
  
  const operation = {
    ad_group_operation: {
      update: {
        resource_name: resourceName,
        status: status,
      },
      update_mask: {
        paths: ["status"]
      }
    }
  };

  return runMutation(customer, [operation]);
}

export const PauseAdGroupSchema = AdGroupStatusSchema;
export async function pauseAdGroup(args: z.infer<typeof PauseAdGroupSchema>) {
  return updateAdGroupStatus(args.customerId, args.adGroupId, "PAUSED", args.userId);
}

export const EnableAdGroupSchema = AdGroupStatusSchema;
export async function enableAdGroup(args: z.infer<typeof EnableAdGroupSchema>) {
  return updateAdGroupStatus(args.customerId, args.adGroupId, "ENABLED", args.userId);
}

export const RemoveAdGroupSchema = AdGroupStatusSchema;
export async function removeAdGroup(args: z.infer<typeof RemoveAdGroupSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName = `customers/${args.customerId}/adGroups/${args.adGroupId}`;

  const operation = {
    ad_group_operation: {
      remove: resourceName,
    },
  };

  return runMutation(customer, [operation]);
}
