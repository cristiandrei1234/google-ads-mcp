import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import logger from "../observability/logger";
import { toErrorMessage } from "../observability/errorMessage";

// --- Experiments ---

const ListExperimentsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  limit: z.number().default(50),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListExperimentsToolSchema = ListExperimentsSchema;
export async function listExperiments(args: z.infer<typeof ListExperimentsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const query = `
    SELECT
      experiment.experiment_id,
      experiment.name,
      experiment.status,
      experiment.type,
      experiment.suffix,
      experiment.resource_name
    FROM experiment
    LIMIT ${args.limit}
  `;
  
  return customer.query(query);
}

const CreateExperimentSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  name: z.string().describe("The name of the experiment"),
  suffix: z.string().describe("The suffix to append to the names of the trial campaigns"),
  type: z
    .enum([
      "AD_VARIATION",
      "DISPLAY_AND_VIDEO_360",
      "YOUTUBE_CUSTOM",
      "DISPLAY_CUSTOM",
      "SEARCH_CUSTOM",
      "DISPLAY_AUTOMATED_BIDDING_STRATEGY",
      "SEARCH_AUTOMATED_BIDDING_STRATEGY",
      "SHOPPING_AUTOMATED_BIDDING_STRATEGY",
      "SMART_MATCHING",
      "HOTEL_CUSTOM",
    ])
    .default("SEARCH_CUSTOM"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const CreateExperimentToolSchema = CreateExperimentSchema;
export async function createExperiment(args: z.infer<typeof CreateExperimentSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  const validateOnly = ["1", "true", "yes"].includes(
    (process.env.GOOGLE_ADS_VALIDATE_ONLY || "").toLowerCase()
  );

  const typeToEnumValue: Record<z.infer<typeof CreateExperimentSchema>["type"], number> = {
    DISPLAY_AND_VIDEO_360: 2,
    AD_VARIATION: 3,
    YOUTUBE_CUSTOM: 5,
    DISPLAY_CUSTOM: 6,
    SEARCH_CUSTOM: 7,
    DISPLAY_AUTOMATED_BIDDING_STRATEGY: 8,
    SEARCH_AUTOMATED_BIDDING_STRATEGY: 9,
    SHOPPING_AUTOMATED_BIDDING_STRATEGY: 10,
    SMART_MATCHING: 11,
    HOTEL_CUSTOM: 12,
  };

  try {
    const service = (customer as any).loadService("ExperimentServiceClient");
    const [result] = await service.mutateExperiments(
      {
        customer_id: args.customerId.replace(/-/g, ""),
        operations: [
          {
            create: {
              name: args.name,
              suffix: args.suffix,
              // Explicit enum numbers avoid inconsistent string-to-enum coercion.
              type: typeToEnumValue[args.type],
              // Required on create: experiments must start in SETUP status.
              status: 6,
            },
          },
        ],
        validate_only: validateOnly,
      },
      {
        otherArgs: {
          headers: (customer as any).callHeaders,
        },
      }
    );

    return result;
  } catch (error: any) {
    logger.error(`Failed to create experiment: ${toErrorMessage(error)}`);
    throw error;
  }
}

// --- Reach Planning ---

const ListReachPlanLocationsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListReachPlanLocationsToolSchema = ListReachPlanLocationsSchema;
export async function listReachPlanLocations(args: z.infer<typeof ListReachPlanLocationsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  try {
    const result = await (customer as any).reachPlans.listPlannableLocations({});
    return result;
  } catch (error: any) {
    logger.error(`Failed to list reach plan locations: ${toErrorMessage(error)}`);
    throw error;
  }
}

const GenerateReachForecastSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  locationId: z.string().describe("The location ID (e.g., '2840' for US)"),
  currencyCode: z.string().default("USD"),
  budgetMicros: z.string().describe("The budget in micros (e.g., '10000000' for 10 units)"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const GenerateReachForecastToolSchema = GenerateReachForecastSchema;
export async function generateReachForecast(args: z.infer<typeof GenerateReachForecastSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  try {
    const products = await (customer as any).reachPlans.listPlannableProducts({
      plannable_location_id: args.locationId,
    });
    const plannableProductCode =
      products?.product_metadata?.[0]?.plannable_product_code ||
      products?.productMetadata?.[0]?.plannableProductCode ||
      "YOUTUBE_IN_STREAM_LINEUP";

    const request = {
      customer_id: args.customerId,
      currency_code: args.currencyCode,
      targeting: {
        plannable_location_id: args.locationId,
      },
      planned_products: [
        {
          plannable_product_code: plannableProductCode,
          budget_micros: Number(args.budgetMicros),
        },
      ],
    };

    const result = await (customer as any).reachPlans.generateReachForecast(request);
    return result;
  } catch (error: any) {
    logger.error(`Failed to generate reach forecast: ${toErrorMessage(error)}`);
    throw error;
  }
}
