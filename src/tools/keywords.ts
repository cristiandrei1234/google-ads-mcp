import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";

const KeywordStatusSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  keywordId: z.string().describe("The ID of the keyword (criterion ID) to modify"),
  adGroupId: z.string().describe("The ID of the ad group containing the keyword"),
  userId: z.string().optional().describe("SaaS User ID"),
});

const AddKeywordSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  adGroupId: z.string().describe("The ID of the ad group to add the keyword to"),
  text: z.string().describe("The keyword text"),
  matchType: z.enum(["BROAD", "PHRASE", "EXACT"]).describe("The match type for the keyword"),
  userId: z.string().optional().describe("SaaS User ID"),
});

async function updateKeywordStatus(
  customerId: string,
  adGroupId: string,
  keywordId: string,
  status: string,
  userId?: string
) {
  const customer = await getCustomer(customerId, userId);
  const resourceName = `customers/${customerId}/adGroupCriteria/${adGroupId}~${keywordId}`;
  
  const operation = {
    ad_group_criterion_operation: {
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

export const AddKeywordToolSchema = AddKeywordSchema;
export async function addKeyword(args: z.infer<typeof AddKeywordSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const adGroupResourceName = `customers/${args.customerId}/adGroups/${args.adGroupId}`;
  
  const operation = {
    ad_group_criterion_operation: {
      create: {
        ad_group: adGroupResourceName,
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

export const PauseKeywordSchema = KeywordStatusSchema;
export async function pauseKeyword(args: z.infer<typeof PauseKeywordSchema>) {
  return updateKeywordStatus(args.customerId, args.adGroupId, args.keywordId, "PAUSED", args.userId);
}

export const EnableKeywordSchema = KeywordStatusSchema;
export async function enableKeyword(args: z.infer<typeof EnableKeywordSchema>) {
  return updateKeywordStatus(args.customerId, args.adGroupId, args.keywordId, "ENABLED", args.userId);
}

export const RemoveKeywordSchema = KeywordStatusSchema;
export async function removeKeyword(args: z.infer<typeof RemoveKeywordSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const resourceName = `customers/${args.customerId}/adGroupCriteria/${args.adGroupId}~${args.keywordId}`;

  const operation = {
    ad_group_criterion_operation: {
      remove: resourceName,
    },
  };

  return runMutation(customer, [operation]);
}
