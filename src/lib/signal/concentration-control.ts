import type { EdgeEvidenceStatus } from "./edge-evidence.ts";
import { CONCENTRATION_CONTROL } from "./profitability-config.ts";
import type { SignalEvaluation } from "./types.ts";

export type ConcentrationCandidate = {
  signal: SignalEvaluation;
  evidenceStatus: EdgeEvidenceStatus;
};

export function compareSignalConcentration(
  candidates: ConcentrationCandidate[],
  config = CONCENTRATION_CONTROL
) {
  const eligible = candidates.filter(({ signal }) => signal.symbol !== "BTCUSDT");
  const selected: ConcentrationCandidate[] = [];
  const suppressed: ConcentrationCandidate[] = [];

  for (const direction of ["LONG", "SHORT"] as const) {
    const ranked = eligible
      .filter(({ signal }) => signal.direction === direction)
      .sort(compareCandidateQuality);
    selected.push(...ranked.slice(0, config.maximumSameDirectionAltSignals));
    suppressed.push(...ranked.slice(config.maximumSameDirectionAltSignals));
  }

  return {
    mode: config.mode,
    productionChanged: config.productionEnabled && suppressed.length > 0,
    selected,
    suppressed
  };
}

function compareCandidateQuality(left: ConcentrationCandidate, right: ConcentrationCandidate) {
  return evidenceRank(right.evidenceStatus) - evidenceRank(left.evidenceStatus)
    || right.signal.score - left.signal.score
    || costAdjustedEdge(right.signal) - costAdjustedEdge(left.signal)
    || liquidityQuality(right.signal) - liquidityQuality(left.signal)
    || right.signal.symbol.localeCompare(left.signal.symbol);
}

function evidenceRank(status: EdgeEvidenceStatus) {
  return { PASS: 4, WATCH: 3, UNPROVEN: 2, FAIL: 1 }[status];
}

function costAdjustedEdge(signal: SignalEvaluation) {
  const value = signal.noChaseRule.costCoverageRatio;
  if (typeof value === "number") return value;
  return signal.plan?.costAdjustedRr ?? Number.NEGATIVE_INFINITY;
}

function liquidityQuality(signal: SignalEvaluation) {
  const value = signal.noChaseRule.liquidityScore;
  return typeof value === "number" ? value : signal.dataQualityScore;
}
