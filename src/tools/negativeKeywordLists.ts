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
const ListSharedNegativeKeywordListsSchema = BaseSchema.extend({
    limit: z.number().default(100),
});
async function listSharedNegativeKeywordLists(args: z.infer<typeof ListSharedNegativeKeywordListsSchema>) {
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      shared_set.id,
      shared_set.name,
      shared_set.type,
      shared_set.resource_name
    FROM shared_set
    WHERE shared_set.type = NEGATIVE_KEYWORDS
    LIMIT ${args.limit}`,
    });
}
const CreateSharedNegativeKeywordListSchema = BaseSchema.extend({
    name: z.string(),
    keywords: z
        .array(z.object({ text: z.string(), matchType: MatchTypeSchema }))
        .default([]),
});
async function createSharedNegativeKeywordList(args: z.infer<typeof CreateSharedNegativeKeywordListSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const createResult: any = await runMutation(customer, [
        {
            shared_set_operation: {
                create: {
                    name: args.name,
                    type: "NEGATIVE_KEYWORDS",
                },
            },
        },
    ]);
    const sharedSetResourceName = String(createResult?.mutate_operation_responses?.[0]?.shared_set_result?.resource_name || "");
    if (!sharedSetResourceName) {
        throw new Error("Failed to create shared negative keyword list.");
    }
    if (args.keywords.length > 0) {
        const keywordOps = args.keywords.map(keyword => ({
            shared_criterion_operation: {
                create: {
                    shared_set: sharedSetResourceName,
                    keyword: {
                        text: keyword.text,
                        match_type: keyword.matchType,
                    },
                },
            },
        }));
        await runMutation(customer, keywordOps);
    }
    return {
        sharedSetResourceName,
        keywordsAdded: args.keywords.length,
    };
}
const UpdateSharedNegativeKeywordListSchema = BaseSchema.extend({
    sharedSetId: z.string(),
    name: z.string(),
});
async function updateSharedNegativeKeywordList(args: z.infer<typeof UpdateSharedNegativeKeywordListSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            shared_set_operation: {
                update: {
                    resource_name: `customers/${args.customerId}/sharedSets/${args.sharedSetId}`,
                    name: args.name,
                },
                update_mask: {
                    paths: ["name"],
                },
            },
        },
    ]);
}
const RemoveSharedNegativeKeywordListSchema = BaseSchema.extend({
    sharedSetId: z.string(),
});
async function removeSharedNegativeKeywordList(args: z.infer<typeof RemoveSharedNegativeKeywordListSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            shared_set_operation: {
                remove: `customers/${args.customerId}/sharedSets/${args.sharedSetId}`,
            },
        },
    ]);
}
const AttachSharedNegativeListToCampaignSchema = BaseSchema.extend({
    campaignId: z.string(),
    sharedSetId: z.string(),
});
async function attachSharedNegativeListToCampaign(args: z.infer<typeof AttachSharedNegativeListToCampaignSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            campaign_shared_set_operation: {
                create: {
                    campaign: `customers/${args.customerId}/campaigns/${args.campaignId}`,
                    shared_set: `customers/${args.customerId}/sharedSets/${args.sharedSetId}`,
                },
            },
        },
    ]);
}
const DetachSharedNegativeListFromCampaignSchema = BaseSchema.extend({
    campaignId: z.string(),
    sharedSetId: z.string(),
});
async function detachSharedNegativeListFromCampaign(args: z.infer<typeof DetachSharedNegativeListFromCampaignSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            campaign_shared_set_operation: {
                remove: `customers/${args.customerId}/campaignSharedSets/${args.campaignId}~${args.sharedSetId}`,
            },
        },
    ]);
}
const AddSharedNegativeKeywordSchema = BaseSchema.extend({
    sharedSetId: z.string(),
    text: z.string(),
    matchType: MatchTypeSchema,
});
async function addSharedNegativeKeyword(args: z.infer<typeof AddSharedNegativeKeywordSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            shared_criterion_operation: {
                create: {
                    shared_set: `customers/${args.customerId}/sharedSets/${args.sharedSetId}`,
                    keyword: {
                        text: args.text,
                        match_type: args.matchType,
                    },
                },
            },
        },
    ]);
}
const RemoveSharedNegativeKeywordSchema = BaseSchema.extend({
    sharedSetId: z.string(),
    criterionId: z.string(),
});
async function removeSharedNegativeKeyword(args: z.infer<typeof RemoveSharedNegativeKeywordSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            shared_criterion_operation: {
                remove: `customers/${args.customerId}/sharedCriteria/${args.sharedSetId}~${args.criterionId}`,
            },
        },
    ]);
}
const ListCustomerNegativeCriteriaSchema = BaseSchema.extend({
    limit: z.number().default(100),
});
async function listCustomerNegativeCriteria(args: z.infer<typeof ListCustomerNegativeCriteriaSchema>) {
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      customer_negative_criterion.criterion_id,
      customer_negative_criterion.resource_name,
      customer_negative_criterion.type,
      customer_negative_criterion.placement.url
    FROM customer_negative_criterion
    LIMIT ${args.limit}`,
    });
}
const AddCustomerNegativePlacementSchema = BaseSchema.extend({
    placementUrl: z.string().url(),
});
async function addCustomerNegativePlacement(args: z.infer<typeof AddCustomerNegativePlacementSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            customer_negative_criterion_operation: {
                create: {
                    placement: {
                        url: args.placementUrl,
                    },
                },
            },
        },
    ]);
}
const RemoveCustomerNegativeCriterionSchema = BaseSchema.extend({
    criterionId: z.string(),
});
async function removeCustomerNegativeCriterion(args: z.infer<typeof RemoveCustomerNegativeCriterionSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            customer_negative_criterion_operation: {
                remove: `customers/${args.customerId}/customerNegativeCriteria/${args.criterionId}`,
            },
        },
    ]);
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
export function registerNegativeKeywordListTools(server: McpServer) {
    server.registerTool("list_shared_negative_keyword_lists", { description: "List shared negative keyword lists.", inputSchema: ListSharedNegativeKeywordListsSchema.shape }, args => asTool(listSharedNegativeKeywordLists, args));
    server.registerTool("create_shared_negative_keyword_list", { description: "Create a shared negative keyword list.", inputSchema: CreateSharedNegativeKeywordListSchema.shape }, args => asTool(createSharedNegativeKeywordList, args));
    server.registerTool("update_shared_negative_keyword_list", { description: "Rename a shared negative keyword list.", inputSchema: UpdateSharedNegativeKeywordListSchema.shape }, args => asTool(updateSharedNegativeKeywordList, args));
    server.registerTool("remove_shared_negative_keyword_list", { description: "Remove a shared negative keyword list.", inputSchema: RemoveSharedNegativeKeywordListSchema.shape }, args => asTool(removeSharedNegativeKeywordList, args));
    server.registerTool("attach_shared_negative_list_to_campaign", { description: "Attach a shared negative list to a campaign.", inputSchema: AttachSharedNegativeListToCampaignSchema.shape }, args => asTool(attachSharedNegativeListToCampaign, args));
    server.registerTool("detach_shared_negative_list_from_campaign", { description: "Detach a shared negative list from a campaign.", inputSchema: DetachSharedNegativeListFromCampaignSchema.shape }, args => asTool(detachSharedNegativeListFromCampaign, args));
    server.registerTool("add_shared_negative_keyword", { description: "Add keyword to shared negative list.", inputSchema: AddSharedNegativeKeywordSchema.shape }, args => asTool(addSharedNegativeKeyword, args));
    server.registerTool("remove_shared_negative_keyword", { description: "Remove keyword from shared negative list.", inputSchema: RemoveSharedNegativeKeywordSchema.shape }, args => asTool(removeSharedNegativeKeyword, args));
    server.registerTool("list_customer_negative_criteria", { description: "List customer-level negative criteria.", inputSchema: ListCustomerNegativeCriteriaSchema.shape }, args => asTool(listCustomerNegativeCriteria, args));
    server.registerTool("add_customer_negative_placement", { description: "Add a customer-level negative placement criterion.", inputSchema: AddCustomerNegativePlacementSchema.shape }, args => asTool(addCustomerNegativePlacement, args));
    server.registerTool("remove_customer_negative_criterion", { description: "Remove a customer-level negative criterion.", inputSchema: RemoveCustomerNegativeCriterionSchema.shape }, args => asTool(removeCustomerNegativeCriterion, args));
}
