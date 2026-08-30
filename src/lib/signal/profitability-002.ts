import type { Candle, Direction, MainStrategyConfig, TradingPlan } from "./types.ts";

export const PROFITABILITY_002_DISCOVERY_CUTOFF = "2026-08-02T03:15:00.000Z";
export const PROFITABILITY_002_FEE_RATE = 0.001;
export const PROFITABILITY_002_SLIPPAGE_RATE = 0.0005;
const DISCOVERY_CUTOFF_MS = Date.parse(PROFITABILITY_002_DISCOVERY_CUTOFF);

export type ProfitabilityExitMode = "hard_sl_tp" | "early_invalidation" | "time_stop";
export type ResearchFinalStatus =
  | "waiting_entry"
  | "open"
  | "hit_tp1"
  | "hit_sl"
  | "invalidated_exit"
  | "time_stop_exit";

export type ProfitabilityCandidate = {
  id: string;
  family: "A_balanced_payoff_trend_pullback" | "B_structure_breakout" | "C_relative_strength_trend" | "D_early_invalidation" | "E_time_stop";
  rationale: string;
  config: MainStrategyConfig;
  directionMode: "momentum" | "relative";
  exitMode: ProfitabilityExitMode;
  timeStopCandles: number | null;
  minimumCostCoverageRatio: number;
  sidewaysPolicy: "no_trade" | "allow";
};

export type ResearchTrade = {
  candidateId: string;
  symbol: string;
  direction: Direction;
  signalTime: number;
  entryTime: number | null;
  exitTime: number | null;
  finalStatus: ResearchFinalStatus;
  entryHit: boolean;
  netR: number | null;
  grossR: number | null;
  netPnlPct: number | null;
  grossPnlPct: number | null;
  mfe: number;
  mae: number;
  durationCandles: number;
  score: number;
  relativeStrengthScore: number;
  btcRegime: "bull" | "bear" | "sideways" | "unknown";
  marketRegime: string;
  trendAlignment: "aligned" | "mixed";
  volatilityBand: string;
  costCoverageBand: string;
  slAtrRatioBand: string;
  entryStructure: string;
  opportunityKey: string;
  repeatedOpportunity: "first" | "second" | "third_plus";
};

export type ResearchSummary = {
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
  maxDrawdownR: number;
  positiveMonths: number;
  symbolBreadth: number;
  regimeBreadth: number;
  largestSingleTradeContributionPct: number;
  largestSingleSymbolContributionPct: number;
};

export type ResearchOutcome = {
  entryHit: boolean;
  entryTime: number | null;
  exitTime: number | null;
  finalStatus: ResearchFinalStatus;
  grossR: number | null;
  netR: number | null;
  grossPnlPct: number | null;
  netPnlPct: number | null;
  mfe: number;
  mae: number;
  durationCandles: number;
};

export type InternalGateResult = {
  passed: boolean;
  reasons: string[];
  checks: {
    minimumSettledTrades: boolean;
    netRPositive: boolean;
    profitFactor: boolean;
    expectancy: boolean;
    payoff: boolean;
    breakevenWinRate: boolean;
    positiveFolds: boolean;
    noLeakage: boolean;
  };
};

const HARD_SETTLED_STATUSES: ResearchFinalStatus[] = ["hit_tp1", "hit_sl"];
const RESEARCH_SETTLED_STATUSES: ResearchFinalStatus[] = [
  ...HARD_SETTLED_STATUSES,
  "invalidated_exit",
  "time_stop_exit"
];

/**
 * The candidate set is intentionally explicit and small. Each entry is an
 * economic hypothesis, not a parameter grid. Keep this list frozen before any
 * unseen-candle result is read.
 */
