import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
const BaseSchema = z.object({
    customerId: z.string().describe("The Google Ads Customer ID"),
    userId: z.string().optional().describe("SaaS User ID"),
});
const UpdateConversionActionSchema = BaseSchema.extend({
    conversionActionId: z.string(),
    name: z.string().optional(),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional(),
    category: z.string().optional(),
    includeInConversionsMetric: z.boolean().optional(),
});
async function updateConversionAction(args: z.infer<typeof UpdateConversionActionSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const update: any = {
        resource_name: `customers/${args.customerId}/conversionActions/${args.conversionActionId}`,
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
    if (args.category) {
        update.category = args.category;
        paths.push("category");
    }
    if (args.includeInConversionsMetric != null) {
        update.include_in_conversions_metric = args.includeInConversionsMetric;
        paths.push("include_in_conversions_metric");
    }
    if (paths.length === 0) {
        throw new Error("At least one field is required for update_conversion_action.");
    }
    return runMutation(customer, [
        {
            conversion_action_operation: {
                update,
                update_mask: { paths },
            },
        },
    ]);
}
const RemoveConversionActionSchema = BaseSchema.extend({
    conversionActionId: z.string(),
});
async function removeConversionAction(args: z.infer<typeof RemoveConversionActionSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            conversion_action_operation: {
                remove: `customers/${args.customerId}/conversionActions/${args.conversionActionId}`,
            },
        },
    ]);
}
const UploadCallConversionSchema = BaseSchema.extend({
    conversionActionId: z.string(),
    callerId: z.string(),
    callStartDateTime: z.string().describe("YYYY-MM-DD HH:mm:ss+00:00"),
    conversionDateTime: z.string().describe("YYYY-MM-DD HH:mm:ss+00:00"),
    conversionValue: z.number().optional(),
    currencyCode: z.string().optional(),
});
async function uploadCallConversion(args: z.infer<typeof UploadCallConversionSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).conversionUploads.uploadCallConversions({
        customer_id: args.customerId,
        conversions: [
            {
                caller_id: args.callerId,
                call_start_date_time: args.callStartDateTime,
                conversion_date_time: args.conversionDateTime,
                conversion_action: `customers/${args.customerId}/conversionActions/${args.conversionActionId}`,
                conversion_value: args.conversionValue,
                currency_code: args.currencyCode,
            },
        ],
        partial_failure: true,
    });
}
const UploadConversionAdjustmentSchema = BaseSchema.extend({
    conversionActionId: z.string(),
    gclid: z.string(),
    conversionDateTime: z.string().describe("Original conversion date-time: YYYY-MM-DD HH:mm:ss+00:00"),
    adjustmentDateTime: z.string().describe("Adjustment date-time: YYYY-MM-DD HH:mm:ss+00:00"),
    adjustmentType: z.enum(["RETRACTION", "RESTATEMENT"]),
    adjustedValue: z.number().optional(),
    currencyCode: z.string().optional(),
});
async function uploadConversionAdjustment(args: z.infer<typeof UploadConversionAdjustmentSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const adjustment: any = {
        conversion_action: `customers/${args.customerId}/conversionActions/${args.conversionActionId}`,
        adjustment_type: args.adjustmentType,
        adjustment_date_time: args.adjustmentDateTime,
        gclid_date_time_pair: {
            gclid: args.gclid,
            conversion_date_time: args.conversionDateTime,
        },
    };
    if (args.adjustmentType === "RESTATEMENT") {
        if (args.adjustedValue == null || !args.currencyCode) {
            throw new Error("adjustedValue and currencyCode are required for RESTATEMENT.");
        }
        adjustment.restatement_value = {
            adjusted_value: args.adjustedValue,
            currency_code: args.currencyCode,
        };
    }
    return (customer as any).conversionAdjustmentUploads.uploadConversionAdjustments({
        customer_id: args.customerId,
        conversion_adjustments: [adjustment],
        partial_failure: true,
    });
}
const CreateOfflineUserDataJobSchema = BaseSchema.extend({
    userListId: z.string(),
    type: z.enum(["CUSTOMER_MATCH_USER_LIST"]).default("CUSTOMER_MATCH_USER_LIST"),
});
async function createOfflineUserDataJob(args: z.infer<typeof CreateOfflineUserDataJobSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).offlineUserDataJobs.createOfflineUserDataJob({
        customer_id: args.customerId,
        job: {
            type: args.type,
            customer_match_user_list_metadata: {
                user_list: `customers/${args.customerId}/userLists/${args.userListId}`,
            },
        },
    });
}
const AddOfflineUserDataJobOperationsSchema = BaseSchema.extend({
    resourceName: z.string().describe("customers/{customerId}/offlineUserDataJobs/{jobId}"),
    operations: z.array(z.any()).min(1).describe("Raw offline user data operations payload"),
    enablePartialFailure: z.boolean().default(true),
    enableWarnings: z.boolean().default(true),
});
async function addOfflineUserDataJobOperations(args: z.infer<typeof AddOfflineUserDataJobOperationsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).offlineUserDataJobs.addOfflineUserDataJobOperations({
        resource_name: args.resourceName,
        operations: args.operations,
        enable_partial_failure: args.enablePartialFailure,
        enable_warnings: args.enableWarnings,
    });
}
const RunOfflineUserDataJobSchema = BaseSchema.extend({
    resourceName: z.string(),
});
async function runOfflineUserDataJob(args: z.infer<typeof RunOfflineUserDataJobSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).offlineUserDataJobs.runOfflineUserDataJob({
        resource_name: args.resourceName,
    });
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
export function registerConversionsAdvancedTools(server: McpServer) {
    server.registerTool("update_conversion_action", { description: "Update an existing conversion action.", inputSchema: UpdateConversionActionSchema.shape }, args => asTool(updateConversionAction, args));
    server.registerTool("remove_conversion_action", { description: "Remove a conversion action.", inputSchema: RemoveConversionActionSchema.shape }, args => asTool(removeConversionAction, args));
    server.registerTool("upload_call_conversion", { description: "Upload an offline call conversion.", inputSchema: UploadCallConversionSchema.shape }, args => asTool(uploadCallConversion, args));
    server.registerTool("upload_conversion_adjustment", { description: "Upload conversion retraction/restatement.", inputSchema: UploadConversionAdjustmentSchema.shape }, args => asTool(uploadConversionAdjustment, args));
    server.registerTool("create_offline_user_data_job", { description: "Create an offline user data job.", inputSchema: CreateOfflineUserDataJobSchema.shape }, args => asTool(createOfflineUserDataJob, args));
    server.registerTool("add_offline_user_data_job_operations", { description: "Add operations to an offline user data job.", inputSchema: AddOfflineUserDataJobOperationsSchema.shape }, args => asTool(addOfflineUserDataJobOperations, args));
    server.registerTool("run_offline_user_data_job", { description: "Run an offline user data job.", inputSchema: RunOfflineUserDataJobSchema.shape }, args => asTool(runOfflineUserDataJob, args));
}
