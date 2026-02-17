import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";

// --- Search Terms ---

const GetSearchTermsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  campaignId: z.string().optional().describe("Filter by Campaign ID"),
  adGroupId: z.string().optional().describe("Filter by Ad Group ID"),
  limit: z.number().default(50).describe("Max number of search terms to retrieve"),
  dateRange: z.enum(["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH"]).default("LAST_30_DAYS").describe("Date range for the report"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const GetSearchTermsToolSchema = GetSearchTermsSchema;
export async function getSearchTerms(args: z.infer<typeof GetSearchTermsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  let queryWithMetrics = `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      campaign.name,
      ad_group.name
    FROM search_term_view
    WHERE segments.date DURING ${args.dateRange}
  `;

  if (args.campaignId) {
    queryWithMetrics += ` AND campaign.id = ${args.campaignId}`;
  }
  if (args.adGroupId) {
    queryWithMetrics += ` AND ad_group.id = ${args.adGroupId}`;
  }

  queryWithMetrics += ` ORDER BY metrics.impressions DESC LIMIT ${args.limit}`;

  let queryWithoutMetrics = `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      campaign.name,
      ad_group.name
    FROM search_term_view
    WHERE segments.date DURING ${args.dateRange}
  `;

  if (args.campaignId) {
    queryWithoutMetrics += ` AND campaign.id = ${args.campaignId}`;
  }
  if (args.adGroupId) {
    queryWithoutMetrics += ` AND ad_group.id = ${args.adGroupId}`;
  }

  queryWithoutMetrics += ` LIMIT ${args.limit}`;

  logger.info(`Fetching search terms for customer ${args.customerId}`);
  
  try {
    const result = await customer.query(queryWithMetrics);
    return result;
  } catch (error: any) {
    if (JSON.stringify(error ?? {}).includes("REQUESTED_METRICS_FOR_MANAGER")) {
      logger.warn(
        `Metrics unavailable for manager account ${args.customerId}. Falling back to non-metric search term query.`
      );
      return customer.query(queryWithoutMetrics);
    }
    logger.error(`Failed to fetch search terms: ${error.message}`);
    throw error;
  }
}

// --- Change History ---

const GetChangeHistorySchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  limit: z.number().default(50).describe("Max number of events to retrieve"),
  startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
  resourceTypes: z.array(z.string()).optional().describe("Filter by resource types (e.g., CAMPAIGN, AD_GROUP)"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const GetChangeHistoryToolSchema = GetChangeHistorySchema;
export async function getChangeHistory(args: z.infer<typeof GetChangeHistorySchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  let query = `
    SELECT
      change_event.change_date_time,
      change_event.change_resource_type,
      change_event.change_resource_name,
      change_event.client_type,
      change_event.user_email,
      change_event.old_resource,
      change_event.new_resource,
      change_event.resource_change_operation,
      change_event.changed_fields,
      campaign.name,
      ad_group.name
    FROM change_event
  `;

  const conditions: string[] = [];

  if (args.startDate && args.endDate) {
    conditions.push(`change_event.change_date_time BETWEEN '${args.startDate}' AND '${args.endDate}'`);
  } else {
    // CHANGE_EVENT rejects edge cases around LAST_30_DAYS boundaries on some accounts.
    // Use LAST_14_DAYS as a stable default window when no explicit range is provided.
    conditions.push(`change_event.change_date_time DURING LAST_14_DAYS`);
  }

  if (args.resourceTypes && args.resourceTypes.length > 0) {
    const types = args.resourceTypes.join("','");
    conditions.push(`change_event.change_resource_type IN ('${types}')`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += ` ORDER BY change_event.change_date_time DESC LIMIT ${args.limit}`;

  logger.info(`Fetching change history for customer ${args.customerId}`);

  try {
    const result = await customer.query(query);
    return result;
  } catch (error: any) {
    logger.error(`Failed to fetch change history: ${error.message}`);
    throw error;
  }
}