export function buildProfitability002Candidates(): ProfitabilityCandidate[] {
  const base = (overrides: Partial<MainStrategyConfig>): MainStrategyConfig => ({
    version: "profitability-002",
    targetR: 1.25,
    minScore: 82,
    minRewardRisk: 1.25,
    regimeMode: "aligned",
    requireWeakness: false,
    trendMode: "aligned",
    structureLookback: 20,
    stopBufferAtr: 0.3,
    relativeStrengthThreshold: 0,
    longRelativeStrengthThreshold: 0,
    shortRelativeStrengthThreshold: 0,
    relativeStrengthMode: "trend",
    setupMode: "pullback",
    ...overrides
  });
  const candidate = (input: Omit<ProfitabilityCandidate, "config"> & { config: MainStrategyConfig }) => input;

  return [
    ...([1, 1.25, 1.5] as const).map((targetR) => candidate({
      id: `p002-a-t${String(targetR).replace(".", "_")}`,
      family: "A_balanced_payoff_trend_pullback",
      rationale: "Aligned BTC/asset trend with a bounded 1.0R/1.25R/1.5R payoff; tests whether V2's sub-1R target caused negative expectancy.",
      config: base({ version: `p002-a-t${targetR}`, targetR, minRewardRisk: targetR }),
      directionMode: "momentum",
      exitMode: "hard_sl_tp",
      timeStopCandles: null,
      minimumCostCoverageRatio: 1,
      sidewaysPolicy: "no_trade"
    })),
    ...([1, 1.25, 1.5] as const).map((targetR) => candidate({
      id: `p002-b-breakout-t${String(targetR).replace(".", "_")}`,
      family: "B_structure_breakout",
      rationale: "Confirmed structure breakout with aligned BTC/asset trend and bounded payoff; tests continuation rather than pullback entry.",
      config: base({ version: `p002-b-breakout-t${targetR}`, targetR, minRewardRisk: targetR, setupMode: "breakout", structureLookback: 20 }),
      directionMode: "momentum",
      exitMode: "hard_sl_tp",
      timeStopCandles: null,
      minimumCostCoverageRatio: 1,
      sidewaysPolicy: "no_trade"
    })),
    candidate({
      id: "p002-c-rs-asym-2-3",
      family: "C_relative_strength_trend",
      rationale: "Supportive BTC regime plus asset relative strength; requires 2% LONG strength and 3% SHORT weakness to test asymmetric evidence.",
      config: base({ version: "p002-c-rs-asym-2-3", targetR: 1.25, minRewardRisk: 1.25, longRelativeStrengthThreshold: 2, shortRelativeStrengthThreshold: 3 }),
      directionMode: "relative",
      exitMode: "hard_sl_tp",
      timeStopCandles: null,
      minimumCostCoverageRatio: 1,
      sidewaysPolicy: "no_trade"
    }),
    candidate({
      id: "p002-c-rs-asym-3-2",
      family: "C_relative_strength_trend",
      rationale: "Supportive BTC regime plus asset relative strength; reverses the asymmetric thresholds to test whether long and short evidence have different quality.",
      config: base({ version: "p002-c-rs-asym-3-2", targetR: 1.25, minRewardRisk: 1.25, longRelativeStrengthThreshold: 3, shortRelativeStrengthThreshold: 2 }),
      directionMode: "relative",
      exitMode: "hard_sl_tp",
      timeStopCandles: null,
      minimumCostCoverageRatio: 1,
      sidewaysPolicy: "no_trade"
    }),
    ...([1.25, 1.5] as const).map((targetR) => candidate({
      id: `p002-d-invalidation-t${String(targetR).replace(".", "_")}`,
      family: "D_early_invalidation",
      rationale: "Compare hard SL/TP with a hypothetical latest-closed-candle exit when BTC regime or asset trend alignment fails after entry.",
      config: base({ version: `p002-d-invalidation-t${targetR}`, targetR, minRewardRisk: targetR }),
      directionMode: "momentum",
      exitMode: "early_invalidation",
      timeStopCandles: null,
      minimumCostCoverageRatio: 1,
      sidewaysPolicy: "no_trade"
    })),
    ...([96, 192] as const).map((timeStopCandles) => candidate({
      id: `p002-e-time-stop-${timeStopCandles === 96 ? "24h" : "48h"}`,
      family: "E_time_stop",
      rationale: `Exit stale setups after ${timeStopCandles === 96 ? "24h" : "48h"} of 15m candles and compare erosion against an uncapped review.`,
      config: base({ version: `p002-e-time-stop-${timeStopCandles}`, targetR: 1.25, minRewardRisk: 1.25 }),
      directionMode: "momentum",
      exitMode: "time_stop",
      timeStopCandles,
      minimumCostCoverageRatio: 1,
      sidewaysPolicy: "no_trade"
    }))
  ];
}

