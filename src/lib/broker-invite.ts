import { getAppUrl } from "@/lib/brand";
import { sendInviteEmail } from "@/lib/email";

export const BROKER_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export interface BrokerInviteDelivery {
  emailSent: boolean;
  /**
   * The set-password link is a credential for the broker's account, so it is
   * only handed back to the inviter when the email could not be delivered.
   */
  inviteUrl?: string;
  inviteExpiresAt: string;
}

/** Emails the broker their set-password link; falls back to returning it. */
export async function deliverBrokerInvite(input: {
  email: string;
  name: string;
  token: string;
  expiresAt: Date;
}): Promise<BrokerInviteDelivery> {
  let emailSent = false;
  try {
    emailSent = await sendInviteEmail(input.email, input.name, "broker", input.token);
  } catch (error) {
    console.error("[brokers] invite email failed", error instanceof Error ? error.message : error);
  }
  return {
    emailSent,
    inviteUrl: emailSent ? undefined : `${getAppUrl()}/auth/verify?token=${input.token}&invited=1`,
    inviteExpiresAt: input.expiresAt.toISOString(),
  };
}
