import type { SignalEvaluation } from "./types.ts";
import type { ReviewFinalStatus } from "./review.ts";

export type RuntimeDedupeState = Pick<SignalEvaluation, "level" | "lifecycleStatus">;

export function mainOpportunityId(
  signal: Pick<SignalEvaluation, "symbol" | "direction" | "signalType" | "marketRegime" | "strategyVersion">,
  fallbackStrategyVersion: string,
  interval = "15m"
) {
  return [
    signal.symbol,
    signal.direction,
    signal.signalType,
    signal.marketRegime,
    signal.strategyVersion ?? fallbackStrategyVersion,
    interval
  ].join(":");
}

export function shouldCreateRuntimeSignal(
  existing: RuntimeDedupeState | null | undefined,
  candidate: RuntimeDedupeState
) {
  return !existing
    || existing.level !== candidate.level
    || existing.lifecycleStatus !== candidate.lifecycleStatus;
}

export function reviewStatusToLifecycle(status: ReviewFinalStatus) {
  return status === "open" ? "entered" : status;
}
