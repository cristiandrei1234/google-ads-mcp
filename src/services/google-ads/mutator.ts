// import { GoogleAdsClient } from "google-ads-api";
import logger from "../../observability/logger";

interface MutateOptions {
  dryRun?: boolean;
  partialFailure?: boolean;
}

function normalizeMutation(mutation: any) {
  if (mutation && mutation.entity && mutation.resource !== undefined) {
    return mutation;
  }

  if (!mutation || typeof mutation !== "object") {
    throw new Error("Invalid mutation payload: expected object.");
  }

  const operationKey = Object.keys(mutation).find(key => key.endsWith("_operation"));
  if (!operationKey) {
    throw new Error(
      `Invalid mutation payload: no '*_operation' key found. Keys: ${Object.keys(mutation).join(", ")}`
    );
  }

  const operationPayload = mutation[operationKey];
  if (!operationPayload || typeof operationPayload !== "object") {
    throw new Error(`Invalid mutation payload at '${operationKey}': expected object.`);
  }

  const entity = operationKey.replace(/_operation$/, "");

  if (operationPayload.create !== undefined) {
    return {
      entity,
      operation: "create",
      resource: operationPayload.create,
      exempt_policy_violation_keys: operationPayload.exempt_policy_violation_keys,
    };
  }

  if (operationPayload.update !== undefined) {
    return {
      entity,
      operation: "update",
      resource: operationPayload.update,
    };
  }

  if (operationPayload.remove !== undefined) {
    return {
      entity,
      operation: "remove",
      resource: operationPayload.remove,
    };
  }

  throw new Error(
    `Invalid mutation payload at '${operationKey}': expected one of create/update/remove keys.`
  );
}

export async function runMutation(
  customer: any,
  mutations: any[],
  options: MutateOptions = { dryRun: false, partialFailure: false }
) {
  const forceValidateOnly = ["1", "true", "yes"].includes(
    (process.env.GOOGLE_ADS_VALIDATE_ONLY || "").toLowerCase()
  );
  const validateOnly = options.dryRun || forceValidateOnly;

  logger.info(
    `Running mutation with options: ${JSON.stringify({
      ...options,
      validateOnly,
      forceValidateOnly,
    })}`
  );
  
  try {
    const normalizedMutations = mutations.map(normalizeMutation);

    const result = await customer.mutateResources(normalizedMutations, {
      partial_failure: options.partialFailure,
      validate_only: validateOnly,
    });
    return result;
  } catch (error: any) {
    logger.error(`Mutation failed: ${error.message}`);
    throw error;
  }
}
