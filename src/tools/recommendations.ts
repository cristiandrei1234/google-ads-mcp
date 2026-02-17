import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";
import { toErrorMessage } from "../observability/errorMessage";

const ListRecommendationsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  limit: z.number().optional().default(50).describe("Max number of recommendations to retrieve"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListRecommendationsToolSchema = ListRecommendationsSchema;
export async function listRecommendations(args: z.infer<typeof ListRecommendationsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const query = `
    SELECT 
      recommendation.resource_name,
      recommendation.type,
      recommendation.impact,
      recommendation.campaign,
      recommendation.ad_group
    FROM recommendation
    LIMIT ${args.limit}
  `;
  
  const result = await customer.query(query);
  return result;
}

const ApplyRecommendationSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  recommendationResourceName: z.string().describe("The resource name of the recommendation to apply"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ApplyRecommendationToolSchema = ApplyRecommendationSchema;
export async function applyRecommendation(args: z.infer<typeof ApplyRecommendationSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  // recommendation_service.apply_recommendation
  
  const operation = {
    resource_name: args.recommendationResourceName,
    // Some recommendations require parameters, but many don't.
    // Supporting simple apply for now.
  };

  try {
    const result = await customer.recommendations.applyRecommendation({
      customer_id: args.customerId,
      operations: [operation],
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to apply recommendation: ${toErrorMessage(error)}`);
    throw error;
  }
}

const DismissRecommendationSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  recommendationResourceName: z.string().describe("The resource name of the recommendation to dismiss"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const DismissRecommendationToolSchema = DismissRecommendationSchema;
export async function dismissRecommendation(args: z.infer<typeof DismissRecommendationSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  const operation = {
    resource_name: args.recommendationResourceName,
  };

  try {
    const result = await customer.recommendations.dismissRecommendation({
      customer_id: args.customerId,
      operations: [operation],
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to dismiss recommendation: ${toErrorMessage(error)}`);
    throw error;
  }
}
