import type { SignalEvaluation } from "@/lib/signal/types";

export const sampleSignals: SignalEvaluation[] = [
  {
    symbol: "SOLUSDT",
    direction: "LONG",
    signalType: "trend_pullback",
    lifecycleStatus: "planned",
    level: "A",
    score: 84,
    btcState: "weak_bull",
    marketRegime: "trend",
    dataQualityScore: 96,
    relativeStrengthScore: 3.8,
    reasons: ["数据质量 96", "相对 BTC 走强 3.80%", "成交额温和放大"],
    invalidationRules: ["15m 收盘跌破结构位", "价格远离入场区超过 1R", "数据质量低于 75"],
    noChaseRule: { direction: "LONG", noChasePrice: 116.2 },
    plan: {
      entryMode: "pullback_limit",
      entryLow: 102.8,
      entryHigh: 103.7,
      stopLoss: 98.4,
      tp1: 108.2,
      tp2: 113,
      tp3: 117.8,
      theoreticalRr: 3,
      weightedRr: 1.8,
      costAdjustedRr: 1.68,
      slDistancePct: 4.3,
      slAtrRatio: 1.4,
      noChasePrice: 116.2
    }
  },
  {
    symbol: "DOGEUSDT",
    direction: "SHORT",
    signalType: "risk_anomaly",
    lifecycleStatus: "watching",
    level: "B",
    score: 71,
    btcState: "range",
    marketRegime: "expansion",
    dataQualityScore: 91,
    relativeStrengthScore: -4.1,
    reasons: ["数据质量 91", "相对 BTC 走弱 -4.10%", "短线波动扩张"],
    invalidationRules: ["重新站回箱体上沿", "风险异动消退"],
    noChaseRule: {},
    plan: null
  }
];

export const sampleRadar = [
  { symbol: "SOLUSDT", pool: "C", rs: 3.8, volumeRatio: 2.4, atrState: "normal_vol", funding: "正常", score: 84 },
  { symbol: "LINKUSDT", pool: "B", rs: 2.1, volumeRatio: 1.7, atrState: "low_vol", funding: "偏热", score: 78 },
  { symbol: "DOGEUSDT", pool: "D", rs: -4.1, volumeRatio: 3.2, atrState: "high_vol", funding: "极端", score: 71 }
];