export function isSettledResearchStatus(status: ResearchFinalStatus | string | null | undefined): status is ResearchFinalStatus {
  return RESEARCH_SETTLED_STATUSES.includes(status as ResearchFinalStatus);
}

export function isDiscoveryCandle(openTime: number) {
  return openTime <= DISCOVERY_CUTOFF_MS;
}

export function isHoldoutCandle(openTime: number) {
  return openTime > DISCOVERY_CUTOFF_MS;
}

export function isHardSettledResearchStatus(status: ResearchFinalStatus | string | null | undefined): status is ResearchFinalStatus {
  return HARD_SETTLED_STATUSES.includes(status as ResearchFinalStatus);
}

export function classifyResearchRegime(candles: Array<{ close: number; isClosed: boolean }>) {
  const closed = candles.filter((candle) => candle.isClosed);
  if (closed.length < 50) return "unknown" as const;
  const averageClose = closed.slice(-50).reduce((sum, candle) => sum + candle.close, 0) / 50;
  const distance = averageClose > 0 ? (closed.at(-1)!.close - averageClose) / averageClose : 0;
  if (distance >= 0.005) return "bull" as const;
  if (distance <= -0.005) return "bear" as const;
  return "sideways" as const;
}

export function selectCandidateDirection(input: {
  mode: ProfitabilityCandidate["directionMode"];
  symbolCandles: Candle[];
  btcCandles: Candle[];
}) {
  if (input.mode === "relative") {
    const symbolStart = input.symbolCandles.at(-16)?.close ?? 0;
    const symbolEnd = input.symbolCandles.at(-1)?.close ?? 0;
    const btcStart = input.btcCandles.at(-16)?.close ?? 0;
    const btcEnd = input.btcCandles.at(-1)?.close ?? 0;
    const symbolReturn = symbolStart > 0 ? (symbolEnd - symbolStart) / symbolStart : 0;
    const btcReturn = btcStart > 0 ? (btcEnd - btcStart) / btcStart : 0;
    return symbolReturn - btcReturn >= 0 ? "LONG" : "SHORT";
  }
  const previous = input.symbolCandles.at(-10)?.close ?? 0;
  return (input.symbolCandles.at(-1)?.close ?? 0) >= previous ? "LONG" : "SHORT";
}

