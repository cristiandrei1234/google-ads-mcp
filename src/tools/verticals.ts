import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";
import { toErrorMessage } from "../observability/errorMessage";

const AudienceInsightsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  customerInsightsGroup: z.string().describe("The name of the customer insights group"),
  dimensions: z
    .array(z.string())
    .min(1)
    .default(["AFFINITY_USER_INTEREST"])
    .describe("Audience insights dimensions."),
  queryText: z.string().optional().describe("Optional query text filter."),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListAudienceInsightsToolSchema = AudienceInsightsSchema;
export async function listAudienceInsights(args: z.infer<typeof AudienceInsightsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  try {
    const request: Record<string, unknown> = {
      customer_id: args.customerId,
      customer_insights_group: args.customerInsightsGroup,
      dimensions: args.dimensions,
    };
    if (args.queryText) {
      request.query_text = args.queryText;
    }

    // Note: Audience Insights requires allowlisting and can fail on non-enabled accounts.
    const result = await (customer as any).audienceInsights.listAudienceInsightsAttributes(request);
    return result;
  } catch (error: any) {
    logger.error(`Failed to generate audience insights: ${toErrorMessage(error)}`);
    throw error;
  }
}

// --- Travel/Hotel Reports ---

const ListHotelPerformanceSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  fields: z
    .array(z.string())
    .min(1)
    .default(["segments.partner_hotel_id", "campaign.name"])
    .describe("GAQL select fields for hotel_performance_view"),
  where: z.string().optional().describe("Optional GAQL filter expression without WHERE."),
  orderBy: z.string().optional().describe("Optional GAQL ORDER BY expression without ORDER BY."),
  limit: z.number().int().min(1).max(5000).default(50),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListHotelPerformanceToolSchema = ListHotelPerformanceSchema;
export async function listHotelPerformance(args: z.infer<typeof ListHotelPerformanceSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  const selectClause = args.fields.join(",\n      ");
  const whereClause = args.where ? `\n    WHERE ${args.where}` : "";
  const orderByClause = args.orderBy ? `\n    ORDER BY ${args.orderBy}` : "";
  const query = `
    SELECT
      ${selectClause}
    FROM hotel_performance_view${whereClause}${orderByClause}
    LIMIT ${args.limit}
  `;
  
  return customer.query(query);
}

async function asTool(fn: (args: any) => Promise<any>, args: any): Promise<{
  content: [{ type: "text"; text: string }];
  isError?: true;
}> {
  try {
    const result = await fn(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: any) {
    const errorMessage = toErrorMessage(error);
    return {
      content: [{ type: "text" as const, text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
}

export function registerVerticalTools(server: McpServer) {
  server.registerTool(
    "list_audience_insights",
    {
      description: "Generate Audience Insights attributes (allowlisted endpoint).",
      inputSchema: ListAudienceInsightsToolSchema.shape,
    },
    args => asTool(listAudienceInsights, args)
  );
  server.registerTool(
    "list_hotel_performance",
    {
      description: "List hotel performance data for travel campaigns.",
      inputSchema: ListHotelPerformanceToolSchema.shape,
    },
    args => asTool(listHotelPerformance, args)
  );
}
