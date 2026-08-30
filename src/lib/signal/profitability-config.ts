import type { DeliveryMode } from "./types.ts";

// Empty by design while Main V2 and ALT Basket remain Shadow Only. Historical
// rows may still carry delivery_mode=production and must not be mistaken for
// an enabled strategy in current runtime dashboards.
export const PRODUCTION_SIGNAL_STRATEGIES = Object.freeze([] as string[]);

export type RuntimeStrategyState = "current_runtime_production" | "shadow_candidate" | "historical_delivery";

export function classifyRuntimeStrategy(input: {
  deliveryMode: DeliveryMode;
  strategyVersion: string | null;
  signalType: string;
}): RuntimeStrategyState {
  if (input.deliveryMode === "shadow") return "shadow_candidate";
  return input.strategyVersion && PRODUCTION_SIGNAL_STRATEGIES.includes(input.strategyVersion)
    ? "current_runtime_production"
    : "historical_delivery";
}

export const MAIN_STRATEGY_DELIVERY_MODE: DeliveryMode = "shadow";
export const ALT_BASKET_DELIVERY_MODE: DeliveryMode = "shadow";

export const EDGE_EVIDENCE_THRESHOLDS = Object.freeze({
  minimumSettledTrades: 30,
  passProfitFactor: 1.2,
  passExpectancyR: 0,
  failProfitFactor: 0.8,
  failExpectancyR: -0.1
});

export const COST_GATE_CANDIDATES = Object.freeze([
  { id: "no-filter", label: "No cost filter", minimumCoverageRatio: null },
  { id: "cost-1x", label: ">= 1.0x cost", minimumCoverageRatio: 1 },
  { id: "cost-1_5x", label: ">= 1.5x cost", minimumCoverageRatio: 1.5 },
  { id: "cost-2x", label: ">= 2.0x cost", minimumCoverageRatio: 2 }
]);

export const PROMOTION_GATE_THRESHOLDS = Object.freeze({
  minimumOosSettledTrades: 30,
  minimumProfitFactor: 1.2,
  minimumExpectancyR: 0,
  maximumDrawdownDeteriorationRatio: 1.25
});

export const CONCENTRATION_CONTROL = Object.freeze({
  evaluationWindowMinutes: 15,
  maximumSameDirectionAltSignals: 3,
  productionEnabled: false,
  mode: "shadow_comparison_only" as const
});

export const SCHEDULER_HEALTH_THRESHOLDS = Object.freeze({
  delayedAfterMinutes: 30,
  staleAfterMinutes: 60,
  staleAfterConsecutiveErrors: 3
});
