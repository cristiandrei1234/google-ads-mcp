import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";

// --- Conversion Actions ---

const CreateConversionActionSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  name: z.string().describe("The name of the conversion action"),
  type: z
    .enum([
      "WEBPAGE",
      "UPLOAD_CLICKS",
      "UPLOAD_CALLS",
      "WEBSITE_CALL",
      "GOOGLE_HOSTED",
      "LEAD_FORM_SUBMIT",
    ])
    .default("WEBPAGE")
    .describe("The conversion action type"),
  category: z.string().default("DEFAULT").describe("The category (e.g., PURCHASE, LEAD, SIGNUP)"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const CreateConversionActionToolSchema = CreateConversionActionSchema;
export async function createConversionAction(args: z.infer<typeof CreateConversionActionSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  const operation = {
    conversion_action_operation: {
      create: {
        name: args.name,
        type: args.type,
        category: args.category,
        status: "ENABLED"
      }
    }
  };

  return runMutation(customer, [operation]);
}

const ListConversionActionsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListConversionActionsToolSchema = ListConversionActionsSchema;
export async function listConversionActions(args: z.infer<typeof ListConversionActionsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const query = `
    SELECT 
      conversion_action.id,
      conversion_action.name,
      conversion_action.type,
      conversion_action.status,
      conversion_action.category,
      conversion_action.owner_customer,
      conversion_action.include_in_conversions_metric
    FROM conversion_action
  `;
  
  const result = await customer.query(query);
  return result;
}

// --- Conversion Uploads ---

const UploadClickConversionSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  conversionActionId: z.string().describe("The ID of the conversion action (optional, usually name works too but ID is safer)"),
  gclid: z.string().describe("The Google Click ID (gclid)"),
  conversionDateTime: z.string().describe("The date and time of the conversion (e.g., '2023-10-27 12:32:45-05:00')"),
  conversionValue: z.number().optional().describe("The value of the conversion"),
  currencyCode: z.string().optional().describe("Currency code (e.g., USD)"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const UploadClickConversionToolSchema = UploadClickConversionSchema;
export async function uploadClickConversion(args: z.infer<typeof UploadClickConversionSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  // For uploading click conversions, we don't use the standard mutator as it targets specific services.
  // We use customer.conversionUploads.uploadClickConversions()
  
  // Actually, google-ads-api wraps this nicely.
  // Or we can use `conversion_upload_service`.
  
  // Let's use the service method directly if available, or construct the request.
  // The method is `uploadClickConversions`.
  
  const conversion = {
    gclid: args.gclid,
    conversion_action: `customers/${args.customerId}/conversionActions/${args.conversionActionId}`, // Resource name required usually
    conversion_date_time: args.conversionDateTime,
    conversion_value: args.conversionValue,
    currency_code: args.currencyCode,
  };

  try {
    const result = await customer.conversionUploads.uploadClickConversions({
      customer_id: args.customerId,
      conversions: [conversion],
      partial_failure: true,
      validate_only: false 
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to upload click conversion: ${error.message}`);
    throw error;
  }
}
