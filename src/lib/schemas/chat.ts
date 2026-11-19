import { z } from "zod";
import { hex24 } from "./lease";

export const chatThreadInput = z.object({
  recipientId: z.string().regex(hex24),
  role: z.enum(["owner", "caretaker", "custodian"]),
  // Optional: omit to contact any active staff member resolved by exact
  // email/phone; when supplied, the recipient must be staff of that property.
  propertyId: z.string().regex(hex24).optional(),
});

export const chatRequestInput = z.object({
  recipientId: z.string().regex(hex24),
  propertyId: z.string().regex(hex24).optional(),
});

export const chatMessageInput = z.object({
  text: z.string().trim().min(1, "Message is required").max(2000),
});

export type ChatThreadInput = z.infer<typeof chatThreadInput>;
export type ChatMessageInput = z.infer<typeof chatMessageInput>;
