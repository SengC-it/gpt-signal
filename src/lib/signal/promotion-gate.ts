import { PROMOTION_GATE_THRESHOLDS } from "./profitability-config.ts";

export type PromotionGateStatus = "PASS" | "FAIL" | "INSUFFICIENT_SAMPLE";

export type PromotionMetrics = {
  settledTrades: number;
  netPnlPct: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
};

export function evaluatePromotionGate(input: {
  candidate: PromotionMetrics;
  baselineMaxDrawdownR?: number | null;
  noLookAheadBias: boolean;
  noDataLeakage: boolean;
}) {
  const thresholds = PROMOTION_GATE_THRESHOLDS;
  if (input.candidate.settledTrades < thresholds.minimumOosSettledTrades) {
    return {
      status: "INSUFFICIENT_SAMPLE" as const,
      passed: false,
      reasons: ["minimumOosSettledTrades"]
    };
  }

  const baselineDd = input.baselineMaxDrawdownR;
  const checks = {
    netPnlPositive: input.candidate.netPnlPct > 0,
    expectancyPositive: input.candidate.expectancyR > thresholds.minimumExpectancyR,
    profitFactor: input.candidate.profitFactor >= thresholds.minimumProfitFactor,
    drawdownNotSignificantlyWorse: baselineDd === null || baselineDd === undefined
      || input.candidate.maxDrawdownR <= baselineDd * thresholds.maximumDrawdownDeteriorationRatio,
    noLookAheadBias: input.noLookAheadBias,
    noDataLeakage: input.noDataLeakage
  };
  const reasons = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return {
    status: (reasons.length === 0 ? "PASS" : "FAIL") as PromotionGateStatus,
    passed: reasons.length === 0,
    reasons
  };
}
