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
  symbol?: string;
  marketRegime?: string;
  signalType?: string;
  strategyVersion?: string;
  signalScore?: number;
  dataQualityScore?: number;
  costCoverageRatio?: number;
};

export type ValidationSummary = {
  trades: number;
  settledTrades: number;
  openTrades: number;
  waitingEntryTrades: number;
  entryFillRate: number;
  executionRate: number;
  winRate: number;
  wins: number;
  losses: number;
  netPnlPct: number;
  netR: number;
  profitFactor: number;
  expectancyR: number;
  averageWinR: number;
  averageLossR: number;
  payoffRatio: number;
  breakevenWinRate: number;
  longSettledTrades: number;
  shortSettledTrades: number;
  longNetR: number;
  shortNetR: number;
  maxDrawdownR: number;
  maxLosingStreak: number;
  positiveMonths: number;
  symbolBreadth: number;
  regimeBreadth: number;
  largestSingleTradeContributionPct: number;
  largestSingleSymbolContributionPct: number;
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
    oosExpectancyPositive: boolean;
    holdoutNetPnlPositive: boolean;
    holdoutNetRPositive: boolean;
    holdoutProfitFactorAboveOne: boolean;
    holdoutExpectancyPositive: boolean;
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
    wins: wins.length,
    losses: losses.length,
    netPnlPct: settled.reduce((sum, trade) => sum + (trade.netPnlPct ?? 0), 0),
    netR: returns.reduce((sum, value) => sum + value, 0),
    profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
    expectancyR: average(returns),
    averageWinR: average(wins.map((trade) => trade.netR ?? 0)),
    averageLossR: average(losses.map((trade) => Math.abs(trade.netR ?? 0))),
    payoffRatio: payoffRatio(wins, losses),
    breakevenWinRate: breakevenWinRate(wins, losses),
    longSettledTrades: long.length,
    shortSettledTrades: short.length,
    longNetR: long.reduce((sum, trade) => sum + (trade.netR ?? 0), 0),
    shortNetR: short.reduce((sum, trade) => sum + (trade.netR ?? 0), 0),
    maxDrawdownR: maxDrawdown(returns),
    maxLosingStreak: maxLosingStreak(returns),
    positiveMonths: positiveMonths(settled),
    symbolBreadth: new Set(settled.map((trade) => trade.symbol).filter(Boolean)).size,
    regimeBreadth: new Set(settled.map((trade) => trade.marketRegime).filter(Boolean)).size,
    largestSingleTradeContributionPct: contributionPct(
      Math.max(0, ...settled.map((trade) => trade.netR ?? 0)),
      grossProfit
    ),
    largestSingleSymbolContributionPct: largestSymbolContributionPct(settled, grossProfit)
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
  const minimumSettledTrades = input.minimumSettledTrades ?? 30;
  const checks = {
    dataQuality: input.dataQualityPassed ?? true,
    coverageDays: input.coverageDays >= 450,
    oosNetPnlPositive: input.oos.netPnlPct > 0,
    oosNetRPositive: input.oos.netR > 0,
    oosProfitFactorAboveOne: input.oos.profitFactor >= 1.2,
    oosExpectancyPositive: input.oos.expectancyR > 0,
    holdoutNetPnlPositive: input.holdout.netPnlPct > 0,
    holdoutNetRPositive: input.holdout.netR > 0,
    holdoutProfitFactorAboveOne: input.holdout.profitFactor >= 1.2,
    holdoutExpectancyPositive: input.holdout.expectancyR > 0,
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

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function payoffRatio(wins: ValidationTrade[], losses: ValidationTrade[]) {
  const averageWin = average(wins.map((trade) => trade.netR ?? 0));
  const averageLoss = average(losses.map((trade) => Math.abs(trade.netR ?? 0)));
  return averageLoss > 0 ? averageWin / averageLoss : averageWin;
}

function breakevenWinRate(wins: ValidationTrade[], losses: ValidationTrade[]) {
  const payoff = payoffRatio(wins, losses);
  return payoff > 0 ? 100 / (1 + payoff) : 0;
}

function positiveMonths(trades: ValidationTrade[]) {
  const months = new Map<string, number>();
  for (const trade of trades) {
    const month = new Date(trade.signalTime).toISOString().slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + (trade.netR ?? 0));
  }
  return [...months.values()].filter((value) => value > 0).length;
}

function largestSymbolContributionPct(trades: ValidationTrade[], grossProfit: number) {
  const bySymbol = new Map<string, number>();
  for (const trade of trades) {
    if (!trade.symbol) continue;
    bySymbol.set(trade.symbol, (bySymbol.get(trade.symbol) ?? 0) + (trade.netR ?? 0));
  }
  return contributionPct(Math.max(0, ...bySymbol.values()), grossProfit);
}

function contributionPct(contribution: number, total: number) {
  return total > 0 ? contribution / total * 100 : 0;
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
