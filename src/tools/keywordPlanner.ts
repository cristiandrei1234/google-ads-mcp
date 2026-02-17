import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";

const GenerateKeywordIdeasSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  keywordTexts: z.array(z.string()).optional().describe("List of keywords to use as seeds"),
  url: z.string().optional().describe("URL to crawl for ideas (specific page)"),
  site: z.string().optional().describe("Site domain to crawl for ideas (e.g. 'example.com')"),
  languageId: z.string().default("1000").describe("Language constant ID (default 1000 for English)"),
  geoTargetConstants: z.array(z.string()).optional().describe("Resource names of geo targets (e.g. 'geoTargetConstants/2840' for US)"),
  includeAdultKeywords: z.boolean().default(false).describe("Include adult keywords"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const GenerateKeywordIdeasToolSchema = GenerateKeywordIdeasSchema;
export async function generateKeywordIdeas(args: z.infer<typeof GenerateKeywordIdeasSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  const request: any = {
    customer_id: args.customerId,
    language: `languageConstants/${args.languageId}`,
    include_adult_keywords: args.includeAdultKeywords,
    keyword_plan_network: "GOOGLE_SEARCH_AND_PARTNERS",
    geo_target_constants: args.geoTargetConstants || [],
  };

  if (args.keywordTexts && args.keywordTexts.length > 0) {
    request.keyword_seed = { keywords: args.keywordTexts };
  } else if (args.url) {
    request.url_seed = { url: args.url };
  } else if (args.site) {
    request.site_seed = { site: args.site };
  } else {
    throw new Error("Must provide either keywordTexts, url, or site");
  }

  logger.info(`Generating keyword ideas for customer ${args.customerId}`);

  try {
    const result = await customer.keywordPlanIdeas.generateKeywordIdeas(request);
    return result;
  } catch (error: any) {
    logger.error(`Failed to generate keyword ideas: ${error.message}`);
    throw error;
  }
}
