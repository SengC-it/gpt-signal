import {
  calculateAtr,
  calculateDataQualityScore,
  calculateRelativeStrength,
  calculateVolumeRatio,
  findStructure
} from "./indicators.ts";
import { levelFromScore, scoreSignal } from "./scoring.ts";
import { REVIEW_ROUND_TRIP_COST_PCT } from "./review.ts";
import { resolveMainStrategyConfig, strategyParameters } from "./strategy-config.ts";
import type { Direction, SignalCandidateInput, SignalEvaluation, TradingPlan } from "./types.ts";

const FIFTEEN_MINUTES = 900_000;

export function buildTradingPlan(input: {
  direction: Direction;
  currentPrice: number;
  atr: number;
  structureLow: number;
  structureHigh: number;
  stopBufferAtr?: number;
  targetR?: number;
}): TradingPlan {
  const buffer = input.atr * (input.stopBufferAtr ?? 0.3);

  if (input.direction === "LONG") {
    const stopLoss = input.structureLow - buffer;
    const entryLow = input.currentPrice - input.atr * 0.15;
    const entryHigh = input.currentPrice + input.atr * 0.35;
    return createPlan("pullback_limit", entryLow, entryHigh, stopLoss, input.atr, "LONG", input.targetR ?? 1);
  }

  const stopLoss = input.structureHigh + buffer;
  const entryLow = input.currentPrice - input.atr * 0.35;
  const entryHigh = input.currentPrice + input.atr * 0.15;
  return createPlan("pullback_limit", entryLow, entryHigh, stopLoss, input.atr, "SHORT", input.targetR ?? 1);
}

export function shouldMarkNoChase(input: {
  direction: Direction;
  currentPrice: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
}) {
  const risk = input.direction === "LONG" ? input.entryHigh - input.stopLoss : input.stopLoss - input.entryLow;
  if (risk <= 0) return true;
  return input.direction === "LONG"
    ? input.currentPrice > input.entryHigh + risk
    : input.currentPrice < input.entryLow - risk;
}

export function evaluateSignalCandidate(input: SignalCandidateInput): SignalEvaluation {
  const latest = input.candles15m.at(-1);
  const strategyVersion = input.strategyVersion ?? "v1";
  const strategyConfig = input.strategyConfig ?? resolveMainStrategyConfig(strategyVersion);
  const atr = calculateAtr(input.candles15m, 14);
  const dataQualityScore = calculateDataQualityScore(input.candles15m, input.now, FIFTEEN_MINUTES);
  const relativeStrengthScore = calculateRelativeStrength(input.candles15m.slice(-16), input.btcCandles15m.slice(-16));
  const volumeRatio = calculateVolumeRatio(input.candles15m, 20);
  const structure = findStructure(input.candles15m, strategyConfig.structureLookback);
  const currentPrice = latest?.close ?? 0;
  const plan = latest
    ? buildTradingPlan({
        direction: input.direction,
        currentPrice,
        atr,
        structureLow: structure.low,
        structureHigh: structure.high,
        targetR: strategyConfig.targetR,
        stopBufferAtr: strategyConfig.stopBufferAtr
      })
    : null;

  const btcAligned = input.direction === "LONG" ? relativeStrengthScore >= -2 : relativeStrengthScore <= 2;
  const btcRegime = resolveBtcRegime(input.btcCandles4h ?? []);
  const marketRegimeMatched = strategyConfig.regimeMode === "any"
    || (input.direction === "LONG" ? btcRegime === "bull" : btcRegime === "bear");
  const weaknessMatched = !strategyConfig.requireWeakness
    || (input.direction === "SHORT" ? relativeStrengthScore <= 0 : relativeStrengthScore >= 0);
  const configuredStrengthThreshold = input.direction === "LONG"
    ? strategyConfig.longRelativeStrengthThreshold || strategyConfig.relativeStrengthThreshold
    : strategyConfig.shortRelativeStrengthThreshold || strategyConfig.relativeStrengthThreshold;
  const relativeStrengthMatched = configuredStrengthThreshold <= 0
    ? true
    : input.direction === "LONG"
      ? strategyConfig.relativeStrengthMode === "trend"
        ? relativeStrengthScore >= configuredStrengthThreshold
        : relativeStrengthScore <= -configuredStrengthThreshold
      : strategyConfig.relativeStrengthMode === "trend"
        ? relativeStrengthScore <= -configuredStrengthThreshold
        : relativeStrengthScore >= configuredStrengthThreshold;
  const entryStructureConfirmed = strategyConfig.setupMode === "pullback"
    || isBreakout(input.candles15m, input.direction, strategyConfig.structureLookback);
  const assetTrend1hAligned = resolveTrendAlignment(input.candles15m, input.direction, 4);
  const assetTrend4hAligned = resolveTrendAlignment(input.candles15m, input.direction, 16);
  const trendMatched = strategyConfig.trendMode === "any" || (assetTrend1hAligned && assetTrend4hAligned);
  const trend1hAligned = strategyConfig.trendMode === "any" || assetTrend1hAligned;
  const trend4hAligned = strategyConfig.trendMode === "any" || assetTrend4hAligned;
  const score = scoreSignal({
    dataQualityScore,
    btcAligned,
    marketRegimeMatched,
    trend4hAligned,
    trend1hAligned,
    entryStructureConfirmed,
    volumeRatio,
    oiChange15m: input.oiChange15m,
    fundingRate: input.fundingRate,
    relativeStrengthScore,
    liquidityScore: 5,
    weightedRr: plan?.weightedRr ?? 0
  });
  const level = levelFromScore(score);
  const noChase = plan
    ? shouldMarkNoChase({
        direction: input.direction,
        currentPrice,
        entryLow: plan.entryLow,
        entryHigh: plan.entryHigh,
        stopLoss: plan.stopLoss
      })
    : true;
  const eligibleForPlan =
    (level === "A" || level === "S") &&
    score >= strategyConfig.minScore &&
    dataQualityScore >= 90 &&
    (plan?.weightedRr ?? 0) >= strategyConfig.minRewardRisk &&
    marketRegimeMatched &&
    weaknessMatched &&
    relativeStrengthMatched &&
    entryStructureConfirmed &&
    trendMatched &&
    !noChase &&
    !input.circuitBreakerActive;

  return {
    symbol: input.symbol,
    direction: input.direction,
    signalType: input.signalType,
    lifecycleStatus: eligibleForPlan ? "planned" : score >= 65 ? "watching" : "detected",
    level,
    score,
    plan: eligibleForPlan ? plan : null,
    btcState: btcRegime,
    marketRegime: `${btcRegime}_${volumeRatio >= 2 ? "expansion" : "trend"}`,
    dataQualityScore,
    relativeStrengthScore,
    reasons: buildReasons(volumeRatio, relativeStrengthScore, dataQualityScore),
    invalidationRules: ["15m 收盘跌破结构位", "价格远离入场区超过 1R", "数据质量低于 75"],
    noChaseRule: plan
      ? {
          direction: input.direction,
          noChasePrice: plan.noChasePrice
        }
      : {},
    strategyVersion,
    strategyParameters: strategyParameters(strategyConfig)
  };
}

