import type { Candle, Direction, TradingPlan } from "./types.ts";

export const REVIEW_FEE_RATE = 0.001;
export const REVIEW_SLIPPAGE_RATE = 0.0005;
export const REVIEW_ROUND_TRIP_COST_PCT = (REVIEW_FEE_RATE + REVIEW_SLIPPAGE_RATE) * 2;

export type ReviewExitMode = "full_tp1" | "legacy_furthest_tp";

export type ReviewExecutionPolicy = {
  exitMode: ReviewExitMode;
  expiry: "none";
  sameCandlePriority: "stop";
};

export const DEFAULT_REVIEW_EXECUTION_POLICY: ReviewExecutionPolicy = {
  exitMode: "full_tp1",
  expiry: "none",
  sameCandlePriority: "stop"
};

export const LEGACY_REVIEW_EXECUTION_POLICY: ReviewExecutionPolicy = {
  exitMode: "legacy_furthest_tp",
  expiry: "none",
  sameCandlePriority: "stop"
};

export type ReviewFinalStatus =
  | "waiting_entry"
  | "open"
  | "hit_tp1"
  | "hit_tp2"
  | "hit_tp3"
  | "hit_sl";

export type SignalReviewState = {
  entryHit: boolean;
  entryTime: number | null;
  entryPrice: number | null;
  finalStatus: ReviewFinalStatus;
  exitTime: number | null;
  exitPrice: number | null;
  grossR: number | null;
  netR: number | null;
  grossPnlPct: number | null;
  netPnlPct: number | null;
  mfe: number;
  mae: number;
  lastCheckedAt: number | null;
};

export type ReviewCandle = Pick<Candle, "openTime" | "closeTime" | "high" | "low" | "isClosed">;

export type ReviewSimulationInput = {
  direction: Direction;
  plan: TradingPlan;
  candles: ReviewCandle[];
  state?: SignalReviewState;
  feeRate?: number;
  slippageRate?: number;
  executionPolicy?: Partial<ReviewExecutionPolicy>;
  candlesAreSorted?: boolean;
};

export const SETTLED_REVIEW_STATUSES: ReviewFinalStatus[] = ["hit_tp1", "hit_tp2", "hit_tp3", "hit_sl"];

export function createInitialReviewState(): SignalReviewState {
  return {
    entryHit: false,
    entryTime: null,
    entryPrice: null,
    finalStatus: "waiting_entry",
    exitTime: null,
    exitPrice: null,
    grossR: null,
    netR: null,
    grossPnlPct: null,
    netPnlPct: null,
    mfe: 0,
    mae: 0,
    lastCheckedAt: null
  };
}

export function applyReviewCandles(input: ReviewSimulationInput): SignalReviewState {
  const state: SignalReviewState = {
    ...createInitialReviewState(),
    ...(input.state ?? {})
  };

  if (isSettledReviewStatus(state.finalStatus)) return state;

  const feeRate = input.feeRate ?? REVIEW_FEE_RATE;
  const slippageRate = input.slippageRate ?? REVIEW_SLIPPAGE_RATE;
  const executionPolicy: ReviewExecutionPolicy = {
    ...DEFAULT_REVIEW_EXECUTION_POLICY,
    ...(input.executionPolicy ?? {})
  };
  const entryPrice = input.direction === "LONG" ? input.plan.entryHigh : input.plan.entryLow;
  const risk = Math.abs(entryPrice - input.plan.stopLoss);

  const candles = input.candlesAreSorted ? input.candles : [...input.candles].sort((a, b) => a.closeTime - b.closeTime);
  for (const candle of candles) {
    if (!candle.isClosed || (state.lastCheckedAt !== null && candle.closeTime <= state.lastCheckedAt)) continue;

    state.lastCheckedAt = candle.closeTime;

    if (!state.entryHit) {
      const touchedEntry = input.direction === "LONG"
        ? candle.low <= input.plan.entryHigh && candle.high >= input.plan.entryLow
        : candle.high >= input.plan.entryLow && candle.low <= input.plan.entryHigh;

      if (!touchedEntry) continue;

      state.entryHit = true;
      state.entryTime = candle.closeTime;
      state.entryPrice = entryPrice;
    }

    if (risk <= 0 || !state.entryPrice) continue;

    const favorable = input.direction === "LONG" ? candle.high - state.entryPrice : state.entryPrice - candle.low;
    const adverse = input.direction === "LONG" ? state.entryPrice - candle.low : candle.high - state.entryPrice;
    state.mfe = Math.max(state.mfe, favorable / risk);
    state.mae = Math.max(state.mae, adverse / risk);

    const hitSl = input.direction === "LONG" ? candle.low <= input.plan.stopLoss : candle.high >= input.plan.stopLoss;
    const hitTp1 = input.direction === "LONG" ? candle.high >= input.plan.tp1 : candle.low <= input.plan.tp1;
    const hitTp2 = input.direction === "LONG" ? candle.high >= input.plan.tp2 : candle.low <= input.plan.tp2;
    const hitTp3 = input.direction === "LONG" ? candle.high >= input.plan.tp3 : candle.low <= input.plan.tp3;

    // OHLC candles do not reveal intrabar ordering. A same-candle TP/SL touch is
    // resolved conservatively as a stop. New signals use full TP1; the legacy
    // mode exists only to preserve already-recorded historical outcomes.
    if (hitSl) {
      return settleReview(state, "hit_sl", input.plan.stopLoss, candle.closeTime, input.direction, risk, feeRate, slippageRate);
    }
    if (executionPolicy.exitMode === "legacy_furthest_tp") {
      if (hitTp3) {
        return settleReview(state, "hit_tp3", input.plan.tp3, candle.closeTime, input.direction, risk, feeRate, slippageRate);
      }
      if (hitTp2) {
        return settleReview(state, "hit_tp2", input.plan.tp2, candle.closeTime, input.direction, risk, feeRate, slippageRate);
      }
    }
    if (hitTp1) {
      return settleReview(state, "hit_tp1", input.plan.tp1, candle.closeTime, input.direction, risk, feeRate, slippageRate);
    }
  }

  state.finalStatus = state.entryHit ? "open" : "waiting_entry";
  return state;
}

export function isSettledReviewStatus(status: ReviewFinalStatus | string | null | undefined): status is ReviewFinalStatus {
  return SETTLED_REVIEW_STATUSES.includes(status as ReviewFinalStatus);
}

function settleReview(
  state: SignalReviewState,
  status: ReviewFinalStatus,
  exitPrice: number,
  exitTime: number,
  direction: Direction,
  risk: number,
  feeRate: number,
  slippageRate: number
) {
  const entryPrice = state.entryPrice!;
  const grossReturn = direction === "LONG"
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  const grossR = direction === "LONG"
    ? (exitPrice - entryPrice) / risk
    : (entryPrice - exitPrice) / risk;
  const roundTripCostPct = (feeRate + slippageRate) * 2;
  const costR = entryPrice > 0 ? roundTripCostPct / (risk / entryPrice) : 0;

  return {
    ...state,
    finalStatus: status,
    exitTime,
    exitPrice,
    grossR: round(grossR),
    netR: round(grossR - costR),
    grossPnlPct: round(grossReturn * 100),
    netPnlPct: round((grossReturn - roundTripCostPct) * 100)
  };
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
