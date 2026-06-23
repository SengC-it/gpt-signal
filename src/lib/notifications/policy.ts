import type { SignalEvaluation } from "@/lib/signal/types";

const STRONG_ALERT_EXCLUDED_SYMBOLS = new Set(["LINKUSDT", "AVAXUSDT"]);

export function shouldSendStrongAlert(signal: SignalEvaluation) {
  return signal.level === "S" && !STRONG_ALERT_EXCLUDED_SYMBOLS.has(signal.symbol);
}

export function filterStrongAlertSignals(signals: SignalEvaluation[]) {
  return signals.filter(shouldSendStrongAlert);
}
