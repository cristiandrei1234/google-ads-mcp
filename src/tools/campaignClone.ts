import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";
type Variant = "DESKTOP" | "MOBILE";
const BaseSchema = z.object({
    customerId: z.string(),
    userId: z.string().optional(),
});
function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size)
        chunks.push(items.slice(i, i + size));
    return chunks;
}
function extractResourceName(result: any, key: string): string {
    const resourceName = result?.mutate_operation_responses?.[0]?.[key]?.resource_name;
    if (!resourceName)
        throw new Error(`Missing ${key}.resource_name in mutation result.`);
    return String(resourceName);
}
function normalizeEuPoliticalAdvertisingStatus(value: unknown): string {
    if (value === "CONTAINS_EU_POLITICAL_ADVERTISING" || Number(value) === 2)
        return "CONTAINS_EU_POLITICAL_ADVERTISING";
    if (value === "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" || Number(value) === 3)
        return "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING";
    return "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING";
}
function normalizeStatus(raw: unknown, fallback: "ENABLED" | "PAUSED"): "ENABLED" | "PAUSED" {
    if (raw === "ENABLED" || Number(raw) === 2)
        return "ENABLED";
    if (raw === "PAUSED" || Number(raw) === 3)
        return "PAUSED";
    return fallback;
}
function normalizeMatchType(raw: unknown): "BROAD" | "PHRASE" | "EXACT" {
    if (raw === "BROAD" || Number(raw) === 4)
        return "BROAD";
    if (raw === "PHRASE" || Number(raw) === 3)
        return "PHRASE";
    if (raw === "EXACT" || Number(raw) === 2)
        return "EXACT";
    return "PHRASE";
}
async function copyAdGroupsKeywordsAndAds(customer: any, customerId: string, userId: string | undefined, sourceCampaignId: string, targetCampaignId: string, status: "ENABLED" | "PAUSED") {
    const [adGroups, keywords, ads] = await Promise.all([
        runQuery({
            customerId,
            userId,
            query: `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros
              FROM ad_group WHERE campaign.id = ${sourceCampaignId}`,
        }),
        runQuery({
            customerId,
            userId,
            query: `SELECT ad_group.id, ad_group_criterion.status, ad_group_criterion.cpc_bid_micros, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
              FROM keyword_view
              WHERE campaign.id = ${sourceCampaignId}
                AND ad_group_criterion.status != 'REMOVED'`,
        }),
        runQuery({
            customerId,
            userId,
            query: `SELECT ad_group.id, ad_group_ad.status, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2
              FROM ad_group_ad
              WHERE campaign.id = ${sourceCampaignId}
                AND ad_group_ad.ad.type = RESPONSIVE_SEARCH_AD
                AND ad_group_ad.status != 'REMOVED'`,
        }),
    ]);
    const adGroupMap = new Map<string, string>();
    for (const row of adGroups as any[]) {
        const source = row?.ad_group;
        const result: any = await runMutation(customer, [
            {
                ad_group_operation: {
                    create: {
                        campaign: `customers/${customerId}/campaigns/${targetCampaignId}`,
                        name: String(source?.name || "Ad Group"),
                        status: normalizeStatus(source?.status, status),
                        ...(source?.type != null ? { type: source.type } : {}),
                        ...(source?.cpc_bid_micros != null ? { cpc_bid_micros: Number(source.cpc_bid_micros) } : {}),
                    },
                },
            },
        ]);
        const newResource = extractResourceName(result, "ad_group_result");
        const newId = newResource.split("/").pop() || "";
        const oldId = String(source?.id || "");
        if (oldId && newId)
            adGroupMap.set(oldId, newId);
    }
    const keywordOps: any[] = [];
    for (const row of keywords as any[]) {
        const oldId = String(row?.ad_group?.id || "");
        const targetAdGroupId = adGroupMap.get(oldId);
        const text = row?.ad_group_criterion?.keyword?.text;
        const matchType = row?.ad_group_criterion?.keyword?.match_type;
        if (!targetAdGroupId || !text || matchType == null)
            continue;
        keywordOps.push({
            ad_group_criterion_operation: {
                create: {
                    ad_group: `customers/${customerId}/adGroups/${targetAdGroupId}`,
                    status: normalizeStatus(row?.ad_group_criterion?.status, status),
                    ...(row?.ad_group_criterion?.cpc_bid_micros != null ? { cpc_bid_micros: Number(row.ad_group_criterion.cpc_bid_micros) } : {}),
                    keyword: {
                        text: String(text),
                        match_type: normalizeMatchType(matchType),
                    },
                },
            },
        });
    }
    for (const opsChunk of chunk(keywordOps, 100)) {
        if (opsChunk.length > 0)
            await runMutation(customer, opsChunk);
    }
    const adOps: any[] = [];
    for (const row of ads as any[]) {
        const oldId = String(row?.ad_group?.id || "");
        const targetAdGroupId = adGroupMap.get(oldId);
        const rsa = row?.ad_group_ad?.ad?.responsive_search_ad;
        const finalUrls = row?.ad_group_ad?.ad?.final_urls;
        if (!targetAdGroupId || !rsa || !Array.isArray(finalUrls) || finalUrls.length === 0)
            continue;
        const headlines = (rsa.headlines || []).filter((h: any) => typeof h?.text === "string" && h.text.trim().length > 0);
        const descriptions = (rsa.descriptions || []).filter((d: any) => typeof d?.text === "string" && d.text.trim().length > 0);
        if (headlines.length < 3 || descriptions.length < 2)
            continue;
        adOps.push({
            ad_group_ad_operation: {
                create: {
                    ad_group: `customers/${customerId}/adGroups/${targetAdGroupId}`,
                    status: normalizeStatus(row?.ad_group_ad?.status, status),
                    ad: {
                        final_urls: finalUrls,
                        responsive_search_ad: {
                            headlines,
                            descriptions,
                            ...(rsa.path1 ? { path1: rsa.path1 } : {}),
                            ...(rsa.path2 ? { path2: rsa.path2 } : {}),
                        },
                    },
                },
            },
        });
    }
    for (const opsChunk of chunk(adOps, 20)) {
        if (opsChunk.length > 0)
            await runMutation(customer, opsChunk);
    }
    return { adGroupsCreated: adGroupMap.size, keywordsCopied: keywordOps.length, adsCopied: adOps.length };
}
async function copyCampaignNegatives(customer: any, customerId: string, userId: string | undefined, sourceCampaignId: string, targetCampaignId: string) {
    const negatives: any[] = await runQuery({
        customerId,
        userId,
        query: `SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
            FROM campaign_criterion
            WHERE campaign.id = ${sourceCampaignId}
              AND campaign_criterion.negative = true
              AND campaign_criterion.type = KEYWORD
              AND campaign_criterion.status != 'REMOVED'`,
    });
    const operations = negatives
        .map(row => {
        const text = row?.campaign_criterion?.keyword?.text;
        const matchType = row?.campaign_criterion?.keyword?.match_type;
        if (!text || matchType == null)
            return null;
        return {
            campaign_criterion_operation: {
                create: {
                    campaign: `customers/${customerId}/campaigns/${targetCampaignId}`,
                    negative: true,
                    status: "ENABLED",
                    keyword: {
                        text: String(text),
                        match_type: normalizeMatchType(matchType),
                    },
                },
            },
        };
    })
        .filter(Boolean) as any[];
    for (const opsChunk of chunk(operations, 100)) {
        if (opsChunk.length > 0)
            await runMutation(customer, opsChunk);
    }
    return operations.length;
}
function buildCloneCampaignCreate(sourceCampaign: any, campaignName: string, budgetResourceName: string, status: "ENABLED" | "PAUSED") {
    const create: any = {
        name: campaignName,
        status,
        campaign_budget: budgetResourceName,
        contains_eu_political_advertising: normalizeEuPoliticalAdvertisingStatus(sourceCampaign?.contains_eu_political_advertising),
        advertising_channel_type: String(sourceCampaign?.advertising_channel_type || "SEARCH"),
        network_settings: {
            target_google_search: Boolean(sourceCampaign?.network_settings?.target_google_search),
            target_search_network: Boolean(sourceCampaign?.network_settings?.target_search_network),
            target_content_network: Boolean(sourceCampaign?.network_settings?.target_content_network),
            target_partner_search_network: Boolean(sourceCampaign?.network_settings?.target_partner_search_network),
        },
    };
    const biddingType = Number(sourceCampaign?.bidding_strategy_type || 0);
    if (biddingType === 11)
        create.maximize_conversion_value = {};
    else if (biddingType === 10)
        create.maximize_conversions = {};
    else
        create.manual_cpc = {};
    return create;
}
async function cloneCampaignInternal(args: {
    customerId: string;
    userId?: string;
    sourceCampaignId: string;
    campaignName: string;
    status: "ENABLED" | "PAUSED";
    copyNegatives: boolean;
}) {
    const customer = await getCustomer(args.customerId, args.userId);
    const sourceRows: any[] = await runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT campaign.id, campaign.name, campaign.bidding_strategy_type, campaign.advertising_channel_type, campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network, campaign.contains_eu_political_advertising, campaign.campaign_budget
            FROM campaign
            WHERE campaign.id = ${args.sourceCampaignId}
            LIMIT 1`,
    });
    if (sourceRows.length === 0)
        throw new Error(`Source campaign ${args.sourceCampaignId} not found.`);
    const sourceCampaign = sourceRows[0].campaign;
    const budgetRows: any[] = await runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT campaign_budget.name, campaign_budget.amount_micros
            FROM campaign_budget
            WHERE campaign_budget.resource_name = '${sourceCampaign.campaign_budget}'
            LIMIT 1`,
    });
    if (budgetRows.length === 0)
        throw new Error("Source campaign budget not found.");
    const sourceBudget = budgetRows[0].campaign_budget;
    const suffix = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
    const budgetResult = await runMutation(customer, [
        {
            campaign_budget_operation: {
                create: {
                    name: `${sourceBudget?.name || "Budget"} - Clone - ${suffix}`,
                    amount_micros: Number(sourceBudget?.amount_micros || 0),
                    delivery_method: "STANDARD",
                    explicitly_shared: false,
                },
            },
        },
    ]);
    const budgetResourceName = extractResourceName(budgetResult, "campaign_budget_result");
    const campaignResult = await runMutation(customer, [
        {
            campaign_operation: {
                create: buildCloneCampaignCreate(sourceCampaign, args.campaignName, budgetResourceName, args.status),
            },
        },
    ]);
    const campaignResourceName = extractResourceName(campaignResult, "campaign_result");
    const targetCampaignId = campaignResourceName.split("/").pop() || "";
    const copied = await copyAdGroupsKeywordsAndAds(customer, args.customerId, args.userId, args.sourceCampaignId, targetCampaignId, args.status);
    const negativesCopied = args.copyNegatives
        ? await copyCampaignNegatives(customer, args.customerId, args.userId, args.sourceCampaignId, targetCampaignId)
        : 0;
    return { targetCampaignId, campaignResourceName, budgetResourceName, negativesCopied, ...copied };
}
const DuplicateCampaignSchema = BaseSchema.extend({
    sourceCampaignId: z.string(),
    targetCampaignName: z.string().optional(),
    status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
    copyCampaignNegatives: z.boolean().default(true),
});
async function duplicateCampaign(args: z.infer<typeof DuplicateCampaignSchema>) {
    const name = args.targetCampaignName || `Campaign Copy ${new Date().toISOString().slice(0, 19)}`;
    return cloneCampaignInternal({
        customerId: args.customerId,
        userId: args.userId,
        sourceCampaignId: args.sourceCampaignId,
        campaignName: name,
        status: args.status,
        copyNegatives: args.copyCampaignNegatives,
    });
}
const DuplicateCampaignByDeviceSchema = BaseSchema.extend({
    sourceCampaignId: z.string(),
    desktopCampaignName: z.string().optional(),
    mobileCampaignName: z.string().optional(),
    copyCampaignNegatives: z.boolean().default(true),
});
async function duplicateCampaignByDevice(args: z.infer<typeof DuplicateCampaignByDeviceSchema>) {
    const desktop = await cloneCampaignInternal({
        customerId: args.customerId,
        userId: args.userId,
        sourceCampaignId: args.sourceCampaignId,
        campaignName: args.desktopCampaignName || `Desktop Copy ${new Date().toISOString().slice(0, 19)}`,
        status: "PAUSED",
        copyNegatives: args.copyCampaignNegatives,
    });
    const mobile = await cloneCampaignInternal({
        customerId: args.customerId,
        userId: args.userId,
        sourceCampaignId: args.sourceCampaignId,
        campaignName: args.mobileCampaignName || `Mobile Copy ${new Date().toISOString().slice(0, 19)}`,
        status: "PAUSED",
        copyNegatives: args.copyCampaignNegatives,
    });
    const customer = await getCustomer(args.customerId, args.userId);
    const split = async (campaignId: string, variant: Variant) => {
        const rows: any[] = await runQuery({
            customerId: args.customerId,
            userId: args.userId,
            query: `SELECT campaign_criterion.resource_name, campaign_criterion.device.type
              FROM campaign_criterion
              WHERE campaign.id = ${campaignId}
                AND campaign_criterion.type = DEVICE`,
        });
        const excluded = variant === "DESKTOP" ? new Set([2, 3]) : new Set([4, 3]);
        const operations = rows
            .filter(row => excluded.has(Number(row?.campaign_criterion?.device?.type || 0)))
            .map(row => ({
            campaign_criterion_operation: {
                update: {
                    resource_name: row?.campaign_criterion?.resource_name,
                    bid_modifier: 0,
                },
                update_mask: { paths: ["bid_modifier"] },
            },
        }));
        if (operations.length > 0)
            await runMutation(customer, operations);
    };
    await split(desktop.targetCampaignId, "DESKTOP");
    await split(mobile.targetCampaignId, "MOBILE");
    return { desktop, mobile };
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
}
export function registerCampaignCloneTools(server: McpServer) {
    server.registerTool("duplicate_campaign", { description: "Duplicate a campaign with ad groups, keywords, and ads.", inputSchema: DuplicateCampaignSchema.shape }, args => asTool(duplicateCampaign, args));
    server.registerTool("duplicate_campaign_by_device", { description: "Create DESKTOP and MOBILE paused campaign clones and split device modifiers.", inputSchema: DuplicateCampaignByDeviceSchema.shape }, args => asTool(duplicateCampaignByDevice, args));
}
