import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import { TASK_PRIORITIES } from "@/lib/domain-enums";
import {
  RECURRENCE_END_KINDS,
  RECURRENCE_FREQUENCIES,
  TASK_ASSIGNEE_KINDS,
  TASK_LOCATION_KINDS,
} from "@/lib/maintenance/enums";

/**
 * A recurring task template. The daily job creates a Task for every due
 * occurrence (once each — see the unique scheduleId+occurrenceDate index on
 * Task) and advances `nextRunDate`. Copies are created on schedule even if the
 * previous one is not done (client decision Q28).
 */
const taskScheduleSchema = new Schema(
  {
    ownerId: { type: String, required: true, trim: true },
    propertyId: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, trim: true, maxlength: 60, default: "" },
    priority: { type: String, enum: [...TASK_PRIORITIES], default: "medium" },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    location: {
      kind: { type: String, enum: [...TASK_LOCATION_KINDS], default: "property" },
      blockId: { type: String, default: "" },
      floorId: { type: String, default: "" },
      unitId: { type: String, default: "" },
      commonAreaId: { type: String, default: "" },
      label: { type: String, default: "" },
    },
    assignee: {
      kind: { type: String, enum: [...TASK_ASSIGNEE_KINDS, ""], default: "" },
      userId: { type: String, default: "" },
      vendorId: { type: String, default: "" },
      name: { type: String, default: "" },
    },
    rule: {
      frequency: { type: String, enum: [...RECURRENCE_FREQUENCIES], required: true },
      /** Every N units of `frequency` (1 = every day/week/month/year). */
      interval: { type: Number, min: 1, max: 365, default: 1 },
    },
    /** First occurrence (YYYY-MM-DD, Nairobi calendar day). */
    startDate: { type: String, required: true, trim: true },
    /** Days between an occurrence being created and its due date. */
    dueAfterDays: { type: Number, min: 0, max: 60, default: 0 },
    end: {
      kind: { type: String, enum: [...RECURRENCE_END_KINDS], default: "never" },
      count: { type: Number, min: 1, max: 1000, default: null },
      until: { type: String, default: "" },
    },
    occurrencesCreated: { type: Number, default: 0, min: 0 },
    /** Next occurrence to create (YYYY-MM-DD); "" once the schedule has ended. */
    nextRunDate: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true, trim: true },
    createdByRole: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

taskScheduleSchema.index({ isActive: 1, nextRunDate: 1 });
taskScheduleSchema.index({ ownerId: 1, propertyId: 1 });

export type TaskScheduleDocument = InferSchemaType<typeof taskScheduleSchema>;

export const TaskSchedule =
  mongoose.models.TaskSchedule || model<TaskScheduleDocument>("TaskSchedule", taskScheduleSchema);
