import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";

// --- Responsive Search Ads ---

const AdTextAssetSchema = z.object({
  text: z.string().describe("The text content"),
  pinnedField: z.enum(["HEADLINE_1", "HEADLINE_2", "HEADLINE_3", "DESCRIPTION_1", "DESCRIPTION_2"]).optional().describe("Pin this asset to a specific position"),
});

const CreateResponsiveSearchAdSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  adGroupId: z.string().describe("The Ad Group ID to add the ad to"),
  headlines: z.array(AdTextAssetSchema).min(3).max(15).describe("List of headlines (3-15)"),
  descriptions: z.array(AdTextAssetSchema).min(2).max(4).describe("List of descriptions (2-4)"),
  finalUrls: z.array(z.string()).describe("List of final URLs"),
  path1: z.string().optional().describe("Path 1 (display URL)"),
  path2: z.string().optional().describe("Path 2 (display URL)"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const CreateResponsiveSearchAdToolSchema = CreateResponsiveSearchAdSchema;
export async function createResponsiveSearchAd(args: z.infer<typeof CreateResponsiveSearchAdSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const adGroupResourceName = `customers/${args.customerId}/adGroups/${args.adGroupId}`;
  
  const operation = {
    ad_group_ad_operation: {
      create: {
        ad_group: adGroupResourceName,
        status: "ENABLED",
        ad: {
          responsive_search_ad: {
            headlines: args.headlines.map(h => ({
              text: h.text,
              pinned_field: h.pinnedField // This assumes pinnedField maps directly to API enum string
            })),
            descriptions: args.descriptions.map(d => ({
              text: d.text,
              pinned_field: d.pinnedField
            })),
            path1: args.path1,
            path2: args.path2,
          },
          final_urls: args.finalUrls,
        }
      }
    }
  };

  return runMutation(customer, [operation]);
}

// --- Ad Management ---

const PauseAdSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  adId: z.string().describe("The Ad ID"),
  adGroupId: z.string().describe("The Ad Group ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const PauseAdToolSchema = PauseAdSchema;
export async function pauseAd(args: z.infer<typeof PauseAdSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName = `customers/${args.customerId}/adGroupAds/${args.adGroupId}~${args.adId}`;
  
  const operation = {
    ad_group_ad_operation: {
      update: {
        resource_name: resourceName,
        status: "PAUSED"
      },
      update_mask: {
        paths: ["status"]
      }
    }
  };

  return runMutation(customer, [operation]);
}

const EnableAdSchema = PauseAdSchema;

export const EnableAdToolSchema = EnableAdSchema;
export async function enableAd(args: z.infer<typeof EnableAdSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName = `customers/${args.customerId}/adGroupAds/${args.adGroupId}~${args.adId}`;
  
  const operation = {
    ad_group_ad_operation: {
      update: {
        resource_name: resourceName,
        status: "ENABLED"
      },
      update_mask: {
        paths: ["status"]
      }
    }
  };

  return runMutation(customer, [operation]);
}

const RemoveAdSchema = PauseAdSchema;

export const RemoveAdToolSchema = RemoveAdSchema;
export async function removeAd(args: z.infer<typeof RemoveAdSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName = `customers/${args.customerId}/adGroupAds/${args.adGroupId}~${args.adId}`;
  
  const operation = {
    ad_group_ad_operation: {
      remove: resourceName
    }
  };

  return runMutation(customer, [operation]);
}
