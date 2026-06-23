import type { Candle } from "@/lib/signal/types";

export function calculateAtr(candles: Candle[], period = 14) {
  if (candles.length < 2) return 0;

  const ranges = candles.slice(1).map((item, index) => {
    const previousClose = candles[index].close;
    return Math.max(
      item.high - item.low,
      Math.abs(item.high - previousClose),
      Math.abs(item.low - previousClose)
    );
  });

  const sample = ranges.slice(-period);
  return average(sample);
}

export function calculateRelativeStrength(symbolCandles: Candle[], btcCandles: Candle[]) {
  if (symbolCandles.length < 2 || btcCandles.length < 2) return 0;

  const symbolReturn = pctChange(symbolCandles[0].close, symbolCandles.at(-1)!.close);
  const btcReturn = pctChange(btcCandles[0].close, btcCandles.at(-1)!.close);
  return symbolReturn - btcReturn;
}

export function calculateDataQualityScore(candles: Candle[], now: number, expectedIntervalMs: number) {
  if (candles.length === 0) return 0;

  let score = 100;
  const openCount = candles.filter((item) => !item.isClosed).length;
  score -= openCount * 20;

  const uniqueOpenTimes = new Set(candles.map((item) => item.openTime));
  if (uniqueOpenTimes.size !== candles.length) score -= 25;

  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index].openTime - sorted[index - 1].openTime;
    if (gap > expectedIntervalMs * 1.5) score -= 10;
  }

  const latest = sorted.at(-1)!;
  if (now - latest.closeTime > expectedIntervalMs * 2) score -= 25;

  return clamp(score, 0, 100);
}

export function calculateVolumeRatio(candles: Candle[], lookback = 20) {
  if (candles.length < 2) return 1;
  const latest = candles.at(-1)!.quoteVolume;
  const history = candles.slice(-lookback - 1, -1).map((item) => item.quoteVolume);
  const base = average(history);
  return base === 0 ? 1 : latest / base;
}

export function findStructure(candles: Candle[], lookback = 20) {
  const sample = candles.slice(-lookback);
  return {
    high: Math.max(...sample.map((item) => item.high)),
    low: Math.min(...sample.map((item) => item.low))
  };
}

export function pctChange(from: number, to: number) {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

export function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

