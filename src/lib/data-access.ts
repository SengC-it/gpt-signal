import "server-only";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { sampleRadar, sampleSignals } from "@/lib/sample-data";
import type { ReviewFinalStatus } from "@/lib/signal/review";
import type { Direction, LifecycleStatus, SignalEvaluation, SignalLevel, SignalType } from "@/lib/signal/types";

export type DisplaySignal = SignalEvaluation & {
  id: string;
  createdAt: string;
};

export type RadarRow = {
  symbol: string;
  pool: string;
  rs: number;
  volumeRatio: number | string;
  atrState: string;
  funding: string;
  score: number;
};

export type DisplaySignalReview = {
  id: string;
  signalId: string;
  strategyVersion: string | null;
  strategyFamily: string | null;
  deliveryMode: "production" | "shadow";
  symbol: string;
  direction: Direction;
  status: ReviewFinalStatus;
  signalSentAt: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  entryHit: boolean;
  entryTime: string | null;
  entryPrice: number | null;
  exitTime: string | null;
  exitPrice: number | null;
  grossPnlPct: number | null;
  netPnlPct: number | null;
  grossR: number | null;
  netR: number | null;
  mfe: number;
  mae: number;
  lastCheckedAt: string | null;
};

type DbSignal = {
  id?: unknown;
  strategy_version?: unknown;
  delivery_mode?: unknown;
  symbol?: unknown;
  direction?: unknown;
  signal_type?: unknown;
  lifecycle_status?: unknown;
  level?: unknown;
  score?: unknown;
  entry_mode?: unknown;
  entry_low?: unknown;
  entry_high?: unknown;
  stop_loss?: unknown;
  tp1?: unknown;
  tp2?: unknown;
  tp3?: unknown;
  theoretical_rr?: unknown;
  weighted_rr?: unknown;
  cost_adjusted_rr?: unknown;
  sl_distance_pct?: unknown;
  sl_atr_ratio?: unknown;
  btc_state?: unknown;
  market_regime?: unknown;
  relative_strength_score?: unknown;
  data_quality_score?: unknown;
  reasons?: unknown;
  invalidation_rules?: unknown;
  no_chase_rule?: unknown;
  created_at?: unknown;
};

export async function getRecentSignals(limit = 20): Promise<DisplaySignal[]> {
  if (!hasSupabaseServerEnv()) return sampleSignals.map((item) => toDisplaySignal(item, item.symbol, "样例"));

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("gpt_signals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data || data.length === 0) {
      return sampleSignals.map((item) => toDisplaySignal(item, item.symbol, "样例"));
    }

    return data.map((row) => signalFromRow(row as DbSignal));
  } catch {
    return sampleSignals.map((item) => toDisplaySignal(item, item.symbol, "样例"));
  }
}

export async function getSignalById(id: string): Promise<DisplaySignal> {
  if (!hasSupabaseServerEnv()) {
    const sample = sampleSignals.find((item) => item.symbol === id) ?? sampleSignals[0];
    return toDisplaySignal(sample, sample.symbol, "样例");
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("gpt_signals").select("*").eq("id", id).maybeSingle();
    if (!error && data) return signalFromRow(data as DbSignal);
  } catch {
    // Fall through to sample by symbol.
  }

  const sample = sampleSignals.find((item) => item.symbol === id) ?? sampleSignals[0];
  return toDisplaySignal(sample, sample.symbol, "样例");
}

export async function getRadarRows(): Promise<RadarRow[]> {
  const signals = await getRecentSignals(50);
  if (signals.length === 0) return sampleRadar;

  const latestBySymbol = new Map<string, DisplaySignal>();
  for (const signal of signals) {
    if (!latestBySymbol.has(signal.symbol)) latestBySymbol.set(signal.symbol, signal);
  }

  return Array.from(latestBySymbol.values()).map((signal) => ({
    symbol: signal.symbol,
    pool: signal.level === "S" || signal.level === "A" ? "C" : "B",
    rs: Number(signal.relativeStrengthScore.toFixed(2)),
    volumeRatio: "-",
    atrState: signal.plan ? "normal_vol" : "待确认",
    funding: "未接入",
    score: signal.score
  }));
}

