import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import { CHAT_REQUEST_STATUSES } from "@/lib/domain-enums";

export type { ChatRequestStatus } from "@/lib/domain-enums";
export { CHAT_REQUEST_STATUSES };

const chatRequestSchema = new Schema(
  {
    requesterId: { type: String, required: true },
    recipientId: { type: String, required: true },
    pairKey: { type: String, required: true },
    propertyId: { type: String, default: "" },
    status: { type: String, enum: [...CHAT_REQUEST_STATUSES], default: "pending" },
    decidedById: { type: String, default: "" },
    decisionNote: { type: String, default: "" },
    decidedAt: { type: Date },
    threadId: { type: String, default: "" },
  },
  { timestamps: true },
);

chatRequestSchema.index({ recipientId: 1, status: 1, createdAt: -1 });
chatRequestSchema.index({ requesterId: 1, status: 1, createdAt: -1 });
chatRequestSchema.index(
  { requesterId: 1, recipientId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);
chatRequestSchema.index({ pairKey: 1, status: 1 });

export type ChatRequestDocument = InferSchemaType<typeof chatRequestSchema>;

export const ChatRequest = mongoose.models.ChatRequest || model("ChatRequest", chatRequestSchema);
