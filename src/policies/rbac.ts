import { z } from "zod";
import config from "../config/env";
import logger from "../observability/logger";

// A simple RBAC model
export enum Permission {
  READ = "read",
  WRITE = "write",
  ADMIN = "admin",
}

export const PolicySchema = z.object({
  allowedCustomers: z.array(z.string()).optional(), // If empty, all accessible are allowed
  allowedTools: z.array(z.string()).optional(), // If empty, all tools are allowed
  role: z.enum(["read", "write", "admin"]).default("write"),
});

export type Policy = z.infer<typeof PolicySchema>;

// In a real scenario, this would load from a database or config file per user/tenant
const defaultPolicy: Policy = {
  role: "write", // Defaulting to write for single-user CLI
};

export function checkPermission(toolName: string, customerId?: string): boolean {
  // 1. Check Role vs Tool Type (Convention: read tools start with list/get, write with create/update/remove)
  const isWriteTool = /^(create|update|remove|add|pause|enable|upload|link|unlink|run|apply|dismiss|insert|delete)/.test(toolName);
  
  if (isWriteTool && defaultPolicy.role === "read") {
    logger.warn(`Access denied for tool ${toolName}: Write permission required.`);
    return false;
  }

  // 2. Check Customer Access
  if (customerId && defaultPolicy.allowedCustomers && defaultPolicy.allowedCustomers.length > 0) {
    if (!defaultPolicy.allowedCustomers.includes(customerId)) {
      logger.warn(`Access denied for customer ${customerId}: Not in allowlist.`);
      return false;
    }
  }

  // 3. Check Tool Allowlist
  if (defaultPolicy.allowedTools && defaultPolicy.allowedTools.length > 0) {
    if (!defaultPolicy.allowedTools.includes(toolName)) {
      logger.warn(`Access denied for tool ${toolName}: Not in allowlist.`);
      return false;
    }
  }

  return true;
}
