import {
  calculateAtr,
  calculateDataQualityScore,
  calculateRelativeStrength,
  calculateVolumeRatio,
  findStructure
} from "@/lib/signal/indicators";
import { levelFromScore, scoreSignal } from "@/lib/signal/scoring";
import type { Direction, SignalCandidateInput, SignalEvaluation, TradingPlan } from "@/lib/signal/types";

const FIFTEEN_MINUTES = 900_000;

export function buildTradingPlan(input: {
  direction: Direction;
  currentPrice: number;
  atr: number;
  structureLow: number;
  structureHigh: number;
}): TradingPlan {
  const buffer = input.atr * 0.3;

  if (input.direction === "LONG") {
    const stopLoss = input.structureLow - buffer;
    const risk = input.currentPrice - stopLoss;
    const entryLow = input.currentPrice - input.atr * 0.15;
    const entryHigh = input.currentPrice + input.atr * 0.35;
    return createPlan("pullback_limit", entryLow, entryHigh, stopLoss, input.currentPrice, risk, input.atr, "LONG");
  }

  const stopLoss = input.structureHigh + buffer;
  const risk = stopLoss - input.currentPrice;
  const entryLow = input.currentPrice - input.atr * 0.35;
  const entryHigh = input.currentPrice + input.atr * 0.15;
  return createPlan("pullback_limit", entryLow, entryHigh, stopLoss, input.currentPrice, risk, input.atr, "SHORT");
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
  const atr = calculateAtr(input.candles15m, 14);
  const dataQualityScore = calculateDataQualityScore(input.candles15m, input.now, FIFTEEN_MINUTES);
  const relativeStrengthScore = calculateRelativeStrength(input.candles15m.slice(-16), input.btcCandles15m.slice(-16));
  const volumeRatio = calculateVolumeRatio(input.candles15m, 20);
  const structure = findStructure(input.candles15m, 20);
  const currentPrice = latest?.close ?? 0;
  const plan = latest
    ? buildTradingPlan({
        direction: input.direction,
        currentPrice,
        atr,
        structureLow: structure.low,
        structureHigh: structure.high
      })
    : null;

  const btcAligned = input.direction === "LONG" ? relativeStrengthScore >= -2 : relativeStrengthScore <= 2;
  const score = scoreSignal({
    dataQualityScore,
    btcAligned,
    marketRegimeMatched: true,
    trend4hAligned: true,
    trend1hAligned: true,
    entryStructureConfirmed: true,
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
    dataQualityScore >= 90 &&
    (plan?.weightedRr ?? 0) >= 1.3 &&
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
    btcState: relativeStrengthScore >= 0 ? "weak_bull" : "range",
    marketRegime: volumeRatio >= 2 ? "expansion" : "trend",
    dataQualityScore,
    relativeStrengthScore,
    reasons: buildReasons(volumeRatio, relativeStrengthScore, dataQualityScore),
    invalidationRules: ["15m 收盘跌破结构位", "价格远离入场区超过 1R", "数据质量低于 75"],
    noChaseRule: plan
      ? {
          direction: input.direction,
          noChasePrice: plan.noChasePrice
        }
      : {}
  };
}

function createPlan(
  entryMode: TradingPlan["entryMode"],
  entryLow: number,
  entryHigh: number,
  stopLoss: number,
  currentPrice: number,
  risk: number,
  atr: number,
  direction: Direction
): TradingPlan {
  const sign = direction === "LONG" ? 1 : -1;
  const tp1 = currentPrice + sign * risk;
  const tp2 = currentPrice + sign * risk * 2;
  const tp3 = currentPrice + sign * risk * 3;
  const weightedRr = 0.4 * 1 + 0.4 * 2 + 0.2 * 3;
  const costAdjustedRr = weightedRr - 0.12;
  const slDistancePct = Math.abs((currentPrice - stopLoss) / currentPrice) * 100;
  const slAtrRatio = atr === 0 ? 0 : Math.abs(currentPrice - stopLoss) / atr;
  const noChasePrice = direction === "LONG" ? entryHigh + risk : entryLow - risk;

  return {
    entryMode,
    entryLow: round(entryLow),
    entryHigh: round(entryHigh),
    stopLoss: round(stopLoss),
    tp1: round(tp1),
    tp2: round(tp2),
    tp3: round(tp3),
    theoreticalRr: 3,
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

