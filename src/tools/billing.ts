import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";
import { toErrorMessage } from "../observability/errorMessage";

const ListInvoicesSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  billingSetupId: z.string().describe("The Billing Setup ID"),
  issueYear: z.string().describe("The issue year (YYYY)"),
  issueMonth: z.enum([
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", 
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
  ]).describe("The issue month"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListInvoicesToolSchema = ListInvoicesSchema;
export async function listInvoices(args: z.infer<typeof ListInvoicesSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  try {
    const result = await customer.invoices.listInvoices({
      customer_id: args.customerId,
      billing_setup: `customers/${args.customerId}/billingSetups/${args.billingSetupId}`,
      issue_year: args.issueYear,
      issue_month: args.issueMonth,
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to list invoices: ${toErrorMessage(error)}`);
    throw error;
  }
}

const ListAccountBudgetsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  limit: z.number().default(50),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListAccountBudgetsToolSchema = ListAccountBudgetsSchema;
export async function listAccountBudgets(args: z.infer<typeof ListAccountBudgetsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  const query = `
    SELECT
      account_budget.id,
      account_budget.name,
      account_budget.status,
      account_budget.approved_spending_limit_micros,
      account_budget.adjusted_spending_limit_micros,
      account_budget.total_adjustments_micros,
      account_budget.amount_served_micros,
      account_budget.purchase_order_number,
      account_budget.billing_setup
    FROM account_budget
    ORDER BY account_budget.id DESC
    LIMIT ${args.limit}
  `;
  
  return customer.query(query);
}

const ListBillingSetupsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListBillingSetupsToolSchema = ListBillingSetupsSchema;
export async function listBillingSetups(args: z.infer<typeof ListBillingSetupsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  const query = `
    SELECT
      billing_setup.id,
      billing_setup.status,
      billing_setup.payments_account,
      billing_setup.payments_account_info.payments_account_id,
      billing_setup.payments_account_info.payments_account_name
    FROM billing_setup
  `;
  
  return customer.query(query);
}
