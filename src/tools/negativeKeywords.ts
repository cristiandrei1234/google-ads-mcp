import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";

// --- Ad Group Level Negatives ---

const AddAdGroupNegativeKeywordSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  adGroupId: z.string().describe("The ID of the ad group"),
  text: z.string().describe("The negative keyword text"),
  matchType: z.enum(["BROAD", "PHRASE", "EXACT"]).describe("The match type"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const AddAdGroupNegativeKeywordToolSchema = AddAdGroupNegativeKeywordSchema;
export async function addAdGroupNegativeKeyword(args: z.infer<typeof AddAdGroupNegativeKeywordSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const adGroupResourceName = `customers/${args.customerId}/adGroups/${args.adGroupId}`;
  
  const operation = {
    ad_group_criterion_operation: {
      create: {
        ad_group: adGroupResourceName,
        negative: true,
        keyword: {
          text: args.text,
          match_type: args.matchType,
        },
        status: "ENABLED"
      }
    }
  };

  return runMutation(customer, [operation]);
}

const RemoveAdGroupNegativeKeywordSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  adGroupId: z.string().describe("The ID of the ad group"),
  criterionId: z.string().describe("The ID of the negative keyword criterion to remove"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const RemoveAdGroupNegativeKeywordToolSchema = RemoveAdGroupNegativeKeywordSchema;
export async function removeAdGroupNegativeKeyword(args: z.infer<typeof RemoveAdGroupNegativeKeywordSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName = `customers/${args.customerId}/adGroupCriteria/${args.adGroupId}~${args.criterionId}`;
  
  const operation = {
    ad_group_criterion_operation: {
      remove: resourceName
    }
  };

  return runMutation(customer, [operation]);
}

// --- Campaign Level Negatives ---

const AddCampaignNegativeKeywordSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  campaignId: z.string().describe("The ID of the campaign"),
  text: z.string().describe("The negative keyword text"),
  matchType: z.enum(["BROAD", "PHRASE", "EXACT"]).describe("The match type"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const AddCampaignNegativeKeywordToolSchema = AddCampaignNegativeKeywordSchema;
export async function addCampaignNegativeKeyword(args: z.infer<typeof AddCampaignNegativeKeywordSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const campaignResourceName = `customers/${args.customerId}/campaigns/${args.campaignId}`;
  
  const operation = {
    campaign_criterion_operation: {
      create: {
        campaign: campaignResourceName,
        negative: true,
        keyword: {
          text: args.text,
          match_type: args.matchType,
        },
        status: "ENABLED"
      }
    }
  };

  return runMutation(customer, [operation]);
}

const RemoveCampaignNegativeKeywordSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  campaignId: z.string().describe("The ID of the campaign"),
  criterionId: z.string().describe("The ID of the negative keyword criterion to remove"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const RemoveCampaignNegativeKeywordToolSchema = RemoveCampaignNegativeKeywordSchema;
export async function removeCampaignNegativeKeyword(args: z.infer<typeof RemoveCampaignNegativeKeywordSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName = `customers/${args.customerId}/campaignCriteria/${args.campaignId}~${args.criterionId}`;
  
  const operation = {
    campaign_criterion_operation: {
      remove: resourceName
    }
  };

  return runMutation(customer, [operation]);
}
