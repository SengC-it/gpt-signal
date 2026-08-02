import type { MainStrategyConfig, StrategyFamily } from "./types.ts";

export const MAIN_STRATEGY_V1: MainStrategyConfig = {
  version: "v1",
  targetR: 1,
  minScore: 78,
  minRewardRisk: 1,
  regimeMode: "any",
  requireWeakness: false,
  trendMode: "any",
  structureLookback: 20,
  stopBufferAtr: 0.3,
  relativeStrengthThreshold: 0,
  longRelativeStrengthThreshold: 0,
  shortRelativeStrengthThreshold: 0,
  relativeStrengthMode: "trend",
  setupMode: "pullback"
};

// Kept as the current production baseline. It is not treated as a profitable
// candidate until it passes the same validation gate as every new version.
export const MAIN_STRATEGY_V2: MainStrategyConfig = {
  version: "v2",
  targetR: 0.35,
  minScore: 86,
  minRewardRisk: 0.35,
  regimeMode: "any",
  requireWeakness: false,
  trendMode: "any",
  structureLookback: 20,
  stopBufferAtr: 0.3,
  relativeStrengthThreshold: 0,
  longRelativeStrengthThreshold: 0,
  shortRelativeStrengthThreshold: 0,
  relativeStrengthMode: "trend",
  setupMode: "pullback"
};

export const MAIN_VALIDATION_CANDIDATES: MainStrategyConfig[] = [
  ...[1, 1.25, 1.5].flatMap((targetR) =>
    [82, 84, 86, 88].flatMap((minScore) =>
      (["any", "aligned"] as const).flatMap((regimeMode) =>
        ([false, true] as const).flatMap((requireWeakness) =>
          (["any", "aligned"] as const).map((trendMode) => ({
            version: candidateVersion(targetR, minScore, regimeMode, requireWeakness, trendMode),
            targetR,
            minScore,
            minRewardRisk: targetR,
            regimeMode,
            requireWeakness,
            trendMode,
            structureLookback: 20,
            stopBufferAtr: 0.3,
            relativeStrengthThreshold: 0,
            longRelativeStrengthThreshold: 0,
            shortRelativeStrengthThreshold: 0,
            relativeStrengthMode: "trend" as const,
            setupMode: "pullback" as const
          }))
        )
      )
    )
  )
];

export const MAIN_ASYMMETRIC_CANDIDATES: MainStrategyConfig[] = [
  ...[4, 6, 8].flatMap((longRelativeStrengthThreshold) =>
    [1, 1.25, 1.35, 1.5, 2].map((shortRelativeStrengthThreshold) => ({
      version: `main-v4-asym-t1_5-s88-aligned-weak-trend-aligned-l${longRelativeStrengthThreshold}-s${String(shortRelativeStrengthThreshold).replace(".", "_")}`,
      targetR: 1.5,
      minScore: 88,
      minRewardRisk: 1.5,
      regimeMode: "aligned" as const,
      requireWeakness: true,
      trendMode: "aligned" as const,
      structureLookback: 20,
      stopBufferAtr: 0.3,
      relativeStrengthThreshold: 0,
      longRelativeStrengthThreshold,
      shortRelativeStrengthThreshold,
      relativeStrengthMode: "trend" as const,
      setupMode: "pullback" as const
    }))
  )
];

export const MAIN_STRATEGY_CONFIGS: Record<string, MainStrategyConfig> = {
  [MAIN_STRATEGY_V1.version]: MAIN_STRATEGY_V1,
  [MAIN_STRATEGY_V2.version]: MAIN_STRATEGY_V2,
  ...Object.fromEntries([
    ...MAIN_VALIDATION_CANDIDATES,
    ...MAIN_ASYMMETRIC_CANDIDATES
  ].map((config) => [config.version, config]))
};

export function resolveMainStrategyConfig(version: string): MainStrategyConfig {
  const config = MAIN_STRATEGY_CONFIGS[version];
  if (!config) throw new Error(`Unknown main strategy version: ${version}`);
  return config;
}

export function strategyParameters(config: MainStrategyConfig) {
  return {
    family: "main" satisfies StrategyFamily,
    targetR: config.targetR,
    minScore: config.minScore,
    minRewardRisk: config.minRewardRisk,
    regimeMode: config.regimeMode,
    requireWeakness: config.requireWeakness,
    trendMode: config.trendMode,
    structureLookback: config.structureLookback,
    stopBufferAtr: config.stopBufferAtr,
    relativeStrengthThreshold: config.relativeStrengthThreshold,
    longRelativeStrengthThreshold: config.longRelativeStrengthThreshold,
    shortRelativeStrengthThreshold: config.shortRelativeStrengthThreshold,
    relativeStrengthMode: config.relativeStrengthMode,
    setupMode: config.setupMode,
    exitMode: "full_tp1",
    expiry: "none",
    sameCandlePriority: "stop"
  };
}

export function candidateVersion(
  targetR: number,
  minScore: number,
  regimeMode: "any" | "aligned",
  requireWeakness: boolean,
  trendMode: "any" | "aligned"
) {
  const target = String(targetR).replace(".", "_");
  return `main-v3-t${target}-s${minScore}-${regimeMode}-${requireWeakness ? "weak" : "plain"}-trend-${trendMode}`;
}
