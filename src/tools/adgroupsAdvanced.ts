import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";
const BaseSchema = z.object({
    customerId: z.string().describe("The Google Ads Customer ID"),
    userId: z.string().optional().describe("SaaS User ID"),
});
function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
function normalizeStatus(raw: unknown, fallback: "ENABLED" | "PAUSED" = "PAUSED"): "ENABLED" | "PAUSED" {
    if (raw === "ENABLED" || Number(raw) === 2)
        return "ENABLED";
    if (raw === "PAUSED" || Number(raw) === 3)
        return "PAUSED";
    return fallback;
}
const CreateAdGroupSchema = BaseSchema.extend({
    campaignId: z.string(),
    name: z.string(),
    status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
    type: z.string().optional(),
    cpcBidMicros: z.number().int().positive().optional(),
});
async function createAdGroup(args: z.infer<typeof CreateAdGroupSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const create: any = {
        campaign: `customers/${args.customerId}/campaigns/${args.campaignId}`,
        name: args.name,
        status: args.status,
    };
    if (args.type)
        create.type = args.type;
    if (args.cpcBidMicros != null)
        create.cpc_bid_micros = args.cpcBidMicros;
    return runMutation(customer, [{ ad_group_operation: { create } }]);
}
const UpdateAdGroupSchema = BaseSchema.extend({
    adGroupId: z.string(),
    name: z.string().optional(),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional(),
    cpcBidMicros: z.number().int().positive().optional(),
});
async function updateAdGroup(args: z.infer<typeof UpdateAdGroupSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const update: any = {
        resource_name: `customers/${args.customerId}/adGroups/${args.adGroupId}`,
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
    if (args.cpcBidMicros != null) {
        update.cpc_bid_micros = args.cpcBidMicros;
        paths.push("cpc_bid_micros");
    }
    if (paths.length === 0) {
        throw new Error("At least one field is required for update_ad_group.");
    }
    return runMutation(customer, [
        {
            ad_group_operation: {
                update,
                update_mask: { paths },
            },
        },
    ]);
}
const ListAdGroupsSchema = BaseSchema.extend({
    campaignId: z.string().optional(),
    limit: z.number().default(100),
});
async function listAdGroups(args: z.infer<typeof ListAdGroupsSchema>) {
    const where = args.campaignId ? `WHERE campaign.id = ${args.campaignId}` : "";
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      ad_group.id,
      ad_group.name,
      ad_group.status,
      ad_group.type,
      ad_group.cpc_bid_micros,
      campaign.id
    FROM ad_group
    ${where}
    ORDER BY ad_group.id DESC
    LIMIT ${args.limit}`,
    });
}
const CloneAdGroupSchema = BaseSchema.extend({
    sourceAdGroupId: z.string(),
    targetCampaignId: z.string().optional(),
    targetAdGroupName: z.string().optional(),
    status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
});
async function cloneAdGroup(args: z.infer<typeof CloneAdGroupSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const sourceRows: any[] = await runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros, campaign.id
            FROM ad_group
            WHERE ad_group.id = ${args.sourceAdGroupId}
            LIMIT 1`,
    });
    if (sourceRows.length === 0) {
        throw new Error(`Source ad group ${args.sourceAdGroupId} not found.`);
    }
    const sourceAdGroup = sourceRows[0].ad_group;
    const sourceCampaignId = String(sourceRows[0]?.campaign?.id || "");
    const targetCampaignId = args.targetCampaignId || sourceCampaignId;
    const createResult: any = await runMutation(customer, [
        {
            ad_group_operation: {
                create: {
                    campaign: `customers/${args.customerId}/campaigns/${targetCampaignId}`,
                    name: args.targetAdGroupName || `${sourceAdGroup?.name || "Ad Group"} - Copy`,
                    status: args.status,
                    ...(sourceAdGroup?.type != null ? { type: sourceAdGroup.type } : {}),
                    ...(sourceAdGroup?.cpc_bid_micros != null ? { cpc_bid_micros: Number(sourceAdGroup.cpc_bid_micros) } : {}),
                },
            },
        },
    ]);
    const resourceName = String(createResult?.mutate_operation_responses?.[0]?.ad_group_result?.resource_name || "");
    const targetAdGroupId = resourceName.split("/").pop() || "";
    if (!targetAdGroupId) {
        throw new Error("Failed to create target ad group.");
    }
    const keywordRows: any[] = await runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status
            FROM keyword_view
            WHERE ad_group.id = ${args.sourceAdGroupId}
              AND ad_group_criterion.status != 'REMOVED'`,
    });
    const keywordOps = keywordRows.map(row => ({
        ad_group_criterion_operation: {
            create: {
                ad_group: `customers/${args.customerId}/adGroups/${targetAdGroupId}`,
                status: normalizeStatus(row?.ad_group_criterion?.status, args.status),
                keyword: {
                    text: String(row?.ad_group_criterion?.keyword?.text || ""),
                    match_type: row?.ad_group_criterion?.keyword?.match_type,
                },
            },
        },
    })).filter(op => op.ad_group_criterion_operation.create.keyword.text);
    for (const opsChunk of chunk(keywordOps, 100)) {
        if (opsChunk.length > 0)
            await runMutation(customer, opsChunk);
    }
    return {
        sourceAdGroupId: args.sourceAdGroupId,
        targetAdGroupId,
        targetCampaignId,
        keywordsCopied: keywordOps.length,
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
export function registerAdGroupAdvancedTools(server: McpServer) {
    server.registerTool("create_ad_group", { description: "Create a new ad group.", inputSchema: CreateAdGroupSchema.shape }, args => asTool(createAdGroup, args));
    server.registerTool("update_ad_group", { description: "Update ad group fields.", inputSchema: UpdateAdGroupSchema.shape }, args => asTool(updateAdGroup, args));
    server.registerTool("list_ad_groups", { description: "List ad groups.", inputSchema: ListAdGroupsSchema.shape }, args => asTool(listAdGroups, args));
    server.registerTool("clone_ad_group", { description: "Clone an ad group into same/other campaign.", inputSchema: CloneAdGroupSchema.shape }, args => asTool(cloneAdGroup, args));
}
