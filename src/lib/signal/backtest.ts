import type { Candle, Direction, TradingPlan } from "./types.ts";
import {
  applyReviewCandles,
  isSettledReviewStatus,
  type ReviewExecutionPolicy,
  type ReviewFinalStatus
} from "./review.ts";

export type BacktestInput = {
  direction: Direction;
  plan: TradingPlan;
  futureCandles: Candle[];
  feeRate?: number;
  slippageRate?: number;
  executionPolicy?: Partial<ReviewExecutionPolicy>;
};

export type SignalOutcome = {
  entryHit: boolean;
  finalStatus: ReviewFinalStatus;
  finalR: number;
  grossR: number | null;
  netR: number | null;
  grossPnlPct: number | null;
  netPnlPct: number | null;
  mfe: number;
  mae: number;
};

export function simulateSignalOutcome(input: BacktestInput): SignalOutcome {
  const state = applyReviewCandles({
    direction: input.direction,
    plan: input.plan,
    candles: input.futureCandles,
    feeRate: input.feeRate,
    slippageRate: input.slippageRate,
    executionPolicy: input.executionPolicy
  });

  return {
    entryHit: state.entryHit,
    finalStatus: state.finalStatus,
    finalR: state.netR ?? 0,
    grossR: state.grossR,
    netR: state.netR,
    grossPnlPct: state.grossPnlPct,
    netPnlPct: state.netPnlPct,
    mfe: state.mfe,
    mae: state.mae
  };
}

export function runBacktest(items: BacktestInput[]) {
  const outcomes = items.map((item) => simulateSignalOutcome(item));
  const settled = outcomes.filter((item) => isSettledReviewStatus(item.finalStatus));
  const wins = settled.filter((item) => item.finalR > 0);
  const losses = settled.filter((item) => item.finalR < 0);
  const grossProfit = wins.reduce((sum, item) => sum + item.finalR, 0);
  const grossLoss = Math.abs(losses.reduce((sum, item) => sum + item.finalR, 0));
  const netPnlPct = settled.reduce((sum, item) => sum + (item.netPnlPct ?? 0), 0);

  return {
    totalTrades: outcomes.length,
    settledTrades: settled.length,
    openTrades: outcomes.filter((item) => item.finalStatus === "open").length,
    waitingEntryTrades: outcomes.filter((item) => item.finalStatus === "waiting_entry").length,
    winRate: settled.length ? (wins.length / settled.length) * 100 : 0,
    totalNetR: settled.reduce((sum, item) => sum + item.finalR, 0),
    totalNetPnlPct: netPnlPct,
    avgR: average(settled.map((item) => item.finalR)),
    profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
    maxDrawdown: calculateMaxDrawdown(settled.map((item) => item.finalR)),
    maxLosingStreak: calculateMaxLosingStreak(settled.map((item) => item.finalR)),
    entryFillRate: outcomes.length ? (outcomes.filter((item) => item.entryHit).length / outcomes.length) * 100 : 0,
    noChaseRate: 0,
    executionRate: outcomes.length ? (settled.length / outcomes.length) * 100 : 0
  };
}

function calculateMaxDrawdown(results: number[]) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const result of results) {
    equity += result;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return maxDrawdown;
}

function calculateMaxLosingStreak(results: number[]) {
  let current = 0;
  let max = 0;
  for (const result of results) {
    if (result < 0) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

