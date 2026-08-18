import { z } from "zod";
import { getCustomer } from "../services/google-ads/client.js";
import { assertSafeGaqlStatement, withDefaultLimit } from "../policies/gaql.js";
import logger from "../observability/logger.js";

export const RunQuerySchema = z.object({
  customerId: z.string().describe("Google Ads customer ID, digits only (no dashes)."),
  query: z
    .string()
    .describe(
      "GAQL statement to execute. Read-only. Without a LIMIT clause one is added automatically."
    ),
});

/** Run a caller-supplied GAQL statement against one account. */
export async function runQuery(args: z.infer<typeof RunQuerySchema>) {
  const { customerId } = args;
  assertSafeGaqlStatement(args.query);
  const query = withDefaultLimit(args.query);
  logger.info(`Running query for customer ${customerId}: ${query}`);

  try {
    const customer = await getCustomer(customerId);
    const result = await customer.query(query);
    return result;
  } catch (error: any) {
    logger.error(`Query failed: ${error.message}`);
    throw error;
  }
}
