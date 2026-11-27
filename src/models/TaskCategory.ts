import mongoose, { type InferSchemaType, model, Schema } from "mongoose";

/** A custom task category an admin adds on top of the built-in list. */
const taskCategorySchema = new Schema(
  {
    ownerId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    /** Lower-cased name for case-insensitive uniqueness per admin. */
    key: { type: String, required: true, trim: true, lowercase: true, maxlength: 60 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

taskCategorySchema.index({ ownerId: 1, key: 1 }, { unique: true });

export type TaskCategoryDocument = InferSchemaType<typeof taskCategorySchema>;

export const TaskCategory =
  mongoose.models.TaskCategory || model<TaskCategoryDocument>("TaskCategory", taskCategorySchema);