export async function getRecentSignalReviews(limit = 200): Promise<DisplaySignalReview[]> {
  if (!hasSupabaseServerEnv()) return [];

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("gpt_signal_results")
      .select("*")
      .order("signal_sent_at", { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return data.map((row) => reviewFromRow(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

function signalFromRow(row: DbSignal): DisplaySignal {
  const plan = isNumberLike(row.entry_low)
    ? {
        entryMode: text(row.entry_mode, "confirmation_wait") as "breakout_confirm" | "pullback_limit" | "confirmation_wait",
        entryLow: num(row.entry_low),
        entryHigh: num(row.entry_high),
        stopLoss: num(row.stop_loss),
        tp1: num(row.tp1),
        tp2: num(row.tp2),
        tp3: num(row.tp3),
        theoreticalRr: num(row.theoretical_rr),
        weightedRr: num(row.weighted_rr),
        costAdjustedRr: num(row.cost_adjusted_rr),
        slDistancePct: num(row.sl_distance_pct),
        slAtrRatio: num(row.sl_atr_ratio),
        noChasePrice: noChasePrice(row.no_chase_rule)
      }
    : null;

  return {
    id: text(row.id, text(row.symbol, "unknown")),
    createdAt: text(row.created_at, ""),
    symbol: text(row.symbol, "UNKNOWN"),
    direction: direction(row.direction),
    signalType: signalType(row.signal_type),
    lifecycleStatus: lifecycle(row.lifecycle_status),
    level: level(row.level),
    score: num(row.score),
    btcState: text(row.btc_state, "unknown"),
    marketRegime: text(row.market_regime, "unknown"),
    dataQualityScore: num(row.data_quality_score),
    relativeStrengthScore: num(row.relative_strength_score),
    reasons: textArray(row.reasons),
    invalidationRules: textArray(row.invalidation_rules),
    noChaseRule: objectRecord(row.no_chase_rule),
    strategyVersion: nullableText(row.strategy_version) ?? undefined,
    deliveryMode: row.delivery_mode === "shadow" ? "shadow" : "production",
    plan
  };
}

function reviewFromRow(row: Record<string, unknown>): DisplaySignalReview {
  return {
    id: text(row.id, "unknown"),
    signalId: text(row.signal_id, "unknown"),
    strategyVersion: nullableText(row.strategy_version),
    strategyFamily: nullableText(row.strategy_family),
    deliveryMode: row.delivery_mode === "shadow" ? "shadow" : "production",
    symbol: text(row.symbol, "UNKNOWN"),
    direction: direction(row.direction),
    status: reviewStatus(row.final_status),
    signalSentAt: text(row.signal_sent_at, ""),
    entryLow: num(row.entry_low),
    entryHigh: num(row.entry_high),
    stopLoss: num(row.stop_loss),
    tp1: num(row.tp1),
    tp2: num(row.tp2),
    tp3: num(row.tp3),
    entryHit: row.entry_hit === true,
    entryTime: nullableText(row.entry_time),
    entryPrice: nullableNum(row.entry_price_actual),
    exitTime: nullableText(row.exit_time ?? row.completed_at),
    exitPrice: nullableNum(row.exit_price),
    grossPnlPct: nullableNum(row.gross_pnl_pct),
    netPnlPct: nullableNum(row.net_pnl_pct),
    grossR: nullableNum(row.gross_r),
    netR: nullableNum(row.net_r ?? row.final_r),
    mfe: num(row.mfe),
    mae: num(row.mae),
    lastCheckedAt: nullableText(row.last_checked_at)
  };
}

function toDisplaySignal(signal: SignalEvaluation, id: string, createdAt: string): DisplaySignal {
  return { ...signal, id, createdAt };
}

function num(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNum(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function objectRecord(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record: Record<string, number | string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" || typeof item === "string") record[key] = item;
  }
  return record;
}

function noChasePrice(value: unknown) {
  const record = objectRecord(value);
  return num(record.noChasePrice);
}

function isNumberLike(value: unknown) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function direction(value: unknown): Direction {
  return value === "SHORT" ? "SHORT" : "LONG";
}

function signalType(value: unknown): SignalType {
  if (value === "volume_breakout" || value === "risk_anomaly" || value === "alt_basket_short") return value;
  return "trend_pullback";
}

function lifecycle(value: unknown): LifecycleStatus {
  const allowed: LifecycleStatus[] = [
    "detected",
    "watching",
    "setup_confirmed",
    "planned",
    "waiting_entry",
    "entered",
    "no_chase",
    "expired",
    "invalidated",
    "hit_tp1",
    "hit_tp2",
    "hit_tp3",
    "hit_sl",
    "archived"
  ];
  return allowed.includes(value as LifecycleStatus) ? (value as LifecycleStatus) : "detected";
}

function reviewStatus(value: unknown): ReviewFinalStatus {
  if (value === "open" || value === "hit_tp1" || value === "hit_tp2" || value === "hit_tp3" || value === "hit_sl") {
    return value;
  }
  return "waiting_entry";
}

function level(value: unknown): SignalLevel {
  if (value === "S" || value === "A" || value === "B" || value === "C") return value;
  return "NONE";
}

