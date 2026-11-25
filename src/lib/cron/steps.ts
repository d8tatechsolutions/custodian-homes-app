import type { CronStep } from "@/lib/cron/daily";
import { isTasksV2Enabled } from "@/lib/feature-flags";
import { refreshUsdKesRate } from "@/lib/fx";
import { runDueSchedules } from "@/lib/maintenance/schedules";

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
  ];
}
