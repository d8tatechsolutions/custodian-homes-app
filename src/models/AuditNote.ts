import mongoose, { type InferSchemaType, model, Schema } from "mongoose";

/**
 * A note the system admin adds to an audit entry (a correction, context, a
 * ticket reference). Audit entries themselves are never edited or deleted,
 * so a note is the only way to annotate one; the original stays as recorded.
 */
const auditNoteSchema = new Schema(
  {
    auditEventId: { type: String, required: true },
    authorUserId: { type: String, required: true },
    authorName: { type: String, default: "" },
    text: { type: String, required: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

auditNoteSchema.index({ auditEventId: 1, createdAt: 1 });

export type AuditNoteDocument = InferSchemaType<typeof auditNoteSchema>;

export const AuditNote =
  mongoose.models.AuditNote || model<AuditNoteDocument>("AuditNote", auditNoteSchema);
