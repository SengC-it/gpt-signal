import type { Candle, Direction, TradingPlan } from "@/lib/signal/types";

export type BacktestInput = {
  direction: Direction;
  plan: TradingPlan;
  futureCandles: Candle[];
  feeRate?: number;
  slippageRate?: number;
};

export type SignalOutcome = {
  entryHit: boolean;
  finalStatus: "hit_tp1" | "hit_tp2" | "hit_tp3" | "hit_sl" | "expired";
  finalR: number;
  mfe: number;
  mae: number;
};

export function simulateSignalOutcome(input: BacktestInput): SignalOutcome {
  const feeRate = input.feeRate ?? 0.001;
  const slippageRate = input.slippageRate ?? 0.0005;
  const risk = Math.abs(input.plan.entryHigh - input.plan.stopLoss);
  let entryHit = false;
  let mfe = 0;
  let mae = 0;

  for (const candle of input.futureCandles) {
    if (!entryHit) {
      entryHit =
        input.direction === "LONG"
          ? candle.low <= input.plan.entryHigh && candle.high >= input.plan.entryLow
          : candle.high >= input.plan.entryLow && candle.low <= input.plan.entryHigh;
    }

    if (!entryHit) continue;

    const favorable = input.direction === "LONG" ? candle.high - input.plan.entryHigh : input.plan.entryLow - candle.low;
    const adverse = input.direction === "LONG" ? input.plan.entryHigh - candle.low : candle.high - input.plan.entryLow;
    mfe = Math.max(mfe, favorable / risk);
    mae = Math.max(mae, adverse / risk);

    const hitSl = input.direction === "LONG" ? candle.low <= input.plan.stopLoss : candle.high >= input.plan.stopLoss;
    const hitTp1 = input.direction === "LONG" ? candle.high >= input.plan.tp1 : candle.low <= input.plan.tp1;
    const hitTp2 = input.direction === "LONG" ? candle.high >= input.plan.tp2 : candle.low <= input.plan.tp2;
    const hitTp3 = input.direction === "LONG" ? candle.high >= input.plan.tp3 : candle.low <= input.plan.tp3;

    if (hitSl) return withCosts({ entryHit, finalStatus: "hit_sl", finalR: -1, mfe, mae }, feeRate, slippageRate);
    if (hitTp3) return withCosts({ entryHit, finalStatus: "hit_tp3", finalR: 3, mfe, mae }, feeRate, slippageRate);
    if (hitTp2) return withCosts({ entryHit, finalStatus: "hit_tp2", finalR: 2, mfe, mae }, feeRate, slippageRate);
    if (hitTp1) return withCosts({ entryHit, finalStatus: "hit_tp1", finalR: 1, mfe, mae }, feeRate, slippageRate);
  }

  return withCosts({ entryHit, finalStatus: "expired", finalR: 0, mfe, mae }, feeRate, slippageRate);
}

export function runBacktest(items: BacktestInput[]) {
  const outcomes = items.map((item) => simulateSignalOutcome(item));
  const wins = outcomes.filter((item) => item.finalR > 0);
  const losses = outcomes.filter((item) => item.finalR < 0);
  const grossProfit = wins.reduce((sum, item) => sum + item.finalR, 0);
  const grossLoss = Math.abs(losses.reduce((sum, item) => sum + item.finalR, 0));

  return {
    totalTrades: outcomes.length,
    winRate: outcomes.length ? (wins.length / outcomes.length) * 100 : 0,
    avgR: average(outcomes.map((item) => item.finalR)),
    profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
    maxDrawdown: calculateMaxDrawdown(outcomes.map((item) => item.finalR)),
    maxLosingStreak: calculateMaxLosingStreak(outcomes.map((item) => item.finalR)),
    entryFillRate: outcomes.length ? (outcomes.filter((item) => item.entryHit).length / outcomes.length) * 100 : 0,
    noChaseRate: 0,
    executionRate: outcomes.length ? 100 : 0
  };
}

function withCosts(outcome: SignalOutcome, feeRate: number, slippageRate: number): SignalOutcome {
  const costInR = (feeRate + slippageRate) * 2;
  return {
    ...outcome,
    finalR: Math.round((outcome.finalR - Math.sign(outcome.finalR) * costInR) * 10_000) / 10_000
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

