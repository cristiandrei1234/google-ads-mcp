import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";
const BaseSchema = z.object({
    customerId: z.string().describe("The Google Ads Customer ID"),
    userId: z.string().optional().describe("SaaS User ID"),
});
function normalizeCustomerId(customerId: string): string {
    return customerId.replace(/-/g, "");
}
function extractResourceId(value: string, collection: string): string {
    const match = value.trim().match(new RegExp(`/${collection}/([^/]+)$`));
    return match?.[1] || value.trim();
}
function normalizeNumericId(value: string, collection: string): string {
    const normalized = extractResourceId(value, collection).replace(/[^0-9]/g, "");
    if (!normalized) {
        throw new Error(`Invalid ${collection} identifier: ${value}`);
    }
    return normalized;
}
function toCampaignResourceName(customerId: string, campaignIdOrResourceName: string): string {
    if (campaignIdOrResourceName.startsWith("customers/")) {
        return campaignIdOrResourceName;
    }
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const campaignId = normalizeNumericId(campaignIdOrResourceName, "campaigns");
    return `customers/${normalizedCustomerId}/campaigns/${campaignId}`;
}
function toAdGroupResourceName(customerId: string, adGroupIdOrResourceName: string): string {
    if (adGroupIdOrResourceName.startsWith("customers/")) {
        return adGroupIdOrResourceName;
    }
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const adGroupId = normalizeNumericId(adGroupIdOrResourceName, "adGroups");
    return `customers/${normalizedCustomerId}/adGroups/${adGroupId}`;
}
function toAssetGroupResourceName(customerId: string, assetGroupIdOrResourceName: string): string {
    if (assetGroupIdOrResourceName.startsWith("customers/")) {
        return assetGroupIdOrResourceName;
    }
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const assetGroupId = normalizeNumericId(assetGroupIdOrResourceName, "assetGroups");
    return `customers/${normalizedCustomerId}/assetGroups/${assetGroupId}`;
}
function toAssetResourceName(customerId: string, assetIdOrResourceName: string): string {
    if (assetIdOrResourceName.startsWith("customers/")) {
        return assetIdOrResourceName;
    }
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const assetId = normalizeNumericId(assetIdOrResourceName, "assets");
    return `customers/${normalizedCustomerId}/assets/${assetId}`;
}
function toCustomerAssetResourceName(customerId: string, assetIdOrResourceName: string, fieldType: string): string {
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const assetId = normalizeNumericId(assetIdOrResourceName, "assets");
    return `customers/${normalizedCustomerId}/customerAssets/${assetId}~${fieldType}`;
}
function toCampaignAssetResourceName(customerId: string, campaignIdOrResourceName: string, assetIdOrResourceName: string, fieldType: string): string {
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const campaignId = normalizeNumericId(campaignIdOrResourceName, "campaigns");
    const assetId = normalizeNumericId(assetIdOrResourceName, "assets");
    return `customers/${normalizedCustomerId}/campaignAssets/${campaignId}~${assetId}~${fieldType}`;
}
function toAdGroupAssetResourceName(customerId: string, adGroupIdOrResourceName: string, assetIdOrResourceName: string, fieldType: string): string {
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const adGroupId = normalizeNumericId(adGroupIdOrResourceName, "adGroups");
    const assetId = normalizeNumericId(assetIdOrResourceName, "assets");
    return `customers/${normalizedCustomerId}/adGroupAssets/${adGroupId}~${assetId}~${fieldType}`;
}
function toAssetGroupAssetResourceName(customerId: string, assetGroupIdOrResourceName: string, assetIdOrResourceName: string, fieldType: string): string {
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const assetGroupId = normalizeNumericId(assetGroupIdOrResourceName, "assetGroups");
    const assetId = normalizeNumericId(assetIdOrResourceName, "assets");
    return `customers/${normalizedCustomerId}/assetGroupAssets/${assetGroupId}~${assetId}~${fieldType}`;
}
function buildAssetTypeFilter(assetTypes?: string[]): string {
    if (!assetTypes || assetTypes.length === 0) {
        return "";
    }
    const sanitized = assetTypes
        .map(type => type.trim().toUpperCase().replace(/[^A-Z0-9_]/g, ""))
        .filter(Boolean);
    if (sanitized.length === 0) {
        return "";
    }
    return ` AND asset.type IN ('${sanitized.join("','")}')`;
}
const ListAssetGroupsSchema = BaseSchema.extend({
    campaignId: z.string().optional(),
    limit: z.number().default(100),
});
async function listAssetGroups(args: z.infer<typeof ListAssetGroupsSchema>) {
    const filters: string[] = [];
    if (args.campaignId) {
        filters.push(`campaign.id = ${normalizeNumericId(args.campaignId, "campaigns")}`);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      asset_group.id,
      asset_group.name,
      asset_group.status,
      asset_group.resource_name,
      asset_group.campaign,
      asset_group.final_urls,
      asset_group.path1,
      asset_group.path2
    FROM asset_group
    ${where}
    ORDER BY asset_group.id DESC
    LIMIT ${args.limit}`,
    });
}
const CreateAssetGroupSchema = BaseSchema.extend({
    campaignId: z.string().describe("Campaign ID or resource name"),
    name: z.string().describe("Asset group name"),
    status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
    finalUrls: z.array(z.string().url()).optional(),
    path1: z.string().optional(),
    path2: z.string().optional(),
});
async function createAssetGroup(args: z.infer<typeof CreateAssetGroupSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const create: Record<string, unknown> = {
        campaign: toCampaignResourceName(args.customerId, args.campaignId),
        name: args.name,
        status: args.status,
    };
    if (args.finalUrls && args.finalUrls.length > 0) {
        create.final_urls = args.finalUrls;
    }
    if (args.path1) {
        create.path1 = args.path1;
    }
    if (args.path2) {
        create.path2 = args.path2;
    }
    return runMutation(customer, [{ asset_group_operation: { create } }]);
}
const UpdateAssetGroupSchema = BaseSchema.extend({
    assetGroupId: z.string().describe("Asset group ID or resource name"),
    name: z.string().optional(),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional(),
    finalUrls: z.array(z.string().url()).optional(),
    path1: z.string().optional(),
    path2: z.string().optional(),
});
async function updateAssetGroup(args: z.infer<typeof UpdateAssetGroupSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const update: Record<string, unknown> = {
        resource_name: toAssetGroupResourceName(args.customerId, args.assetGroupId),
    };
    const paths: string[] = [];
    if (args.name) {
        update.name = args.name;
        paths.push("name");
    }
    if (args.status) {
        update.status = args.status;
        paths.push("status");
    }
    if (args.finalUrls) {
        update.final_urls = args.finalUrls;
        paths.push("final_urls");
    }
    if (args.path1 !== undefined) {
        update.path1 = args.path1;
        paths.push("path1");
    }
    if (args.path2 !== undefined) {
        update.path2 = args.path2;
        paths.push("path2");
    }
    if (paths.length === 0) {
        throw new Error("At least one field is required for update_asset_group.");
    }
    return runMutation(customer, [
        {
            asset_group_operation: {
                update,
                update_mask: { paths },
            },
        },
    ]);
}
const RemoveAssetGroupSchema = BaseSchema.extend({
    assetGroupId: z.string().describe("Asset group ID or resource name"),
});
async function removeAssetGroup(args: z.infer<typeof RemoveAssetGroupSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            asset_group_operation: {
                remove: toAssetGroupResourceName(args.customerId, args.assetGroupId),
            },
        },
    ]);
}
const LinkCustomerAssetSchema = BaseSchema.extend({
    assetId: z.string().describe("Asset ID or resource name"),
    fieldType: z.string().describe("Google Ads AssetFieldType enum value"),
    status: z.enum(["ENABLED", "PAUSED"]).default("ENABLED"),
});
async function linkCustomerAsset(args: z.infer<typeof LinkCustomerAssetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            customer_asset_operation: {
                create: {
                    asset: toAssetResourceName(args.customerId, args.assetId),
                    field_type: args.fieldType,
                    status: args.status,
                },
            },
        },
    ]);
}
const UnlinkCustomerAssetSchema = BaseSchema.extend({
    resourceName: z.string().optional().describe("customers/{customerId}/customerAssets/{assetId}~{fieldType}"),
    assetId: z.string().optional().describe("Asset ID or resource name"),
    fieldType: z.string().optional().describe("Google Ads AssetFieldType enum value"),
}).refine(args => Boolean(args.resourceName) || Boolean(args.assetId && args.fieldType), {
    message: "Provide resourceName or both assetId and fieldType.",
});
async function unlinkCustomerAsset(args: z.infer<typeof UnlinkCustomerAssetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const resourceName = args.resourceName || toCustomerAssetResourceName(args.customerId, args.assetId!, args.fieldType!);
    return runMutation(customer, [
        {
            customer_asset_operation: {
                remove: resourceName,
            },
        },
    ]);
}
const LinkCampaignAssetSchema = BaseSchema.extend({
    campaignId: z.string().describe("Campaign ID or resource name"),
    assetId: z.string().describe("Asset ID or resource name"),
    fieldType: z.string().describe("Google Ads AssetFieldType enum value"),
    status: z.enum(["ENABLED", "PAUSED"]).default("ENABLED"),
});
async function linkCampaignAsset(args: z.infer<typeof LinkCampaignAssetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            campaign_asset_operation: {
                create: {
                    campaign: toCampaignResourceName(args.customerId, args.campaignId),
                    asset: toAssetResourceName(args.customerId, args.assetId),
                    field_type: args.fieldType,
                    status: args.status,
                },
            },
        },
    ]);
}
const UnlinkCampaignAssetSchema = BaseSchema.extend({
    resourceName: z.string().optional().describe("customers/{customerId}/campaignAssets/{campaignId}~{assetId}~{fieldType}"),
    campaignId: z.string().optional().describe("Campaign ID or resource name"),
    assetId: z.string().optional().describe("Asset ID or resource name"),
    fieldType: z.string().optional().describe("Google Ads AssetFieldType enum value"),
}).refine(args => Boolean(args.resourceName) || Boolean(args.campaignId && args.assetId && args.fieldType), {
    message: "Provide resourceName or campaignId+assetId+fieldType.",
});
async function unlinkCampaignAsset(args: z.infer<typeof UnlinkCampaignAssetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const resourceName = args.resourceName ||
        toCampaignAssetResourceName(args.customerId, args.campaignId!, args.assetId!, args.fieldType!);
    return runMutation(customer, [
        {
            campaign_asset_operation: {
                remove: resourceName,
            },
        },
    ]);
}
const LinkAdGroupAssetSchema = BaseSchema.extend({
    adGroupId: z.string().describe("Ad group ID or resource name"),
    assetId: z.string().describe("Asset ID or resource name"),
    fieldType: z.string().describe("Google Ads AssetFieldType enum value"),
    status: z.enum(["ENABLED", "PAUSED"]).default("ENABLED"),
});
async function linkAdGroupAsset(args: z.infer<typeof LinkAdGroupAssetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            ad_group_asset_operation: {
                create: {
                    ad_group: toAdGroupResourceName(args.customerId, args.adGroupId),
                    asset: toAssetResourceName(args.customerId, args.assetId),
                    field_type: args.fieldType,
                    status: args.status,
                },
            },
        },
    ]);
}
const UnlinkAdGroupAssetSchema = BaseSchema.extend({
    resourceName: z.string().optional().describe("customers/{customerId}/adGroupAssets/{adGroupId}~{assetId}~{fieldType}"),
    adGroupId: z.string().optional().describe("Ad group ID or resource name"),
    assetId: z.string().optional().describe("Asset ID or resource name"),
    fieldType: z.string().optional().describe("Google Ads AssetFieldType enum value"),
}).refine(args => Boolean(args.resourceName) || Boolean(args.adGroupId && args.assetId && args.fieldType), {
    message: "Provide resourceName or adGroupId+assetId+fieldType.",
});
async function unlinkAdGroupAsset(args: z.infer<typeof UnlinkAdGroupAssetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const resourceName = args.resourceName || toAdGroupAssetResourceName(args.customerId, args.adGroupId!, args.assetId!, args.fieldType!);
    return runMutation(customer, [
        {
            ad_group_asset_operation: {
                remove: resourceName,
            },
        },
    ]);
}
const LinkAssetGroupAssetSchema = BaseSchema.extend({
    assetGroupId: z.string().describe("Asset group ID or resource name"),
    assetId: z.string().describe("Asset ID or resource name"),
    fieldType: z.string().describe("Google Ads AssetFieldType enum value"),
    status: z.enum(["ENABLED", "PAUSED"]).default("ENABLED"),
});
async function linkAssetGroupAsset(args: z.infer<typeof LinkAssetGroupAssetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            asset_group_asset_operation: {
                create: {
                    asset_group: toAssetGroupResourceName(args.customerId, args.assetGroupId),
                    asset: toAssetResourceName(args.customerId, args.assetId),
                    field_type: args.fieldType,
                    status: args.status,
                },
            },
        },
    ]);
}
const UnlinkAssetGroupAssetSchema = BaseSchema.extend({
    resourceName: z.string().optional().describe("customers/{customerId}/assetGroupAssets/{assetGroupId}~{assetId}~{fieldType}"),
    assetGroupId: z.string().optional().describe("Asset group ID or resource name"),
    assetId: z.string().optional().describe("Asset ID or resource name"),
    fieldType: z.string().optional().describe("Google Ads AssetFieldType enum value"),
}).refine(args => Boolean(args.resourceName) || Boolean(args.assetGroupId && args.assetId && args.fieldType), {
    message: "Provide resourceName or assetGroupId+assetId+fieldType.",
});
async function unlinkAssetGroupAsset(args: z.infer<typeof UnlinkAssetGroupAssetSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const resourceName = args.resourceName ||
        toAssetGroupAssetResourceName(args.customerId, args.assetGroupId!, args.assetId!, args.fieldType!);
    return runMutation(customer, [
        {
            asset_group_asset_operation: {
                remove: resourceName,
            },
        },
    ]);
}
const ListAssetLinksSchema = BaseSchema.extend({
    level: z.enum(["customer", "campaign", "ad_group", "asset_group", "all"]).default("all"),
    campaignId: z.string().optional(),
    adGroupId: z.string().optional(),
    assetGroupId: z.string().optional(),
    assetTypes: z.array(z.string()).optional(),
    limit: z.number().default(100),
});
async function queryCustomerLinks(args: z.infer<typeof ListAssetLinksSchema>) {
    const filter = buildAssetTypeFilter(args.assetTypes);
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      customer_asset.resource_name,
      customer_asset.field_type,
      customer_asset.status,
      asset.id,
      asset.name,
      asset.type
    FROM customer_asset
    WHERE 1 = 1${filter}
    ORDER BY asset.id DESC
    LIMIT ${args.limit}`,
    });
}
async function queryCampaignLinks(args: z.infer<typeof ListAssetLinksSchema>) {
    const filter = buildAssetTypeFilter(args.assetTypes);
    const campaignFilter = args.campaignId ? ` AND campaign.id = ${normalizeNumericId(args.campaignId, "campaigns")}` : "";
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      campaign_asset.resource_name,
      campaign_asset.field_type,
      campaign_asset.status,
      campaign.id,
      campaign.name,
      asset.id,
      asset.name,
      asset.type
    FROM campaign_asset
    WHERE 1 = 1${campaignFilter}${filter}
    ORDER BY campaign.id DESC
    LIMIT ${args.limit}`,
    });
}
async function queryAdGroupLinks(args: z.infer<typeof ListAssetLinksSchema>) {
    const filter = buildAssetTypeFilter(args.assetTypes);
    const adGroupFilter = args.adGroupId ? ` AND ad_group.id = ${normalizeNumericId(args.adGroupId, "adGroups")}` : "";
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      ad_group_asset.resource_name,
      ad_group_asset.field_type,
      ad_group_asset.status,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name,
      asset.id,
      asset.name,
      asset.type
    FROM ad_group_asset
    WHERE 1 = 1${adGroupFilter}${filter}
    ORDER BY ad_group.id DESC
    LIMIT ${args.limit}`,
    });
}
async function queryAssetGroupLinks(args: z.infer<typeof ListAssetLinksSchema>) {
    const filter = buildAssetTypeFilter(args.assetTypes);
    const assetGroupFilter = args.assetGroupId
        ? ` AND asset_group.id = ${normalizeNumericId(args.assetGroupId, "assetGroups")}`
        : "";
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      asset_group_asset.resource_name,
      asset_group_asset.field_type,
      asset_group_asset.status,
      asset_group.id,
      asset_group.name,
      campaign.id,
      campaign.name,
      asset.id,
      asset.name,
      asset.type
    FROM asset_group_asset
    WHERE 1 = 1${assetGroupFilter}${filter}
    ORDER BY asset_group.id DESC
    LIMIT ${args.limit}`,
    });
}
async function listAssetLinks(args: z.infer<typeof ListAssetLinksSchema>) {
    if (args.level === "customer")
        return queryCustomerLinks(args);
    if (args.level === "campaign")
        return queryCampaignLinks(args);
    if (args.level === "ad_group")
        return queryAdGroupLinks(args);
    if (args.level === "asset_group")
        return queryAssetGroupLinks(args);
    const [customer, campaign, adGroup, assetGroup] = await Promise.all([
        queryCustomerLinks(args),
        queryCampaignLinks(args),
        queryAdGroupLinks(args),
        queryAssetGroupLinks(args),
    ]);
    return { customer, campaign, adGroup, assetGroup };
}
async function asTool(fn: (args: any) => Promise<any>, args: any): Promise<{
    content: [
        {
            type: "text";
            text: string;
        }
    ];
    isError?: true;
}> {
    try {
        const result = await fn(args);
        return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error: any) {
        return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
export function registerAssetsAdvancedTools(server: McpServer) {
    server.registerTool("list_asset_groups", { description: "List Performance Max asset groups.", inputSchema: ListAssetGroupsSchema.shape }, args => asTool(listAssetGroups, args));
    server.registerTool("create_asset_group", { description: "Create a Performance Max asset group.", inputSchema: CreateAssetGroupSchema.shape }, args => asTool(createAssetGroup, args));
    server.registerTool("update_asset_group", { description: "Update a Performance Max asset group.", inputSchema: UpdateAssetGroupSchema.shape }, args => asTool(updateAssetGroup, args));
    server.registerTool("remove_asset_group", { description: "Remove a Performance Max asset group.", inputSchema: RemoveAssetGroupSchema.shape }, args => asTool(removeAssetGroup, args));
    server.registerTool("link_customer_asset", { description: "Link an asset at customer level.", inputSchema: LinkCustomerAssetSchema.shape }, args => asTool(linkCustomerAsset, args));
    server.registerTool("unlink_customer_asset", { description: "Unlink a customer-level asset.", inputSchema: UnlinkCustomerAssetSchema.shape }, args => asTool(unlinkCustomerAsset, args));
    server.registerTool("link_campaign_asset", { description: "Link an asset to a campaign.", inputSchema: LinkCampaignAssetSchema.shape }, args => asTool(linkCampaignAsset, args));
    server.registerTool("unlink_campaign_asset", { description: "Unlink a campaign asset.", inputSchema: UnlinkCampaignAssetSchema.shape }, args => asTool(unlinkCampaignAsset, args));
    server.registerTool("link_ad_group_asset", { description: "Link an asset to an ad group.", inputSchema: LinkAdGroupAssetSchema.shape }, args => asTool(linkAdGroupAsset, args));
    server.registerTool("unlink_ad_group_asset", { description: "Unlink an ad-group asset.", inputSchema: UnlinkAdGroupAssetSchema.shape }, args => asTool(unlinkAdGroupAsset, args));
    server.registerTool("link_asset_group_asset", { description: "Link an asset to a Performance Max asset group.", inputSchema: LinkAssetGroupAssetSchema.shape }, args => asTool(linkAssetGroupAsset, args));
    server.registerTool("unlink_asset_group_asset", { description: "Unlink an asset-group asset.", inputSchema: UnlinkAssetGroupAssetSchema.shape }, args => asTool(unlinkAssetGroupAsset, args));
    server.registerTool("list_asset_links", { description: "List linked assets at customer/campaign/ad-group/asset-group levels.", inputSchema: ListAssetLinksSchema.shape }, args => asTool(listAssetLinks, args));
}
