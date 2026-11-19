import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import {
  CHAT_AGENT_ROLES,
  type ChatAgentRole,
  MESSAGE_SENDER_ROLES,
  type MessageSenderRole,
} from "@/lib/domain-enums";

export type { ChatAgentRole, MessageSenderRole };
export { CHAT_AGENT_ROLES, MESSAGE_SENDER_ROLES };

export interface IChatThread {
  tenantId: string;
  propertyId: string;
  ownerId: string;
  agentUserId: string;
  agentRole: ChatAgentRole;
  lastMessageAt: Date;
  lastMessageText: string;
  tenantLastReadAt?: Date;
  agentLastReadAt?: Date;
}

const chatThreadSchema = new Schema<IChatThread>(
  {
    tenantId: { type: String, required: true },
    propertyId: { type: String, required: false },
    ownerId: { type: String, required: true },
    agentUserId: { type: String, required: true },
    agentRole: { type: String, enum: [...CHAT_AGENT_ROLES], default: "owner" },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessageText: { type: String, default: "" },
    tenantLastReadAt: { type: Date },
    agentLastReadAt: { type: Date },
  },
  {
    timestamps: true,
  },
);

chatThreadSchema.index({ tenantId: 1, propertyId: 1, agentUserId: 1 }, { unique: true });
chatThreadSchema.index({ ownerId: 1, lastMessageAt: -1 });
chatThreadSchema.index({ agentUserId: 1, lastMessageAt: -1 });

export type ChatThreadDocument = InferSchemaType<IChatThread>;

export const ChatThread =
  mongoose.models.ChatThread || model<IChatThread>("ChatThread", chatThreadSchema);
