import { redirect } from "next/navigation";

/**
 * Sign-in sends users with an incomplete profile to `/dashboard/<role>/settings`.
 * Brokers keep their details on the Profile page, so forward them there
 * (this path previously did not exist for brokers).
 */
export default function BrokerSettingsRedirect() {
  redirect("/dashboard/broker/profile");
}
