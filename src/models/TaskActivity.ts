import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import { TASK_ACTIVITY_KINDS } from "@/lib/maintenance/enums";

/**
 * Append-only history for a task: comments plus every meaningful change
 * (status, assignment, photos, quote, approval, costs, complaint links, tenant
 * confirmation). `kind: "notify"` rows record emails sent to service
 * providers (who have no account, so no in-app notification).
 */
const taskActivitySchema = new Schema(
  {
    taskId: { type: String, required: true, trim: true },
    ownerId: { type: String, required: true, trim: true },
    actorId: { type: String, required: true, trim: true },
    actorRole: { type: String, required: true, trim: true },
    actorName: { type: String, trim: true, default: "" },
    kind: { type: String, enum: [...TASK_ACTIVITY_KINDS], required: true },
    /** Free text for comments; a short human summary for events. */
    message: { type: String, trim: true, maxlength: 2000, default: "" },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

taskActivitySchema.index({ taskId: 1, createdAt: 1 });
taskActivitySchema.index({ ownerId: 1, kind: 1, createdAt: -1 });

export type TaskActivityDocument = InferSchemaType<typeof taskActivitySchema>;

export const TaskActivity =
  mongoose.models.TaskActivity || model<TaskActivityDocument>("TaskActivity", taskActivitySchema);
