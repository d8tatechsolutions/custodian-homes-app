import { expireBids } from "@/lib/broker-bids";
import type { CronStep } from "@/lib/cron/daily";
import { isBrokerBidsEnabled, isTasksV2Enabled } from "@/lib/feature-flags";
import { refreshUsdKesRate } from "@/lib/fx";
import { runTaskReminders } from "@/lib/maintenance/notify";
import { runDueSchedules } from "@/lib/maintenance/schedules";
import { BrokerListing } from "@/models/BrokerListing";

/** Ordered list of daily steps. Later phases append their steps here. */
export function dailySteps(): CronStep[] {
  return [
    {
      name: "fx-refresh",
      run: async (now) => {
        const quote = await refreshUsdKesRate(now);
        if (!quote) throw new Error("Exchange-rate provider unavailable; last known rate kept");
        return { rate: quote.rate, effectiveDate: quote.effectiveDate };
      },
    },
    {
      name: "recurring-tasks",
      run: async (now) => {
        if (!isTasksV2Enabled()) return { skipped: "TASKS_V2_ENABLED is off" };
        return runDueSchedules(now);
      },
    },
    {
      // After recurring-tasks, so copies created today are included.
      name: "task-reminders",
      run: async (now) => {
        if (!isTasksV2Enabled()) return { skipped: "TASKS_V2_ENABLED is off" };
        return runTaskReminders(now);
      },
    },
    {
      name: "broker-bid-expiry",
      run: async (now) => {
        if (!isBrokerBidsEnabled()) return { skipped: "BROKER_BIDS_ENABLED is off" };
        return expireBids(now);
      },
    },
    {
      name: "broker-listing-expiry",
      run: async (now) => {
        if (!isBrokerBidsEnabled()) return { skipped: "BROKER_BIDS_ENABLED is off" };
        const res = await BrokerListing.updateMany(
          { status: "approved", expiresAt: { $lte: now } },
          { $set: { status: "expired" } },
        );
        return { expired: res.modifiedCount ?? 0 };
      },
    },
  ];
}
