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
function toExperimentResourceName(customerId: string, experimentIdOrResourceName: string): string {
    if (experimentIdOrResourceName.startsWith("customers/")) {
        return experimentIdOrResourceName;
    }
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const experimentId = experimentIdOrResourceName.trim();
    return `customers/${normalizedCustomerId}/experiments/${experimentId}`;
}
function resolveValidateOnlyFlag(override?: boolean): boolean {
    if (override != null) {
        return override;
    }
    return ["1", "true", "yes"].includes((process.env.GOOGLE_ADS_VALIDATE_ONLY || "").toLowerCase());
}
const UpdateExperimentSchema = BaseSchema.extend({
    experimentId: z.string().describe("Experiment ID or resource name"),
    name: z.string().optional(),
    suffix: z.string().optional(),
    status: z.enum(["SETUP", "INITIATED", "HALTED", "PROMOTED", "GRADUATED"]).optional(),
});
async function updateExperiment(args: z.infer<typeof UpdateExperimentSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const update: Record<string, unknown> = {
        resource_name: toExperimentResourceName(args.customerId, args.experimentId),
    };
    const paths: string[] = [];
    if (args.name) {
        update.name = args.name;
        paths.push("name");
    }
    if (args.suffix) {
        update.suffix = args.suffix;
        paths.push("suffix");
    }
    if (args.status) {
        update.status = args.status;
        paths.push("status");
    }
    if (paths.length === 0) {
        throw new Error("At least one field is required for update_experiment.");
    }
    return runMutation(customer, [
        {
            experiment_operation: {
                update,
                update_mask: { paths },
            },
        },
    ]);
}
const ScheduleExperimentSchema = BaseSchema.extend({
    experimentId: z.string().describe("Experiment ID or resource name"),
    validateOnly: z.boolean().optional().describe("Validate only without applying"),
    waitForCompletion: z.boolean().default(false),
});
async function scheduleExperiment(args: z.infer<typeof ScheduleExperimentSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const service = (customer as any).loadService("ExperimentServiceClient");
    const resourceName = toExperimentResourceName(args.customerId, args.experimentId);
    const validateOnly = resolveValidateOnlyFlag(args.validateOnly);
    const [operation, rawOperation] = await service.scheduleExperiment({
        resource_name: resourceName,
        validate_only: validateOnly,
    }, {
        otherArgs: {
            headers: (customer as any).callHeaders,
        },
    });
    let completion: unknown;
    if (args.waitForCompletion && operation?.promise) {
        completion = await operation.promise();
    }
    return {
        experimentResourceName: resourceName,
        validateOnly,
        operationName: rawOperation?.name,
        operation: rawOperation,
        completion,
    };
}
const PromoteExperimentSchema = BaseSchema.extend({
    experimentId: z.string().describe("Experiment ID or resource name"),
    validateOnly: z.boolean().optional().describe("Validate only without applying"),
    waitForCompletion: z.boolean().default(false),
});
async function promoteExperiment(args: z.infer<typeof PromoteExperimentSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const service = (customer as any).loadService("ExperimentServiceClient");
    const resourceName = toExperimentResourceName(args.customerId, args.experimentId);
    const validateOnly = resolveValidateOnlyFlag(args.validateOnly);
    const [operation, rawOperation] = await service.promoteExperiment({
        resource_name: resourceName,
        validate_only: validateOnly,
    }, {
        otherArgs: {
            headers: (customer as any).callHeaders,
        },
    });
    let completion: unknown;
    if (args.waitForCompletion && operation?.promise) {
        completion = await operation.promise();
    }
    return {
        experimentResourceName: resourceName,
        validateOnly,
        operationName: rawOperation?.name,
        operation: rawOperation,
        completion,
    };
}
const EndExperimentSchema = BaseSchema.extend({
    experimentId: z.string().describe("Experiment ID or resource name"),
    validateOnly: z.boolean().optional().describe("Validate only without applying"),
});
async function endExperiment(args: z.infer<typeof EndExperimentSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const service = (customer as any).loadService("ExperimentServiceClient");
    const resourceName = toExperimentResourceName(args.customerId, args.experimentId);
    const validateOnly = resolveValidateOnlyFlag(args.validateOnly);
    const [result] = await service.endExperiment({
        experiment: resourceName,
        validate_only: validateOnly,
    }, {
        otherArgs: {
            headers: (customer as any).callHeaders,
        },
    });
    return {
        experimentResourceName: resourceName,
        validateOnly,
        result,
    };
}
const RemoveExperimentSchema = BaseSchema.extend({
    experimentId: z.string().describe("Experiment ID or resource name"),
});
async function removeExperiment(args: z.infer<typeof RemoveExperimentSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return runMutation(customer, [
        {
            experiment_operation: {
                remove: toExperimentResourceName(args.customerId, args.experimentId),
            },
        },
    ]);
}
const ListExperimentArmsSchema = BaseSchema.extend({
    experimentId: z.string().describe("Experiment ID or resource name"),
    limit: z.number().default(100),
});
async function listExperimentArms(args: z.infer<typeof ListExperimentArmsSchema>) {
    const resourceName = toExperimentResourceName(args.customerId, args.experimentId);
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      experiment_arm.resource_name,
      experiment_arm.name,
      experiment_arm.control,
      experiment_arm.traffic_split
    FROM experiment_arm
    WHERE experiment_arm.experiment = '${resourceName}'
    LIMIT ${args.limit}`,
    });
}
const ListExperimentAsyncErrorsSchema = BaseSchema.extend({
    experimentId: z.string().describe("Experiment ID or resource name"),
    pageSize: z.number().default(100),
    pageToken: z.string().optional(),
});
async function listExperimentAsyncErrors(args: z.infer<typeof ListExperimentAsyncErrorsSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const service = (customer as any).loadService("ExperimentServiceClient");
    const resourceName = toExperimentResourceName(args.customerId, args.experimentId);
    const [statuses, request, response] = await service.listExperimentAsyncErrors({
        resource_name: resourceName,
        page_size: args.pageSize,
        page_token: args.pageToken,
    }, {
        otherArgs: {
            headers: (customer as any).callHeaders,
        },
    });
    return {
        experimentResourceName: resourceName,
        statuses,
        request,
        nextPageToken: response?.next_page_token,
        response,
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
export function registerExperimentsAdvancedTools(server: McpServer) {
    server.registerTool("update_experiment", { description: "Update experiment metadata and status.", inputSchema: UpdateExperimentSchema.shape }, args => asTool(updateExperiment, args));
    server.registerTool("schedule_experiment", { description: "Schedule an experiment execution.", inputSchema: ScheduleExperimentSchema.shape }, args => asTool(scheduleExperiment, args));
    server.registerTool("promote_experiment", { description: "Promote an experiment to base campaign.", inputSchema: PromoteExperimentSchema.shape }, args => asTool(promoteExperiment, args));
    server.registerTool("end_experiment", { description: "End a running experiment.", inputSchema: EndExperimentSchema.shape }, args => asTool(endExperiment, args));
    server.registerTool("remove_experiment", { description: "Remove an experiment.", inputSchema: RemoveExperimentSchema.shape }, args => asTool(removeExperiment, args));
    server.registerTool("list_experiment_arms", { description: "List experiment arms.", inputSchema: ListExperimentArmsSchema.shape }, args => asTool(listExperimentArms, args));
    server.registerTool("list_experiment_async_errors", { description: "List asynchronous errors from schedule/promote experiment operations.", inputSchema: ListExperimentAsyncErrorsSchema.shape }, args => asTool(listExperimentAsyncErrors, args));
}
