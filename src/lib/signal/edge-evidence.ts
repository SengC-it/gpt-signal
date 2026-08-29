import { EDGE_EVIDENCE_THRESHOLDS } from "./profitability-config.ts";
import type { Direction, SignalType } from "./types.ts";

export type EdgeEvidenceStatus = "UNPROVEN" | "PASS" | "WATCH" | "FAIL";

export type EdgeEvidenceDimensions = {
  strategyVersion: string;
  signalType: SignalType | string;
  symbol: string;
  direction: Direction;
  marketRegime: string;
};

export type EdgeEvidenceTrade = EdgeEvidenceDimensions & {
  settled: boolean;
  netR: number | null;
};

export type EdgeEvidence = EdgeEvidenceDimensions & {
  settledTrades: number;
  wins: number;
  losses: number;
  netR: number;
  profitFactor: number;
  expectancyR: number;
  status: EdgeEvidenceStatus;
};

export function evaluateEdgeEvidence(
  input: Pick<EdgeEvidence, "settledTrades" | "profitFactor" | "expectancyR">
): EdgeEvidenceStatus {
  const thresholds = EDGE_EVIDENCE_THRESHOLDS;
  if (input.settledTrades < thresholds.minimumSettledTrades) return "UNPROVEN";
  if (
    input.profitFactor >= thresholds.passProfitFactor
    && input.expectancyR > thresholds.passExpectancyR
  ) return "PASS";
  if (
    input.profitFactor < thresholds.failProfitFactor
    || input.expectancyR <= thresholds.failExpectancyR
  ) return "FAIL";
  return "WATCH";
}

export function buildEdgeEvidence(trades: EdgeEvidenceTrade[]): EdgeEvidence[] {
  const groups = new Map<string, EdgeEvidenceTrade[]>();
  for (const trade of trades) {
    const key = edgeEvidenceKey(trade);
    const group = groups.get(key) ?? [];
    group.push(trade);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const dimensions = group[0];
    const settled = group.filter((trade) => trade.settled && trade.netR !== null);
    const wins = settled.filter((trade) => (trade.netR ?? 0) > 0);
    const losses = settled.filter((trade) => (trade.netR ?? 0) < 0);
    const grossProfit = sum(wins.map((trade) => trade.netR ?? 0));
    const grossLoss = Math.abs(sum(losses.map((trade) => trade.netR ?? 0)));
    const netR = sum(settled.map((trade) => trade.netR ?? 0));
    const evidence = {
      strategyVersion: dimensions.strategyVersion,
      signalType: dimensions.signalType,
      symbol: dimensions.symbol,
      direction: dimensions.direction,
      marketRegime: dimensions.marketRegime,
      settledTrades: settled.length,
      wins: wins.length,
      losses: losses.length,
      netR,
      profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / grossLoss,
      expectancyR: settled.length ? netR / settled.length : 0
    };
    return { ...evidence, status: evaluateEdgeEvidence(evidence) };
  });
}

export function edgeEvidenceKey(dimensions: EdgeEvidenceDimensions) {
  return [
    dimensions.strategyVersion,
    dimensions.signalType,
    dimensions.symbol,
    dimensions.direction,
    dimensions.marketRegime
  ].join("\u001f");
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
