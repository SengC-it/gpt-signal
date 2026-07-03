import type { SignalEvaluation } from "@/lib/signal/types";

const STRONG_ALERT_EXCLUDED_SYMBOLS = new Set(["LINKUSDT", "AVAXUSDT"]);
const DEFAULT_STRONG_ALERT_INTERVAL_MINUTES = 30;

export function shouldSendStrongAlert(signal: SignalEvaluation) {
  return signal.level === "S" && !STRONG_ALERT_EXCLUDED_SYMBOLS.has(signal.symbol);
}

export function filterStrongAlertSignals(signals: SignalEvaluation[]) {
  return signals.filter(shouldSendStrongAlert);
}

export function resolveStrongAlertIntervalMinutes(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 15) return DEFAULT_STRONG_ALERT_INTERVAL_MINUTES;
  return Math.round(parsed / 15) * 15;
}

export function shouldRunStrongAlertWindow(closeTime: number, intervalMinutes = DEFAULT_STRONG_ALERT_INTERVAL_MINUTES) {
  const interval = Math.max(15, Math.round(intervalMinutes / 15) * 15);
  const closedBoundary = new Date(closeTime + 1);
  const minutesSinceUtcMidnight = closedBoundary.getUTCHours() * 60 + closedBoundary.getUTCMinutes();
  return minutesSinceUtcMidnight % interval === 0;
}
