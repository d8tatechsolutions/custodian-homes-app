/**
 * The once-a-day job (Vercel Cron, 03:00 UTC = 06:00 Nairobi).
 *
 * Each step is independent and idempotent: a failing step is reported and the
 * rest still run, and re-running the job the same day changes nothing extra.
 * Steps register here so the route stays a thin, authenticated trigger.
 */

export interface CronStepResult {
  step: string;
  ok: boolean;
  /** Short machine-readable summary, e.g. `{ created: 3 }`. */
  detail?: Record<string, unknown>;
  error?: string;
  ms: number;
}

export interface CronStep {
  name: string;
  run: (now: Date) => Promise<Record<string, unknown> | undefined>;
}

export async function runCronSteps(steps: CronStep[], now = new Date()): Promise<CronStepResult[]> {
  const results: CronStepResult[] = [];
  for (const step of steps) {
    const started = Date.now();
    try {
      const detail = await step.run(now);
      results.push({ step: step.name, ok: true, detail, ms: Date.now() - started });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[cron] step "${step.name}" failed:`, message);
      results.push({ step: step.name, ok: false, error: message, ms: Date.now() - started });
    }
  }
  return results;
}
