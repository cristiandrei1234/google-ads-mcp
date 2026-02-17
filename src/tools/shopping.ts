import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";

// --- Shopping Performance ---

const ListShoppingPerformanceSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  dateRange: z.enum(["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH"]).default("LAST_30_DAYS"),
  limit: z.number().default(50),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListShoppingPerformanceToolSchema = ListShoppingPerformanceSchema;
export async function listShoppingPerformance(args: z.infer<typeof ListShoppingPerformanceSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  const queryWithMetrics = `
    SELECT
      segments.product_item_id,
      segments.product_title,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      campaign.name,
      ad_group.name
    FROM shopping_performance_view
    WHERE segments.date DURING ${args.dateRange}
    ORDER BY metrics.impressions DESC
    LIMIT ${args.limit}
  `;

  const queryWithoutMetrics = `
    SELECT
      segments.product_item_id,
      segments.product_title,
      campaign.name,
      ad_group.name
    FROM shopping_performance_view
    WHERE segments.date DURING ${args.dateRange}
    LIMIT ${args.limit}
  `;

  try {
    return await customer.query(queryWithMetrics);
  } catch (error: any) {
    if (JSON.stringify(error ?? {}).includes("REQUESTED_METRICS_FOR_MANAGER")) {
      logger.warn(
        `Metrics unavailable for manager account ${args.customerId}. Falling back to non-metric shopping query.`
      );
      return customer.query(queryWithoutMetrics);
    }
    throw error;
  }
}

// --- Standard Shopping Listing Groups ---

const ListListingGroupsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  adGroupId: z.string().optional().describe("Filter by Ad Group ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListListingGroupsToolSchema = ListListingGroupsSchema;
export async function listListingGroups(args: z.infer<typeof ListListingGroupsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  let query = `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.listing_group.type,
      ad_group_criterion.listing_group.case_value.product_brand.value,
      ad_group_criterion.listing_group.case_value.product_item_id.value,
      ad_group_criterion.listing_group.case_value.product_condition.condition,
      ad_group_criterion.listing_group.case_value.product_type.value,
      ad_group_criterion.listing_group.parent_ad_group_criterion,
      ad_group.name,
      campaign.name
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'LISTING_GROUP'
  `;

  if (args.adGroupId) {
    query += ` AND ad_group.id = ${args.adGroupId}`;
  }
  
  return customer.query(query);
}

// --- PMax Asset Group Listing Groups ---

const ListAssetGroupListingGroupsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  assetGroupId: z.string().optional().describe("Filter by Asset Group ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListAssetGroupListingGroupsToolSchema = ListAssetGroupListingGroupsSchema;
export async function listAssetGroupListingGroups(args: z.infer<typeof ListAssetGroupListingGroupsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  let query = `
    SELECT
      asset_group_listing_group_filter.id,
      asset_group_listing_group_filter.type,
      asset_group_listing_group_filter.case_value.product_brand.value,
      asset_group_listing_group_filter.case_value.product_item_id.value,
      asset_group_listing_group_filter.parent_listing_group_filter,
      asset_group.name,
      campaign.name
    FROM asset_group_listing_group_filter
  `;

  if (args.assetGroupId) {
    query += ` AND asset_group.id = ${args.assetGroupId}`;
  }
  
  return customer.query(query);
}