function createPlan(
  entryMode: TradingPlan["entryMode"],
  entryLow: number,
  entryHigh: number,
  stopLoss: number,
  atr: number,
  direction: Direction,
  targetR: number
): TradingPlan {
  const sign = direction === "LONG" ? 1 : -1;
  const entryReference = direction === "LONG" ? entryHigh : entryLow;
  const entryRisk = Math.abs(entryReference - stopLoss);
  const tp1 = entryReference + sign * entryRisk * targetR;
  const tp2 = entryReference + sign * entryRisk * targetR * 2;
  const tp3 = entryReference + sign * entryRisk * targetR * 3;
  // New signals are exited fully at TP1. Keep the legacy field name for the
  // existing database/UI, but its value is now the actual TP1 gross R.
  const weightedRr = targetR;
  const costR = entryReference > 0 && entryRisk > 0
    ? REVIEW_ROUND_TRIP_COST_PCT / (entryRisk / entryReference)
    : 0;
  const costAdjustedRr = weightedRr - costR;
  const slDistancePct = entryReference === 0 ? 0 : (entryRisk / entryReference) * 100;
  const slAtrRatio = atr === 0 ? 0 : entryRisk / atr;
  const noChasePrice = direction === "LONG" ? entryHigh + entryRisk : entryLow - entryRisk;

  return {
    entryMode,
    entryLow: round(entryLow),
    entryHigh: round(entryHigh),
    stopLoss: round(stopLoss),
    tp1: round(tp1),
    tp2: round(tp2),
    tp3: round(tp3),
    theoreticalRr: targetR * 3,
    weightedRr,
    costAdjustedRr,
    slDistancePct: round(slDistancePct),
    slAtrRatio: round(slAtrRatio),
    noChasePrice: round(noChasePrice)
  };
}

function buildReasons(volumeRatio: number, relativeStrengthScore: number, dataQualityScore: number) {
  const reasons = [`数据质量 ${dataQualityScore}`];
  if (volumeRatio >= 2) reasons.push(`成交额放大 ${volumeRatio.toFixed(2)} 倍`);
  if (relativeStrengthScore > 0) reasons.push(`相对 BTC 走强 ${relativeStrengthScore.toFixed(2)}%`);
  if (relativeStrengthScore < 0) reasons.push(`相对 BTC 走弱 ${relativeStrengthScore.toFixed(2)}%`);
  return reasons;
}

function round(value: number) {
  return Math.round(value * 100_000) / 100_000;
}

export function resolveBtcRegime(candles: Array<{ close: number; isClosed: boolean }>) {
  const closed = candles.filter((candle) => candle.isClosed);
  if (closed.length < 50) return "unknown" as const;
  const averageClose = closed.slice(-50).reduce((sum, candle) => sum + candle.close, 0) / 50;
  return closed.at(-1)!.close >= averageClose ? "bull" as const : "bear" as const;
}

function resolveTrendAlignment(candles: Array<{ close: number; isClosed: boolean }>, direction: Direction, period: number) {
  const closed = candles.filter((candle) => candle.isClosed);
  if (closed.length < period * 2) return false;
  const recent = average(closed.slice(-period).map((candle) => candle.close));
  const previous = average(closed.slice(-period * 2, -period).map((candle) => candle.close));
  const latest = closed.at(-1)!.close;
  return direction === "LONG"
    ? latest >= recent && recent >= previous
    : latest <= recent && recent <= previous;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isBreakout(candles: Array<{ high: number; low: number; close: number; isClosed: boolean }>, direction: Direction, lookback: number) {
  const closed = candles.filter((candle) => candle.isClosed);
  if (closed.length <= lookback) return false;
  const latest = closed.at(-1)!;
  const previous = closed.slice(-lookback - 1, -1);
  const previousHigh = Math.max(...previous.map((candle) => candle.high));
  const previousLow = Math.min(...previous.map((candle) => candle.low));
  return direction === "LONG" ? latest.close > previousHigh : latest.close < previousLow;
}

