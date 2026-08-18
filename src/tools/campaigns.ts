import { z } from "zod";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import logger from "../observability/logger.js";

// Schema for status update operations
const CampaignStatusSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  campaignId: z.string().describe("The ID of the campaign to modify"),
});

// Helper to update campaign status
async function updateCampaignStatus(customerId: string, campaignId: string, status: string) {
  const customer = await getCustomer(customerId);
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
  return updateCampaignStatus(args.customerId, args.campaignId, "PAUSED");
}

export const EnableCampaignSchema = CampaignStatusSchema;
export async function enableCampaign(args: z.infer<typeof EnableCampaignSchema>) {
  return updateCampaignStatus(args.customerId, args.campaignId, "ENABLED");
}

export const RemoveCampaignSchema = CampaignStatusSchema;
export async function removeCampaign(args: z.infer<typeof RemoveCampaignSchema>) {
  const customer = await getCustomer(args.customerId);
  const resourceName = `customers/${args.customerId}/campaigns/${args.campaignId}`;

  const operation = {
    campaign_operation: {
      remove: resourceName,
    },
  };

  return runMutation(customer, [operation]);
}