export function simulateResearchOutcome(input: {
  direction: Direction;
  plan: TradingPlan;
  candles: Array<Pick<Candle, "openTime" | "closeTime" | "high" | "low" | "close" | "isClosed">>;
  feeRate?: number;
  slippageRate?: number;
  exitMode?: ProfitabilityExitMode;
  timeStopCandles?: number | null;
  shouldInvalidate?: (candle: Pick<Candle, "close" | "openTime" | "closeTime">) => boolean;
}) : ResearchOutcome {
  const feeRate = input.feeRate ?? PROFITABILITY_002_FEE_RATE;
  const slippageRate = input.slippageRate ?? PROFITABILITY_002_SLIPPAGE_RATE;
  const exitMode = input.exitMode ?? "hard_sl_tp";
  const entryPrice = input.direction === "LONG" ? input.plan.entryHigh : input.plan.entryLow;
  const risk = Math.abs(entryPrice - input.plan.stopLoss);
  let entryHit = false;
  let entryTime: number | null = null;
  let mfe = 0;
  let mae = 0;
  let heldCandles = 0;

  const candles = [...input.candles].sort((a, b) => a.closeTime - b.closeTime);
  for (const candle of candles) {
    if (!candle.isClosed) continue;
    if (!entryHit) {
      const touchedEntry = input.direction === "LONG"
        ? candle.low <= input.plan.entryHigh && candle.high >= input.plan.entryLow
        : candle.high >= input.plan.entryLow && candle.low <= input.plan.entryHigh;
      if (!touchedEntry) continue;
      entryHit = true;
      entryTime = candle.closeTime;
    }

    if (risk <= 0) continue;
    heldCandles += 1;
    const favorable = input.direction === "LONG" ? candle.high - entryPrice : entryPrice - candle.low;
    const adverse = input.direction === "LONG" ? entryPrice - candle.low : candle.high - entryPrice;
    mfe = Math.max(mfe, favorable / risk);
    mae = Math.max(mae, adverse / risk);

    const hitSl = input.direction === "LONG" ? candle.low <= input.plan.stopLoss : candle.high >= input.plan.stopLoss;
    const hitTp1 = input.direction === "LONG" ? candle.high >= input.plan.tp1 : candle.low <= input.plan.tp1;
    if (hitSl) return settleResearch({ entryHit, entryTime, mfe, mae, durationCandles: heldCandles }, "hit_sl", input.plan.stopLoss, candle.closeTime, input.direction, entryPrice, risk, feeRate, slippageRate);
    if (hitTp1) return settleResearch({ entryHit, entryTime, mfe, mae, durationCandles: heldCandles }, "hit_tp1", input.plan.tp1, candle.closeTime, input.direction, entryPrice, risk, feeRate, slippageRate);
    if (exitMode === "early_invalidation" && input.shouldInvalidate?.(candle)) {
      return settleResearch({ entryHit, entryTime, mfe, mae, durationCandles: heldCandles }, "invalidated_exit", candle.close, candle.closeTime, input.direction, entryPrice, risk, feeRate, slippageRate);
    }
    if (exitMode === "time_stop" && input.timeStopCandles && heldCandles >= input.timeStopCandles) {
      return settleResearch({ entryHit, entryTime, mfe, mae, durationCandles: heldCandles }, "time_stop_exit", candle.close, candle.closeTime, input.direction, entryPrice, risk, feeRate, slippageRate);
    }
  }

  return {
    entryHit,
    entryTime,
    exitTime: null,
    finalStatus: entryHit ? "open" : "waiting_entry",
    grossR: null,
    netR: null,
    grossPnlPct: null,
    netPnlPct: null,
    mfe,
    mae,
    durationCandles: heldCandles
  };
}

export function summarizeResearchTrades(trades: ResearchTrade[]): ResearchSummary {
  const settled = trades.filter((trade) => isSettledResearchStatus(trade.finalStatus) && trade.netR !== null);
  const wins = settled.filter((trade) => (trade.netR ?? 0) > 0);
  const losses = settled.filter((trade) => (trade.netR ?? 0) < 0);
  const grossProfit = sum(wins.map((trade) => trade.netR ?? 0));
  const grossLoss = Math.abs(sum(losses.map((trade) => trade.netR ?? 0)));
  const returns = settled.map((trade) => trade.netR ?? 0);
  const averageWinR = average(wins.map((trade) => trade.netR ?? 0));
  const averageLossR = average(losses.map((trade) => Math.abs(trade.netR ?? 0)));
  const payoffRatio = averageLossR > 0 ? averageWinR / averageLossR : averageWinR;
  const byMonth = new Map<string, number>();
  const bySymbol = new Map<string, number>();
  for (const trade of settled) {
    const month = new Date(trade.signalTime).toISOString().slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + (trade.netR ?? 0));
    bySymbol.set(trade.symbol, (bySymbol.get(trade.symbol) ?? 0) + (trade.netR ?? 0));
  }
  return {
    trades: trades.length,
    settledTrades: settled.length,
    openTrades: trades.filter((trade) => trade.finalStatus === "open").length,
    waitingEntryTrades: trades.filter((trade) => trade.finalStatus === "waiting_entry").length,
    entryFillRate: trades.length ? trades.filter((trade) => trade.entryHit).length / trades.length * 100 : 0,
    executionRate: trades.length ? settled.length / trades.length * 100 : 0,
    winRate: settled.length ? wins.length / settled.length * 100 : 0,
    wins: wins.length,
    losses: losses.length,
    netPnlPct: sum(settled.map((trade) => trade.netPnlPct ?? 0)),
    netR: sum(returns),
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / grossLoss,
    expectancyR: average(returns),
    averageWinR,
    averageLossR,
    payoffRatio,
    breakevenWinRate: payoffRatio > 0 ? 100 / (1 + payoffRatio) : 0,
    maxDrawdownR: maxDrawdown(returns),
    positiveMonths: [...byMonth.values()].filter((value) => value > 0).length,
    symbolBreadth: new Set(settled.map((trade) => trade.symbol)).size,
    regimeBreadth: new Set(settled.map((trade) => trade.btcRegime)).size,
    largestSingleTradeContributionPct: contributionPct(Math.max(0, ...returns), grossProfit),
    largestSingleSymbolContributionPct: contributionPct(Math.max(0, ...bySymbol.values()), grossProfit)
  };
}

