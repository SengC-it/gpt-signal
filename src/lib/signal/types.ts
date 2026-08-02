export type Direction = "LONG" | "SHORT";
export type StrategyVersion = string;
export type DeliveryMode = "production" | "shadow";
export type StrategyFamily = "main" | "alt_basket";
export type SignalLevel = "S" | "A" | "B" | "C" | "NONE";
export type SignalType = "trend_pullback" | "volume_breakout" | "risk_anomaly" | "alt_basket_short";
export type LifecycleStatus =
  | "detected"
  | "watching"
  | "setup_confirmed"
  | "planned"
  | "waiting_entry"
  | "entered"
  | "no_chase"
  | "expired"
  | "invalidated"
  | "hit_tp1"
  | "hit_tp2"
  | "hit_tp3"
  | "hit_sl"
  | "archived";

export type Candle = {
  symbol: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number | null;
  takerBuyVolume: number | null;
  takerBuyQuoteVolume: number | null;
  isClosed: boolean;
};

export type TradingPlan = {
  entryMode: "breakout_confirm" | "pullback_limit" | "confirmation_wait";
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  theoreticalRr: number;
  weightedRr: number;
  costAdjustedRr: number;
  slDistancePct: number;
  slAtrRatio: number;
  noChasePrice: number;
};

export type MainStrategyConfig = {
  version: StrategyVersion;
  targetR: number;
  minScore: number;
  minRewardRisk: number;
  regimeMode: "any" | "aligned";
  requireWeakness: boolean;
  trendMode: "any" | "aligned";
  structureLookback: number;
  stopBufferAtr: number;
  relativeStrengthThreshold: number;
  longRelativeStrengthThreshold: number;
  shortRelativeStrengthThreshold: number;
  relativeStrengthMode: "trend" | "reversal";
  setupMode: "pullback" | "breakout";
};

export type SignalCandidateInput = {
  symbol: string;
  direction: Direction;
  signalType: SignalType;
  candles15m: Candle[];
  btcCandles15m: Candle[];
  btcCandles4h?: Candle[];
  strategyVersion?: StrategyVersion;
  strategyConfig?: MainStrategyConfig;
  now: number;
  fundingRate: number | null;
  oiChange15m: number | null;
  circuitBreakerActive: boolean;
};

export type SignalEvaluation = {
  symbol: string;
  direction: Direction;
  signalType: SignalType;
  lifecycleStatus: LifecycleStatus;
  level: SignalLevel;
  score: number;
  plan: TradingPlan | null;
  btcState: string;
  marketRegime: string;
  dataQualityScore: number;
  relativeStrengthScore: number;
  reasons: string[];
  invalidationRules: string[];
  noChaseRule: Record<string, number | string>;
  strategyVersion?: StrategyVersion;
  deliveryMode?: DeliveryMode;
  strategyFamily?: StrategyFamily;
  strategyParameters?: Record<string, boolean | number | string>;
};

