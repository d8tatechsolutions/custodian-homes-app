import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import {
  CHAT_AGENT_ROLES,
  type ChatAgentRole,
  MESSAGE_SENDER_ROLES,
  type MessageSenderRole,
} from "@/lib/domain-enums";

export type { ChatAgentRole, MessageSenderRole };
export { CHAT_AGENT_ROLES, MESSAGE_SENDER_ROLES };

export interface IChatThreadRead {
  userId: string;
  lastReadAt: Date;
}

export interface IChatThread {
  // DM identity (new). Legacy display fields below stay optional so existing
  // property-scoped threads keep loading unchanged until the backfill runs.
  participants: string[];
  pairKey: string;
  dmKey?: string;
  reads: IChatThreadRead[];
  kind: "dm" | "legacy-property";
  status: "active" | "pending";
  // Legacy display fields.
  tenantId?: string;
  propertyId?: string;
  ownerId?: string;
  agentUserId?: string;
  agentRole: ChatAgentRole;
  lastMessageAt: Date;
  lastMessageText: string;
  tenantLastReadAt?: Date;
  agentLastReadAt?: Date;
}

const chatThreadReadSchema = new Schema<IChatThreadRead>(
  { userId: { type: String, required: true }, lastReadAt: { type: Date, required: true } },
  { _id: false },
);

const chatThreadSchema = new Schema<IChatThread>(
  {
    participants: { type: [String], default: [] },
    pairKey: { type: String, default: "" },
    // No default: legacy threads must omit dmKey so the sparse unique index
    // excludes them instead of colliding on an empty string.
    dmKey: { type: String, required: false },
    reads: { type: [chatThreadReadSchema], default: [] },
    kind: { type: String, enum: ["dm", "legacy-property"], default: "dm" },
    status: { type: String, enum: ["active", "pending"], default: "active" },
    tenantId: { type: String, required: false, default: "" },
    propertyId: { type: String, required: false, default: "" },
    ownerId: { type: String, required: false, default: "" },
    agentUserId: { type: String, required: false, default: "" },
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

// Legacy property threads keep their old uniqueness rule; DM threads are
// deduplicated by the sparse dmKey index instead (empty legacy fields would
// otherwise collide across unrelated pairs).
chatThreadSchema.index(
  { tenantId: 1, propertyId: 1, agentUserId: 1 },
  { unique: true, partialFilterExpression: { kind: "legacy-property" } },
);
chatThreadSchema.index({ ownerId: 1, lastMessageAt: -1 });
chatThreadSchema.index({ agentUserId: 1, lastMessageAt: -1 });
chatThreadSchema.index({ participants: 1 });
chatThreadSchema.index({ pairKey: 1 });
chatThreadSchema.index({ dmKey: 1 }, { unique: true, sparse: true });
chatThreadSchema.index({ "reads.userId": 1 });

export type ChatThreadDocument = InferSchemaType<IChatThread>;

export const ChatThread =
  mongoose.models.ChatThread || model<IChatThread>("ChatThread", chatThreadSchema);
