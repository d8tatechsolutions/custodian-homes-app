import type { Types } from "mongoose";

/**
 * A `.lean()` result: the schema's fields (from the model's
 * `InferSchemaType` document type) plus `_id`. Use it instead of `as any`.
 */
export type Lean<T> = T & { _id: Types.ObjectId };