export function evaluateProfitability002InternalGate(input: {
  summary: ResearchSummary;
  positiveFoldCount: number;
  foldCount: number;
  noLeakage: boolean;
}) : InternalGateResult {
  const checks = {
    minimumSettledTrades: input.summary.settledTrades >= 200,
    netRPositive: input.summary.netR > 0,
    profitFactor: input.summary.profitFactor >= 1.2,
    expectancy: input.summary.expectancyR >= 0.05,
    payoff: input.summary.payoffRatio >= 0.65,
    breakevenWinRate: input.summary.breakevenWinRate <= 61,
    positiveFolds: input.foldCount > 0 && input.positiveFoldCount / input.foldCount >= 2 / 3,
    noLeakage: input.noLeakage
  };
  const reasons = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { passed: reasons.length === 0, reasons, checks };
}

export function scoreBand(score: number) {
  if (score < 78) return "<78";
  if (score < 82) return "78-81";
  if (score < 86) return "82-85";
  if (score < 90) return "86-89";
  return "90+";
}

export function relativeStrengthBand(value: number) {
  if (value <= -4) return "<=-4%";
  if (value < -2) return "(-4,-2)%";
  if (value < 0) return "[-2,0)%";
  if (value < 2) return "[0,2)%";
  if (value < 4) return "[2,4)%";
  return ">=4%";
}

export function volatilityBand(slAtrRatio: number) {
  if (slAtrRatio < 0.75) return "<0.75 ATR";
  if (slAtrRatio < 1.25) return "0.75-1.24 ATR";
  if (slAtrRatio < 2) return "1.25-1.99 ATR";
  return "2+ ATR";
}

export function costCoverageBand(value: number) {
  if (value < 1) return "<1x";
  if (value < 1.5) return "1-1.49x";
  if (value < 2) return "1.5-1.99x";
  return "2x+";
}

export function slAtrRatioBand(value: number) {
  return volatilityBand(value);
}

function settleResearch(
  base: Pick<ResearchOutcome, "entryHit" | "entryTime" | "mfe" | "mae" | "durationCandles">,
  finalStatus: Extract<ResearchFinalStatus, "hit_tp1" | "hit_sl" | "invalidated_exit" | "time_stop_exit">,
  exitPrice: number,
  exitTime: number,
  direction: Direction,
  entryPrice: number,
  risk: number,
  feeRate: number,
  slippageRate: number
): ResearchOutcome {
  const grossReturn = direction === "LONG"
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  const grossR = direction === "LONG"
    ? (exitPrice - entryPrice) / risk
    : (entryPrice - exitPrice) / risk;
  const roundTripCostPct = (feeRate + slippageRate) * 2;
  const costR = entryPrice > 0 ? roundTripCostPct / (risk / entryPrice) : 0;
  return {
    entryHit: base.entryHit,
    entryTime: base.entryTime,
    exitTime,
    finalStatus,
    grossR: round(grossR),
    netR: round(grossR - costR),
    grossPnlPct: round(grossReturn * 100),
    netPnlPct: round((grossReturn - roundTripCostPct) * 100),
    mfe: base.mfe,
    mae: base.mae,
    durationCandles: base.durationCandles
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

function contributionPct(value: number, total: number) {
  return total > 0 ? value / total * 100 : 0;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
