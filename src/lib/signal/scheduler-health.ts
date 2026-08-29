import { SCHEDULER_HEALTH_THRESHOLDS } from "./profitability-config.ts";

export type SchedulerHealthStatus = "Healthy" | "Delayed" | "Stale";

export function evaluateSchedulerHealth(input: {
  now: number;
  lastSuccessfulSync: number | null;
  lastCandleTimestamp: number | null;
  consecutiveSyncErrors?: number;
}) {
  const timestamps = [input.lastSuccessfulSync, input.lastCandleTimestamp].filter((value): value is number => value !== null);
  const lagMs = timestamps.length === 2 ? Math.max(...timestamps.map((value) => Math.max(0, input.now - value))) : Number.POSITIVE_INFINITY;
  const lagMinutes = lagMs / 60_000;
  const consecutiveSyncErrors = input.consecutiveSyncErrors ?? 0;
  const status: SchedulerHealthStatus = consecutiveSyncErrors >= SCHEDULER_HEALTH_THRESHOLDS.staleAfterConsecutiveErrors
    ? "Stale"
    : lagMinutes >= SCHEDULER_HEALTH_THRESHOLDS.staleAfterMinutes
    ? "Stale"
    : lagMinutes >= SCHEDULER_HEALTH_THRESHOLDS.delayedAfterMinutes
      ? "Delayed"
      : consecutiveSyncErrors > 0 ? "Delayed" : "Healthy";
  return {
    status,
    syncLagMinutes: lagMinutes,
    stale: status === "Stale",
    consecutiveSyncErrors
  };
}
