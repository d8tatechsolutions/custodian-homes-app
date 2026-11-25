import type { CronStep } from "@/lib/cron/daily";
import { refreshUsdKesRate } from "@/lib/fx";

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
  ];
}
