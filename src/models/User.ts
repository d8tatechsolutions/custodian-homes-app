import mongoose, { type InferSchemaType, model, Schema } from "mongoose";
import { generateUserCode } from "@/lib/user-code";

export interface IUserSettings {
  emailNotifications: boolean;
  smsNotifications: boolean;
  marketingEmails: boolean;
  moderationReminders: boolean;
  language: string;
  theme: string;
}

export interface IUser {
  email?: string;
  /**
   * Permanent, unique `CXXXXXX` identifier. Optional at the schema level so
   * documents written before the rollout remain valid; generation is enforced
   * by the `pre("validate")` hook and the creation-path retry wrapper.
   */
  userCode?: string;
  name: string;
  passwordHash: string;
  role: "tenant" | "caretaker" | "custodian" | "admin" | "broker" | "system-admin";
  privileges: string[];
  isActive: boolean;
  isVerified: boolean;
  phone: string;
  whatsapp: string;
  nationalId: string;
  verificationToken?: string;
  verificationTokenExpiry?: Date;
  /**
   * Monotonic session version. Bumped whenever the account's role or security
   * posture changes; JWTs carrying an older value are rejected so a role change
   * takes effect without waiting for the 7-day token to expire.
   */
  tokenVersion: number;
  invoiceCounters: Record<string, number>;
  migratedFromOwner?: boolean;
  settings: IUserSettings;
}

const userSettingsSchema = new Schema<IUserSettings>(
  {
    emailNotifications: { type: Boolean, default: true },
    smsNotifications: { type: Boolean, default: true },
    marketingEmails: { type: Boolean, default: false },
    moderationReminders: { type: Boolean, default: true },
    language: { type: String, default: "en" },
    theme: { type: String, default: "system" },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: false, trim: true, lowercase: true },
    userCode: { type: String, trim: true, uppercase: true, required: false },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["tenant", "caretaker", "custodian", "admin", "broker", "system-admin"],
      required: true,
    },
    privileges: {
      type: [String],
      enum: [
        "create_property",
        "edit_property",
        "delete_assigned_property",
        "manage_units",
        "manage_tenants",
        "process_move_requests",
        "manage_invoices",
        "manage_complaints",
        "manage_tasks",
        "manage_announcements",
        "send_messages",
        "manage_documents",
        "assign_privileges",
      ],
      default: [],
    },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    // Mobile number in E.164 form, e.g. "+254712345678" (country code included).
    phone: { type: String, trim: true, default: "" },
    // WhatsApp number in E.164 form. An empty string means "same as phone".
    whatsapp: { type: String, trim: true, default: "" },
    // Government-issued identity number. Stored encrypted at rest (see
    // src/lib/crypto.ts); callers normalise it before encrypting. PII.
    nationalId: { type: String, trim: true, default: "" },
    verificationToken: { type: String },
    verificationTokenExpiry: { type: Date },
    tokenVersion: { type: Number, default: 0 },
    invoiceCounters: { type: Schema.Types.Map, of: Number, default: {} },
    migratedFromOwner: { type: Boolean, default: false },
    settings: { type: userSettingsSchema, default: () => ({}) },
  },
  {
    timestamps: true,
  },
);

userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $gt: "" } } });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
// Partial (not sparse): the field must be genuinely absent on un-backfilled
// documents, never `""` — see .opencode/plans/user-code.md §9.1.
userSchema.index(
  { userCode: 1 },
  {
    unique: true,
    name: "user_code_unique",
    partialFilterExpression: { userCode: { $gt: "" } },
  },
);

const USER_CODE_IMMUTABLE_MESSAGE = "userCode is immutable once assigned";

/**
 * Backstop for any creation path that does not go through `withUserCodeRetry`.
 * An explicitly supplied candidate always wins, so the retry loop can re-roll.
 */
userSchema.pre("validate", function assignUserCode() {
  // Update validators run with `this` bound to a Query, not a document.
  if (this instanceof mongoose.Query) return;

  const doc = this as mongoose.HydratedDocument<IUser>;
  if (doc.isNew && doc.userCode == null) {
    doc.userCode = generateUserCode();
    return;
  }
  // Loud guard instead of `immutable: true`, which silently writes nothing.
  if (!doc.isNew && doc.isModified("userCode")) {
    throw new Error(USER_CODE_IMMUTABLE_MESSAGE);
  }
});

function isUserCodePath(key: string): boolean {
  return key === "userCode" || key.startsWith("userCode.");
}

function touchesUserCodePath(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value as Record<string, unknown>).some(isUserCodePath);
}

function assertUserCodeNotWritten(update: unknown): void {
  if (!update || typeof update !== "object") return;
  const record = update as Record<string, unknown>;
  const operators = Object.keys(record).filter((key) => key.startsWith("$"));

  // Replacement-style update: the whole document is the payload.
  if (operators.length === 0) {
    if (touchesUserCodePath(record)) throw new Error(USER_CODE_IMMUTABLE_MESSAGE);
    return;
  }

  for (const operator of operators) {
    const payload = record[operator];
    if (touchesUserCodePath(payload)) throw new Error(USER_CODE_IMMUTABLE_MESSAGE);
    if (operator === "$rename" && payload && typeof payload === "object") {
      const targets = Object.values(payload as Record<string, unknown>);
      if (targets.some((target) => typeof target === "string" && isUserCodePath(target))) {
        throw new Error(USER_CODE_IMMUTABLE_MESSAGE);
      }
    }
  }
}

// Document hooks do not run for update operations, so the immutability guard
// has to be repeated at the query layer.
userSchema.pre("updateOne", function guardUserCodeUpdateOne() {
  assertUserCodeNotWritten(this.getUpdate());
});
userSchema.pre("updateMany", function guardUserCodeUpdateMany() {
  assertUserCodeNotWritten(this.getUpdate());
});
userSchema.pre("findOneAndUpdate", function guardUserCodeFindOneAndUpdate() {
  assertUserCodeNotWritten(this.getUpdate());
});

export type UserDocument = InferSchemaType<IUser>;

export const User = mongoose.models.User || model<IUser>("User", userSchema);
