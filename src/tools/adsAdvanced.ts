import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";
const BaseSchema = z.object({
    customerId: z.string().describe("The Google Ads Customer ID"),
    userId: z.string().optional().describe("SaaS User ID"),
});
const ListAdsSchema = BaseSchema.extend({
    campaignId: z.string().optional(),
    adGroupId: z.string().optional(),
    limit: z.number().default(100),
});
async function listAds(args: z.infer<typeof ListAdsSchema>) {
    const conditions: string[] = [];
    if (args.campaignId)
        conditions.push(`campaign.id = ${args.campaignId}`);
    if (args.adGroupId)
        conditions.push(`ad_group.id = ${args.adGroupId}`);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      campaign.id,
      ad_group.id,
      ad_group_ad.ad.id,
      ad_group_ad.status,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_search_ad.path1,
      ad_group_ad.ad.responsive_search_ad.path2
    FROM ad_group_ad
    ${where}
    ORDER BY ad_group_ad.ad.id DESC
    LIMIT ${args.limit}`,
    });
}
const AdTextAssetInput = z.object({
    text: z.string(),
    pinnedField: z.string().optional(),
});
const UpdateAdContentSchema = BaseSchema.extend({
    adGroupId: z.string(),
    adId: z.string(),
    headlines: z.array(AdTextAssetInput).optional(),
    descriptions: z.array(AdTextAssetInput).optional(),
    finalUrls: z.array(z.string().url()).optional(),
    path1: z.string().optional(),
    path2: z.string().optional(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
});
async function updateAdContent(args: z.infer<typeof UpdateAdContentSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const rows: any[] = await runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      ad_group_ad.resource_name,
      ad_group_ad.status,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_search_ad.path1,
      ad_group_ad.ad.responsive_search_ad.path2
    FROM ad_group_ad
    WHERE ad_group.id = ${args.adGroupId}
      AND ad_group_ad.ad.id = ${args.adId}
    LIMIT 1`,
    });
    if (rows.length === 0) {
        throw new Error(`Ad ${args.adId} in ad group ${args.adGroupId} not found.`);
    }
    const row = rows[0];
    const oldResourceName = String(row?.ad_group_ad?.resource_name || "");
    const existingRsa = row?.ad_group_ad?.ad?.responsive_search_ad;
    const existingFinalUrls: string[] = row?.ad_group_ad?.ad?.final_urls || [];
    const headlines = (args.headlines || existingRsa?.headlines || [])
        .map((h: any) => ({
        text: h.text,
        ...(h.pinnedField ? { pinned_field: h.pinnedField } : {}),
    }))
        .filter((h: any) => typeof h.text === "string" && h.text.trim().length > 0);
    const descriptions = (args.descriptions || existingRsa?.descriptions || [])
        .map((d: any) => ({
        text: d.text,
        ...(d.pinnedField ? { pinned_field: d.pinnedField } : {}),
    }))
        .filter((d: any) => typeof d.text === "string" && d.text.trim().length > 0);
    if (headlines.length < 3 || descriptions.length < 2) {
        throw new Error("Responsive Search Ads require at least 3 headlines and 2 descriptions.");
    }
    const finalUrls = args.finalUrls || existingFinalUrls;
    if (!Array.isArray(finalUrls) || finalUrls.length === 0) {
        throw new Error("At least one final URL is required.");
    }
    const createResult: any = await runMutation(customer, [
        {
            ad_group_ad_operation: {
                create: {
                    ad_group: `customers/${args.customerId}/adGroups/${args.adGroupId}`,
                    status: args.status || (Number(row?.ad_group_ad?.status || 3) === 2 ? "ENABLED" : "PAUSED"),
                    ad: {
                        final_urls: finalUrls,
                        responsive_search_ad: {
                            headlines,
                            descriptions,
                            path1: args.path1 ?? existingRsa?.path1,
                            path2: args.path2 ?? existingRsa?.path2,
                        },
                    },
                },
            },
        },
    ]);
    await runMutation(customer, [
        {
            ad_group_ad_operation: {
                remove: oldResourceName,
            },
        },
    ]);
    return {
        previousAdResourceName: oldResourceName,
        newAdResourceName: createResult?.mutate_operation_responses?.[0]?.ad_group_ad_result?.resource_name,
    };
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
export function registerAdsAdvancedTools(server: McpServer) {
    server.registerTool("list_ads", { description: "List ads with optional campaign/ad-group filters.", inputSchema: ListAdsSchema.shape }, args => asTool(listAds, args));
    server.registerTool("update_ad_content", { description: "Replace RSA content by recreating the ad and removing old one.", inputSchema: UpdateAdContentSchema.shape }, args => asTool(updateAdContent, args));
}
