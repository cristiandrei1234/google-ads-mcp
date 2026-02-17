import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "crypto";
import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runQuery } from "./runQuery";
const BaseSchema = z.object({
    customerId: z.string().describe("The Google Ads Customer ID"),
    userId: z.string().optional().describe("SaaS User ID"),
});
const CustomerMatchMemberSchema = z
    .object({
    email: z.string().email().optional(),
    phoneNumber: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    countryCode: z.string().length(2).optional(),
    postalCode: z.string().optional(),
})
    .refine(member => Boolean(member.email) ||
    Boolean(member.phoneNumber) ||
    Boolean(member.firstName && member.lastName && member.countryCode && member.postalCode), {
    message: "Each member must include email, phoneNumber, or full address tuple (firstName,lastName,countryCode,postalCode).",
});
type CustomerMatchMember = z.infer<typeof CustomerMatchMemberSchema>;
function normalizeCustomerId(customerId: string): string {
    return customerId.replace(/-/g, "");
}
function extractResourceId(value: string, collection: string): string {
    const match = value.trim().match(new RegExp(`/${collection}/([^/]+)$`));
    return match?.[1] || value.trim();
}
function toUserListResourceName(customerId: string, userListIdOrResourceName: string): string {
    if (userListIdOrResourceName.startsWith("customers/")) {
        return userListIdOrResourceName;
    }
    const normalizedCustomerId = normalizeCustomerId(customerId);
    const userListId = extractResourceId(userListIdOrResourceName, "userLists");
    return `customers/${normalizedCustomerId}/userLists/${userListId}`;
}
function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}
function normalizePhone(phoneNumber: string): string {
    const trimmed = phoneNumber.trim();
    const hasPlusPrefix = trimmed.startsWith("+");
    const digitsOnly = trimmed.replace(/[^0-9]/g, "");
    return hasPlusPrefix ? `+${digitsOnly}` : digitsOnly;
}
function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}
function normalizePostalCode(postalCode: string): string {
    return postalCode.trim().toLowerCase().replace(/\s+/g, "");
}
function buildUserIdentifiers(member: CustomerMatchMember): Array<Record<string, unknown>> {
    const identifiers: Array<Record<string, unknown>> = [];
    if (member.email) {
        identifiers.push({
            hashed_email: sha256(normalizeEmail(member.email)),
        });
    }
    if (member.phoneNumber) {
        identifiers.push({
            hashed_phone_number: sha256(normalizePhone(member.phoneNumber)),
        });
    }
    if (member.firstName && member.lastName && member.countryCode && member.postalCode) {
        identifiers.push({
            address_info: {
                hashed_first_name: sha256(normalizeName(member.firstName)),
                hashed_last_name: sha256(normalizeName(member.lastName)),
                country_code: member.countryCode.trim().toUpperCase(),
                postal_code: normalizePostalCode(member.postalCode),
            },
        });
    }
    if (identifiers.length === 0) {
        throw new Error("At least one valid identifier is required for each customer match member.");
    }
    return identifiers;
}
function buildOfflineUserDataJobOperations(members: CustomerMatchMember[], mutationType: "create" | "remove"): Array<Record<string, unknown>> {
    return members.map(member => ({
        [mutationType]: {
            user_identifiers: buildUserIdentifiers(member),
        },
    }));
}
const AddCustomerMatchMembersSchema = BaseSchema.extend({
    resourceName: z.string().describe("customers/{customerId}/offlineUserDataJobs/{jobId}"),
    members: z.array(CustomerMatchMemberSchema).min(1),
    enablePartialFailure: z.boolean().default(true),
    enableWarnings: z.boolean().default(true),
});
async function addCustomerMatchMembers(args: z.infer<typeof AddCustomerMatchMembersSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).offlineUserDataJobs.addOfflineUserDataJobOperations({
        resource_name: args.resourceName,
        operations: buildOfflineUserDataJobOperations(args.members, "create"),
        enable_partial_failure: args.enablePartialFailure,
        enable_warnings: args.enableWarnings,
    });
}
const RemoveCustomerMatchMembersSchema = BaseSchema.extend({
    resourceName: z.string().describe("customers/{customerId}/offlineUserDataJobs/{jobId}"),
    members: z.array(CustomerMatchMemberSchema).min(1),
    enablePartialFailure: z.boolean().default(true),
    enableWarnings: z.boolean().default(true),
});
async function removeCustomerMatchMembers(args: z.infer<typeof RemoveCustomerMatchMembersSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    return (customer as any).offlineUserDataJobs.addOfflineUserDataJobOperations({
        resource_name: args.resourceName,
        operations: buildOfflineUserDataJobOperations(args.members, "remove"),
        enable_partial_failure: args.enablePartialFailure,
        enable_warnings: args.enableWarnings,
    });
}
const CreateCustomerMatchJobWithMembersSchema = BaseSchema.extend({
    userListId: z.string().describe("User list ID or resource name"),
    members: z.array(CustomerMatchMemberSchema).min(1),
    runNow: z.boolean().default(true),
    enablePartialFailure: z.boolean().default(true),
    enableWarnings: z.boolean().default(true),
});
async function createCustomerMatchJobWithMembers(args: z.infer<typeof CreateCustomerMatchJobWithMembersSchema>) {
    const customer = await getCustomer(args.customerId, args.userId);
    const normalizedCustomerId = normalizeCustomerId(args.customerId);
    const userListResourceName = toUserListResourceName(args.customerId, args.userListId);
    const createResponse = await (customer as any).offlineUserDataJobs.createOfflineUserDataJob({
        customer_id: normalizedCustomerId,
        job: {
            type: "CUSTOMER_MATCH_USER_LIST",
            customer_match_user_list_metadata: {
                user_list: userListResourceName,
            },
        },
    });
    const resourceName = String(createResponse?.resource_name || createResponse?.resourceName || "");
    if (!resourceName) {
        throw new Error("Offline user data job creation did not return resource_name.");
    }
    const addResponse = await (customer as any).offlineUserDataJobs.addOfflineUserDataJobOperations({
        resource_name: resourceName,
        operations: buildOfflineUserDataJobOperations(args.members, "create"),
        enable_partial_failure: args.enablePartialFailure,
        enable_warnings: args.enableWarnings,
    });
    let runResponse: unknown = null;
    if (args.runNow) {
        runResponse = await (customer as any).offlineUserDataJobs.runOfflineUserDataJob({
            resource_name: resourceName,
        });
    }
    return {
        resourceName,
        createResponse,
        addResponse,
        runResponse,
    };
}
const ListCustomerMatchJobsSchema = BaseSchema.extend({
    limit: z.number().default(50),
});
async function listCustomerMatchJobs(args: z.infer<typeof ListCustomerMatchJobsSchema>) {
    return runQuery({
        customerId: args.customerId,
        userId: args.userId,
        query: `SELECT
      offline_user_data_job.resource_name,
      offline_user_data_job.id,
      offline_user_data_job.type,
      offline_user_data_job.status,
      offline_user_data_job.failure_reason,
      offline_user_data_job.customer_match_user_list_metadata.user_list
    FROM offline_user_data_job
    WHERE offline_user_data_job.type = CUSTOMER_MATCH_USER_LIST
    ORDER BY offline_user_data_job.id DESC
    LIMIT ${args.limit}`,
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
export function registerCustomerMatchTools(server: McpServer) {
    server.registerTool("add_customer_match_members", { description: "Add hashed Customer Match members to an existing offline user data job.", inputSchema: AddCustomerMatchMembersSchema.shape }, args => asTool(addCustomerMatchMembers, args));
    server.registerTool("remove_customer_match_members", { description: "Remove Customer Match members in an existing offline user data job.", inputSchema: RemoveCustomerMatchMembersSchema.shape }, args => asTool(removeCustomerMatchMembers, args));
    server.registerTool("create_customer_match_job_with_members", { description: "Create an offline user data job for Customer Match, add members, and optionally run it.", inputSchema: CreateCustomerMatchJobWithMembersSchema.shape }, args => asTool(createCustomerMatchJobWithMembers, args));
    server.registerTool("list_customer_match_jobs", { description: "List offline Customer Match user data jobs and their status.", inputSchema: ListCustomerMatchJobsSchema.shape }, args => asTool(listCustomerMatchJobs, args));
}
