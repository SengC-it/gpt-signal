import { REVIEW_FEE_RATE, REVIEW_SLIPPAGE_RATE } from "./review.ts";
import type { Direction, TradingPlan } from "./types.ts";

export type CostEdgeMetrics = {
  grossTp1ReturnPct: number;
  estimatedRoundTripCostPct: number;
  estimatedNetTp1ReturnPct: number;
  costCoverageRatio: number;
};

export function calculateCostEdge(
  direction: Direction,
  plan: TradingPlan,
  feeRate = REVIEW_FEE_RATE,
  slippageRate = REVIEW_SLIPPAGE_RATE
): CostEdgeMetrics {
  const entryPrice = direction === "LONG" ? plan.entryHigh : plan.entryLow;
  const grossReturn = entryPrice > 0
    ? direction === "LONG"
      ? (plan.tp1 - entryPrice) / entryPrice
      : (entryPrice - plan.tp1) / entryPrice
    : 0;
  const roundTripCost = (feeRate + slippageRate) * 2;

  return {
    grossTp1ReturnPct: round(grossReturn * 100),
    estimatedRoundTripCostPct: round(roundTripCost * 100),
    estimatedNetTp1ReturnPct: round((grossReturn - roundTripCost) * 100),
    costCoverageRatio: round(roundTripCost > 0 ? grossReturn / roundTripCost : Number.POSITIVE_INFINITY)
  };
}

export function passesCostGate(metrics: CostEdgeMetrics, minimumCoverageRatio: number | null) {
  return minimumCoverageRatio === null || metrics.costCoverageRatio >= minimumCoverageRatio;
}

function round(value: number) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1_000_000) / 1_000_000;
}
