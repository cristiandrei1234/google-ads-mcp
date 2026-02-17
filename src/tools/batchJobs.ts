import { z } from "zod";
import { getCustomer } from "../services/google-ads/client";
import { runMutation } from "../services/google-ads/mutator";
import logger from "../observability/logger";

// --- Batch Job Management ---

const CreateBatchJobSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  scramblingId: z.string().optional().describe("Optional scrambling ID for the batch job"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const CreateBatchJobToolSchema = CreateBatchJobSchema;
export async function createBatchJob(args: z.infer<typeof CreateBatchJobSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  try {
    const service = (customer as any).loadService("BatchJobServiceClient");
    const operation: any = { create: {} };
    if (args.scramblingId) {
      operation.create.scrambling_id = args.scramblingId;
    }

    const [result] = await service.mutateBatchJob(
      {
        customer_id: args.customerId,
        operation,
      },
      {
        otherArgs: {
          headers: (customer as any).callHeaders,
        },
      }
    );
    return result;
  } catch (error: any) {
    logger.error(`Failed to create batch job: ${error.message}`);
    throw error;
  }
}

const ListBatchJobsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  limit: z.number().default(50),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const ListBatchJobsToolSchema = ListBatchJobsSchema;
export async function listBatchJobs(args: z.infer<typeof ListBatchJobsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  const query = `
    SELECT
      batch_job.id,
      batch_job.resource_name,
      batch_job.status,
      batch_job.metadata.creation_date_time,
      batch_job.metadata.completion_date_time,
      batch_job.metadata.estimated_completion_ratio,
      batch_job.metadata.operation_count,
      batch_job.metadata.executed_operation_count
    FROM batch_job
    ORDER BY batch_job.id DESC
    LIMIT ${args.limit}
  `;
  
  return customer.query(query);
}

const RunBatchJobSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  batchJobResourceName: z.string().describe("The resource name of the batch job to run"),
  userId: z.string().optional().describe("SaaS User ID"),
});

export const RunBatchJobToolSchema = RunBatchJobSchema;
export async function runBatchJob(args: z.infer<typeof RunBatchJobSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);
  
  try {
    const result = await customer.batchJobs.runBatchJob({
      resource_name: args.batchJobResourceName,
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to run batch job: ${error.message}`);
    throw error;
  }
}

const AddBatchJobOperationsSchema = z.object({
  customerId: z.string().describe("The Google Ads Customer ID"),
  batchJobResourceName: z.string().describe("The resource name of the batch job"),
  operations: z.array(z.any()).describe("List of mutate operations to add"),
  userId: z.string().optional().describe("SaaS User ID"),
});

// Note: This tool is complex because 'operations' is a polymorphic list of any Google Ads operation.
// In a real CLI/MCP context, passing complex JSON objects for operations might be tricky.
// We'll keep it generic for now, assuming the user knows the JSON structure of a MutateOperation.

export const AddBatchJobOperationsToolSchema = AddBatchJobOperationsSchema;
export async function addBatchJobOperations(args: z.infer<typeof AddBatchJobOperationsSchema>) {
  const customer = await getCustomer(args.customerId, args.userId);

  if (!args.operations || args.operations.length === 0) {
    return {
      skipped: true,
      reason: "No operations provided. Pass at least one mutate operation.",
    };
  }
  
  try {
    const result = await customer.batchJobs.addBatchJobOperations({
      resource_name: args.batchJobResourceName,
      mutate_operations: args.operations,
    } as any);
    return result;
  } catch (error: any) {
    logger.error(`Failed to add operations to batch job: ${error.message}`);
    throw error;
  }
}
