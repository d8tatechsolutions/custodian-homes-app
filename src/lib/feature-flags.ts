/**
 * Release flags for the tasks / broker-bids / USD-KES work.
 *
 * Every flag defaults to OFF, so this code can merge into `dev` (which is
 * currently promoted to production) without changing what users see. They are
 * switched on per Vercel environment (Preview first).
 *
 * Kept separate from `features.ts` so the two developers' changes never touch
 * the same file.
 */

function flag(name: string): boolean {
  return (process.env[name] ?? "false").trim().toLowerCase() === "true";
}

/** Tasks & Maintenance v2: complaints link, locations, photos, vendors, costs, recurring. */
export function isTasksV2Enabled(): boolean {
  return flag("TASKS_V2_ENABLED");
}

/** Broker bids, counter-offers, admin-added brokers and marketplace duplicate checks. */
export function isBrokerBidsEnabled(): boolean {
  return flag("BROKER_BIDS_ENABLED");
}

/** USD equivalents next to KES amounts across the app. */
export function isFxDisplayEnabled(): boolean {
  return flag("FX_DISPLAY_ENABLED");
}

export interface ReleaseFlags {
  tasksV2: boolean;
  brokerBids: boolean;
  fxDisplay: boolean;
}

export function getReleaseFlags(): ReleaseFlags {
  return {
    tasksV2: isTasksV2Enabled(),
    brokerBids: isBrokerBidsEnabled(),
    fxDisplay: isFxDisplayEnabled(),
  };
}
