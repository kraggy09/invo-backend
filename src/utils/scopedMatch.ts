import { Types } from "mongoose";

/**
 * Creates a scoped $match stage for MongoDB aggregation pipelines.
 * MUST be the FIRST stage in every aggregation in a multi-tenant context.
 * Prevents cross-shop data leakage in aggregations (which bypass Mongoose query hooks).
 *
 * @example
 * Bill.aggregate([
 *   scopedMatch(req.shopId, { createdAt: { $gte: start, $lte: end } }),
 *   { $group: { ... } }
 * ])
 */
export const scopedMatch = (
  shopId: Types.ObjectId,
  criteria: Record<string, any> = {}
): { $match: Record<string, any> } => ({
  $match: { shopId, ...criteria },
});
