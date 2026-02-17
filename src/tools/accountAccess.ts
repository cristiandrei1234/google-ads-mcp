import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUserAccounts, setSelectedAccounts, setSingleDefaultAccount, removeAccountAssociation, } from "../services/db";
const UserIdSchema = z.object({
    userId: z.string().describe("SaaS User ID"),
});
export const ListUserLinkedAccountsToolSchema = UserIdSchema;
export async function listUserLinkedAccounts(args: z.infer<typeof ListUserLinkedAccountsToolSchema>) {
    const accounts = await getUserAccounts(args.userId);
    return {
        userId: args.userId,
        accounts: accounts.map(account => ({
            customerId: account.customerId,
            selected: account.isDefault,
            createdAt: account.createdAt,
        })),
    };
}
export const SelectUserAccountsToolSchema = z.object({
    userId: z.string().describe("SaaS User ID"),
    customerIds: z.array(z.string()).describe("Customer IDs to include in MCP calls"),
});
export async function selectUserAccounts(args: z.infer<typeof SelectUserAccountsToolSchema>) {
    const accounts = await setSelectedAccounts(args.userId, args.customerIds);
    return {
        userId: args.userId,
        selectedCustomerIds: accounts.filter(account => account.isDefault).map(account => account.customerId),
        linkedCustomerIds: accounts.map(account => account.customerId),
    };
}
export const SetDefaultUserAccountToolSchema = z.object({
    userId: z.string().describe("SaaS User ID"),
    customerId: z.string().describe("Customer ID to set as default/selected"),
});
export async function setDefaultUserAccount(args: z.infer<typeof SetDefaultUserAccountToolSchema>) {
    const accounts = await setSingleDefaultAccount(args.userId, args.customerId);
    return {
        userId: args.userId,
        selectedCustomerIds: accounts.filter(account => account.isDefault).map(account => account.customerId),
        linkedCustomerIds: accounts.map(account => account.customerId),
    };
}
export const DisconnectUserAccountToolSchema = z.object({
    userId: z.string().describe("SaaS User ID"),
    customerId: z.string().describe("Customer ID to unlink from this user"),
});
export async function disconnectUserAccount(args: z.infer<typeof DisconnectUserAccountToolSchema>) {
    const accounts = await removeAccountAssociation(args.userId, args.customerId);
    return {
        userId: args.userId,
        removedCustomerId: args.customerId.replace(/-/g, ""),
        remainingLinkedCustomerIds: accounts.map(account => account.customerId),
        selectedCustomerIds: accounts.filter(account => account.isDefault).map(account => account.customerId),
    };
}
export function registerAccountAccessTools(server: McpServer) {
    server.registerTool("list_user_linked_accounts", { description: "List linked Google Ads accounts for a SaaS user.", inputSchema: ListUserLinkedAccountsToolSchema.shape }, async (args) => {
        try {
            const result = await listUserLinkedAccounts(args);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error: any) {
            return {
                content: [{ type: "text", text: `Error: ${error.message}` }],
                isError: true,
            };
        }
    });
    server.registerTool("select_user_accounts", { description: "Select which linked accounts should be included for MCP calls.", inputSchema: SelectUserAccountsToolSchema.shape }, async (args) => {
        try {
            const result = await selectUserAccounts(args);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error: any) {
            return {
                content: [{ type: "text", text: `Error: ${error.message}` }],
                isError: true,
            };
        }
    });
    server.registerTool("set_default_user_account", { description: "Set a single default account for MCP calls.", inputSchema: SetDefaultUserAccountToolSchema.shape }, async (args) => {
        try {
            const result = await setDefaultUserAccount(args);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error: any) {
            return {
                content: [{ type: "text", text: `Error: ${error.message}` }],
                isError: true,
            };
        }
    });
    server.registerTool("disconnect_user_account", { description: "Unlink one Google Ads customer from a SaaS user.", inputSchema: DisconnectUserAccountToolSchema.shape }, async (args) => {
        try {
            const result = await disconnectUserAccount(args);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error: any) {
            return {
                content: [{ type: "text", text: `Error: ${error.message}` }],
                isError: true,
            };
        }
    });
}
