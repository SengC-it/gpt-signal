import { clamp } from "@/lib/signal/indicators";
import type { SignalLevel } from "@/lib/signal/types";

export type ScoreInput = {
  dataQualityScore: number;
  btcAligned: boolean;
  marketRegimeMatched: boolean;
  trend4hAligned: boolean;
  trend1hAligned: boolean;
  entryStructureConfirmed: boolean;
  volumeRatio: number;
  oiChange15m: number | null;
  fundingRate: number | null;
  relativeStrengthScore: number;
  liquidityScore: number;
  weightedRr: number;
};

export function scoreSignal(input: ScoreInput) {
  let score = 0;
  score += clamp(input.dataQualityScore / 10, 0, 10);
  score += input.btcAligned ? 10 : 4;
  score += input.marketRegimeMatched ? 10 : 5;
  score += input.trend4hAligned ? 8 : 3;
  score += input.trend1hAligned ? 8 : 3;
  score += input.entryStructureConfirmed ? 14 : 5;
  score += clamp(input.volumeRatio / 2, 0, 1) * 8;
  score += input.oiChange15m === null ? 5 : input.oiChange15m > 0 ? 8 : 3;
  score += fundingHealthScore(input.fundingRate);
  score += clamp(Math.abs(input.relativeStrengthScore), 0, 6);
  score += clamp(input.liquidityScore, 0, 5);
  score += input.weightedRr >= 1.3 ? 5 : 1;
  return Math.round(clamp(score, 0, 100));
}

export function levelFromScore(score: number): SignalLevel {
  if (score >= 88) return "S";
  if (score >= 78) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "NONE";
}

function fundingHealthScore(fundingRate: number | null) {
  if (fundingRate === null) return 6;
  const abs = Math.abs(fundingRate);
  if (abs < 0.0005) return 8;
  if (abs < 0.001) return 6;
  if (abs < 0.002) return 4;
  return 2;
}

