import { z } from "zod";

/**
 * Fields shared by every tool's input schema.
 *
 * Identity is deliberately absent: it comes from the authenticated session
 * (AsyncLocalStorage), never from arguments, so a client cannot act as another
 * tenant by naming one.
 */
export const BaseSchema = z.object({
  customerId: z.string().describe("Google Ads customer ID, digits only (no dashes)."),
});

/** {@link BaseSchema} plus a bounded `limit` for list-style tools. */
export const LimitedListSchema = BaseSchema.extend({
  limit: z.number().int().min(1).max(1000).default(100),
});

/** Split an array into consecutive sub-arrays of at most `size` items. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
