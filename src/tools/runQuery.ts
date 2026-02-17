import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";

export const RunQuerySchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID (without dashes)"),
  query: z.string().describe(" The GAQL query to execute"),
  userId: z.string().optional().describe("SaaS User ID (if using multi-tenant mode)"),
});

export async function runQuery(args: z.infer<typeof RunQuerySchema>) {
  const { customerId, query, userId } = args;
  logger.info(`Running query for customer ${customerId}${userId ? ` (user: ${userId})` : ''}: ${query}`);
  
  try {
    const customer = await getCustomer(customerId, userId);
    const result = await customer.query(query);
    return result;
  } catch (error: any) {
    logger.error(`Query failed: ${error.message}`);
    throw error;
  }
}
