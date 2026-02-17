import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";

// Schema for status update operations
const CampaignStatusSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  campaignId: z.string().describe("The ID of the campaign to modify"),
  userId: z.string().optional().describe("SaaS User ID"),
});

// Helper to update campaign status
async function updateCampaignStatus(customerId: string, campaignId: string, status: string, userId?: string) {
  const customer = await getCustomer(customerId, userId);
  const resourceName = `customers/${customerId}/campaigns/${campaignId}`;
  
  const operation = {
    campaign_operation: {
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


export const PauseCampaignSchema = CampaignStatusSchema;
export async function pauseCampaign(args: z.infer<typeof PauseCampaignSchema>) {
  return updateCampaignStatus(args.customerId, args.campaignId, "PAUSED", args.userId);
}

export const EnableCampaignSchema = CampaignStatusSchema;
export async function enableCampaign(args: z.infer<typeof EnableCampaignSchema>) {
  return updateCampaignStatus(args.customerId, args.campaignId, "ENABLED", args.userId);
}

export const RemoveCampaignSchema = CampaignStatusSchema;
export async function removeCampaign(args: z.infer<typeof RemoveCampaignSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName = `customers/${args.customerId}/campaigns/${args.campaignId}`;

  const operation = {
    campaign_operation: {
      remove: resourceName,
    },
  };

  return runMutation(customer, [operation]);
}
