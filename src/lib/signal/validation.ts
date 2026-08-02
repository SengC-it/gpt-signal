import { isSettledReviewStatus, type ReviewFinalStatus } from "./review.ts";
import type { Direction } from "./types.ts";

export type ValidationTrade = {
  direction: Direction;
  signalTime: number;
  finalStatus: ReviewFinalStatus;
  entryHit: boolean;
  netR: number | null;
  grossR: number | null;
  netPnlPct: number | null;
};

export type ValidationSummary = {
  trades: number;
  settledTrades: number;
  openTrades: number;
  waitingEntryTrades: number;
  entryFillRate: number;
  executionRate: number;
  winRate: number;
  netPnlPct: number;
  netR: number;
  profitFactor: number;
  longSettledTrades: number;
  shortSettledTrades: number;
  longNetR: number;
  shortNetR: number;
  maxDrawdownR: number;
  maxLosingStreak: number;
};

export type ValidationGateResult = {
  passed: boolean;
  reasons: string[];
  checks: {
    dataQuality: boolean;
    coverageDays: boolean;
    oosNetPnlPositive: boolean;
    oosNetRPositive: boolean;
    oosProfitFactorAboveOne: boolean;
    holdoutNetPnlPositive: boolean;
    holdoutNetRPositive: boolean;
    holdoutProfitFactorAboveOne: boolean;
    minimumSettledTrades: boolean;
    bothDirectionsPresent: boolean;
  };
};

export function summarizeValidationTrades(trades: ValidationTrade[]): ValidationSummary {
  const settled = trades.filter((trade) => isSettledReviewStatus(trade.finalStatus));
  const wins = settled.filter((trade) => (trade.netR ?? 0) > 0);
  const losses = settled.filter((trade) => (trade.netR ?? 0) < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + (trade.netR ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + (trade.netR ?? 0), 0));
  const returns = settled.map((trade) => trade.netR ?? 0);
  const long = settled.filter((trade) => trade.direction === "LONG");
  const short = settled.filter((trade) => trade.direction === "SHORT");

  return {
    trades: trades.length,
    settledTrades: settled.length,
    openTrades: trades.filter((trade) => trade.finalStatus === "open").length,
    waitingEntryTrades: trades.filter((trade) => trade.finalStatus === "waiting_entry").length,
    entryFillRate: trades.length ? (trades.filter((trade) => trade.entryHit).length / trades.length) * 100 : 0,
    executionRate: trades.length ? (settled.length / trades.length) * 100 : 0,
    winRate: settled.length ? (wins.length / settled.length) * 100 : 0,
    netPnlPct: settled.reduce((sum, trade) => sum + (trade.netPnlPct ?? 0), 0),
    netR: returns.reduce((sum, value) => sum + value, 0),
    profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
    longSettledTrades: long.length,
    shortSettledTrades: short.length,
    longNetR: long.reduce((sum, trade) => sum + (trade.netR ?? 0), 0),
    shortNetR: short.reduce((sum, trade) => sum + (trade.netR ?? 0), 0),
    maxDrawdownR: maxDrawdown(returns),
    maxLosingStreak: maxLosingStreak(returns)
  };
}

export function mergeValidationTrades(...groups: ValidationTrade[][]) {
  return groups.flat().sort((a, b) => a.signalTime - b.signalTime);
}

export function evaluateValidationGate(input: {
  coverageDays: number;
  dataQualityPassed?: boolean;
  oos: ValidationSummary;
  holdout: ValidationSummary;
  minimumSettledTrades?: number;
}): ValidationGateResult {
  const minimumSettledTrades = input.minimumSettledTrades ?? 100;
  const checks = {
    dataQuality: input.dataQualityPassed ?? true,
    coverageDays: input.coverageDays >= 450,
    oosNetPnlPositive: input.oos.netPnlPct > 0,
    oosNetRPositive: input.oos.netR > 0,
    oosProfitFactorAboveOne: input.oos.profitFactor > 1,
    holdoutNetPnlPositive: input.holdout.netPnlPct > 0,
    holdoutNetRPositive: input.holdout.netR > 0,
    holdoutProfitFactorAboveOne: input.holdout.profitFactor > 1,
    minimumSettledTrades: input.oos.settledTrades >= minimumSettledTrades,
    bothDirectionsPresent: input.oos.longSettledTrades > 0 && input.oos.shortSettledTrades > 0
  };
  const reasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    passed: reasons.length === 0,
    reasons,
    checks
  };
}

function maxDrawdown(values: number[]) {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

function maxLosingStreak(values: number[]) {
  let current = 0;
  let max = 0;
  for (const value of values) {
    current = value < 0 ? current + 1 : 0;
    max = Math.max(max, current);
  }
  return max;
}
