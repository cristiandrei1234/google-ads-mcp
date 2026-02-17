import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";

// --- User Lists (Audiences) ---

const CreateUserListSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  name: z.string().describe("Name of the user list"),
  description: z.string().optional().describe("Description of the user list"),
  membershipLifeSpan: z.number().optional().default(30).describe("Number of days a user remains in the list (default 30, max 540)"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const CreateUserListToolSchema = CreateUserListSchema;
export async function createUserList(args: z.infer<typeof CreateUserListSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  // Creating a basic CRM based user list (Customer Match)
  // or a logical user list. Let's default to CRM_BASED as it's common for uploads.
  // Or maybe REMARKETING.
  // Let's make it generic or default to CRM_BASED for "Customer Match".
  
  const operation = {
    user_list_operation: {
      create: {
        name: args.name,
        description: args.description,
        membership_life_span: args.membershipLifeSpan,
        crm_based_user_list: {
          upload_key_type: "CONTACT_INFO" // Default for email/phone matching
        }
      }
    }
  };

  return runMutation(customer, [operation]);
}

const ListUserListsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListUserListsToolSchema = ListUserListsSchema;
export async function listUserLists(args: z.infer<typeof ListUserListsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const query = `
    SELECT 
      user_list.id,
      user_list.name,
      user_list.type,
      user_list.membership_life_span,
      user_list.size_for_search,
      user_list.size_for_display
    FROM user_list
  `;
  
  const result = await customer.query(query);
  return result;
}
