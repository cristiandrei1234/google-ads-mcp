import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import { runQuery } from "./runQuery";
const BaseSchema = z.object({
    customerId: z.string().describe("The Google Ads Customer ID"),
    userId: z.string().optional().describe("SaaS User ID"),
});
const MatchTypeSchema = z.enum(["BROAD", "PHRASE", "EXACT"]);
function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
const ListKeywordsSchema = BaseSchema.extend({
    campaignId: z.string().optional(),
    adGroupId: z.string().optional(),
    limit: z.number().default(200),
});
async function listKeywords(args: z.infer<typeof ListKeywordsSchema>) {
    const filters: string[] = ["ad_group_criterion.status != 'REMOVED'"];
    if (args.campaignId)
        filters.push(`campaign.id = ${args.campaignId}`);
    if (args.adGroupId)
        filters.push(`ad_group.id = ${args.adGroupId}`);
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      campaign.id,
      ad_group.id,
      ad_group_criterion.criterion_id,
      ad_group_criterion.status,
      ad_group_criterion.cpc_bid_micros,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type
    FROM keyword_view
    WHERE ${filters.join(" AND ")}
    LIMIT ${args.limit}`,
    });
}
const UpdateKeywordSchema = BaseSchema.extend({
    adGroupId: z.string(),
    keywordId: z.string(),
    status: z.enum(["ENABLED", "PAUSED"]).optional(),
    cpcBidMicros: z.number().int().positive().optional(),
    text: z.string().optional(),
    matchType: MatchTypeSchema.optional(),
});
async function updateKeyword(args: z.infer<typeof UpdateKeywordSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const resourceName = `customers/${args.customerId}/adGroupCriteria/${args.adGroupId}~${args.keywordId}`;
    const changingText = Boolean(args.text || args.matchType);
    if (!changingText) {
        const update: any = { resource_name: resourceName };
        const paths: string[] = [];
        if (args.status) {
            update.status = args.status;
            paths.push("status");
        }
        if (args.cpcBidMicros != null) {
            update.cpc_bid_micros = args.cpcBidMicros;
            paths.push("cpc_bid_micros");
        }
        if (paths.length === 0) {
            throw new Error("No fields provided for update_keyword.");
        }
        return runMutation(customer, [
            {
                ad_group_criterion_operation: {
                    update,
                    update_mask: { paths },
                },
            },
        ]);
    }
    const rows: any[] = await runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      ad_group_criterion.status,
      ad_group_criterion.cpc_bid_micros,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type
    FROM keyword_view
    WHERE ad_group.id = ${args.adGroupId}
      AND ad_group_criterion.criterion_id = ${args.keywordId}
    LIMIT 1`,
    });
    if (rows.length === 0) {
        throw new Error("Keyword not found for text/match update.");
    }
    const current = rows[0]?.ad_group_criterion;
    const createResult = await runMutation(customer, [
        {
            ad_group_criterion_operation: {
                create: {
                    ad_group: `customers/${args.customerId}/adGroups/${args.adGroupId}`,
                    status: args.status || (Number(current?.status || 3) === 2 ? "ENABLED" : "PAUSED"),
                    cpc_bid_micros: args.cpcBidMicros ?? Number(current?.cpc_bid_micros || 0),
                    keyword: {
                        text: args.text || String(current?.keyword?.text || ""),
                        match_type: args.matchType || current?.keyword?.match_type,
                    },
                },
            },
        },
    ]);
    await runMutation(customer, [
        {
            ad_group_criterion_operation: {
                remove: resourceName,
            },
        },
    ]);
    return {
        replacedKeywordId: args.keywordId,
        newKeywordResourceName: (createResult as any)?.mutate_operation_responses?.[0]?.ad_group_criterion_result?.resource_name,
    };
}
const BulkAddKeywordsSchema = BaseSchema.extend({
    adGroupId: z.string(),
    keywords: z.array(z.object({
        text: z.string(),
        matchType: MatchTypeSchema,
        status: z.enum(["ENABLED", "PAUSED"]).default("ENABLED"),
        cpcBidMicros: z.number().int().positive().optional(),
    })),
});
async function bulkAddKeywords(args: z.infer<typeof BulkAddKeywordsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const operations = args.keywords.map(keyword => ({
        ad_group_criterion_operation: {
            create: {
                ad_group: `customers/${args.customerId}/adGroups/${args.adGroupId}`,
                status: keyword.status,
                ...(keyword.cpcBidMicros != null ? { cpc_bid_micros: keyword.cpcBidMicros } : {}),
                keyword: {
                    text: keyword.text,
                    match_type: keyword.matchType,
                },
            },
        },
    }));
    for (const opsChunk of chunk(operations, 100)) {
        await runMutation(customer, opsChunk);
    }
    return { created: operations.length };
}
const BulkUpdateKeywordsSchema = BaseSchema.extend({
    updates: z.array(z.object({
        adGroupId: z.string(),
        keywordId: z.string(),
        status: z.enum(["ENABLED", "PAUSED"]).optional(),
        cpcBidMicros: z.number().int().positive().optional(),
    })),
});
async function bulkUpdateKeywords(args: z.infer<typeof BulkUpdateKeywordsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const operations: any[] = [];
    for (const entry of args.updates) {
        const update: any = {
            resource_name: `customers/${args.customerId}/adGroupCriteria/${entry.adGroupId}~${entry.keywordId}`,
        };
        const paths: string[] = [];
        if (entry.status) {
            update.status = entry.status;
            paths.push("status");
        }
        if (entry.cpcBidMicros != null) {
            update.cpc_bid_micros = entry.cpcBidMicros;
            paths.push("cpc_bid_micros");
        }
        if (paths.length > 0) {
            operations.push({
                ad_group_criterion_operation: { update, update_mask: { paths } },
            });
        }
    }
    for (const opsChunk of chunk(operations, 100)) {
        await runMutation(customer, opsChunk);
    }
    return { updated: operations.length };
}
const BulkRemoveKeywordsSchema = BaseSchema.extend({
    removals: z.array(z.object({ adGroupId: z.string(), keywordId: z.string() })),
});
async function bulkRemoveKeywords(args: z.infer<typeof BulkRemoveKeywordsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const operations = args.removals.map(entry => ({
        ad_group_criterion_operation: {
            remove: `customers/${args.customerId}/adGroupCriteria/${entry.adGroupId}~${entry.keywordId}`,
        },
    }));
    for (const opsChunk of chunk(operations, 100)) {
        await runMutation(customer, opsChunk);
    }
    return { removed: operations.length };
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
export function registerKeywordsAdvancedTools(server: McpServer) {
    server.registerTool("list_keywords", { description: "List keywords with optional filters.", inputSchema: ListKeywordsSchema.shape }, args => asTool(listKeywords, args));
    server.registerTool("update_keyword", { description: "Update one keyword, including optional text/match replace flow.", inputSchema: UpdateKeywordSchema.shape }, args => asTool(updateKeyword, args));
    server.registerTool("bulk_add_keywords", { description: "Add multiple keywords to an ad group.", inputSchema: BulkAddKeywordsSchema.shape }, args => asTool(bulkAddKeywords, args));
    server.registerTool("bulk_update_keywords", { description: "Bulk update keyword status/bid.", inputSchema: BulkUpdateKeywordsSchema.shape }, args => asTool(bulkUpdateKeywords, args));
    server.registerTool("bulk_remove_keywords", { description: "Bulk remove keywords.", inputSchema: BulkRemoveKeywordsSchema.shape }, args => asTool(bulkRemoveKeywords, args));
}
