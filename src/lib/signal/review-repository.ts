import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  applyReviewCandles,
  createInitialReviewState,
  DEFAULT_REVIEW_EXECUTION_POLICY,
  isSettledReviewStatus,
  LEGACY_REVIEW_EXECUTION_POLICY,
  type ReviewExecutionPolicy,
  type ReviewCandle,
  type ReviewFinalStatus,
  type SignalReviewState
} from "@/lib/signal/review";
import type { Direction, TradingPlan } from "@/lib/signal/types";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

type SignalRow = {
  id: string;
  symbol: string;
  direction: string;
  entry_low: number | string | null;
  entry_high: number | string | null;
  stop_loss: number | string | null;
  tp1: number | string | null;
  tp2: number | string | null;
  tp3: number | string | null;
  no_chase_rule: unknown;
  strategy_version_id?: string | null;
  strategy_version?: string | null;
  signal_type?: string | null;
  delivery_mode?: string | null;
};

type ReviewRow = {
  id: string;
  signal_id: string;
  symbol: string | null;
  direction: string | null;
  entry_low: number | string | null;
  entry_high: number | string | null;
  stop_loss: number | string | null;
  tp1: number | string | null;
  tp2: number | string | null;
  tp3: number | string | null;
  execution_context: unknown;
  signal_sent_at: string | null;
  entry_hit: boolean | null;
  entry_time: string | null;
  entry_price_actual: number | string | null;
  mfe: number | string | null;
  mae: number | string | null;
  final_status: string | null;
  final_r: number | string | null;
  gross_r: number | string | null;
  net_r: number | string | null;
  gross_pnl_pct: number | string | null;
  net_pnl_pct: number | string | null;
  exit_price: number | string | null;
  exit_time: string | null;
  completed_at: string | null;
  last_checked_at: string | null;
  strategy_version: string | null;
  strategy_family: string | null;
  delivery_mode: string | null;
};

type SentNotificationRow = {
  id: string;
  signal_id: string | null;
  sent_at: string | null;
  created_at: string;
  status: string;
};

export async function ensureSignalReviewsForSentNotifications(
  supabase: SupabaseAdmin,
  notificationIds: string[]
) {
  if (notificationIds.length === 0) return 0;

  const { data: notifications, error: notificationError } = await supabase
    .from("gpt_notifications")
    .select("id, signal_id, sent_at, created_at, status")
    .in("id", notificationIds)
    .eq("status", "sent");

  if (notificationError) throw notificationError;

  const sentRows = (notifications ?? []) as SentNotificationRow[];
  const signalIds = Array.from(new Set(sentRows.map((row) => row.signal_id).filter(Boolean))) as string[];
  if (signalIds.length === 0) return 0;

  const { data: signals, error: signalError } = await supabase
    .from("gpt_signals")
    .select("id, symbol, direction, entry_low, entry_high, stop_loss, tp1, tp2, tp3, no_chase_rule, strategy_version_id, strategy_version, signal_type, delivery_mode")
    .in("id", signalIds);

  if (signalError) throw signalError;

  const sentAtBySignal = new Map<string, string>();
  for (const row of sentRows) {
    if (!row.signal_id || sentAtBySignal.has(row.signal_id)) continue;
    sentAtBySignal.set(row.signal_id, row.sent_at ?? row.created_at);
  }

  const reviewRows = buildReviewRows(
    (signals ?? []) as SignalRow[],
    (signal) => sentAtBySignal.get(signal.id) ?? new Date().toISOString()
  );

  if (reviewRows.length === 0) return 0;

  const { data, error } = await supabase
    .from("gpt_signal_results")
    .upsert(reviewRows, { onConflict: "signal_id", ignoreDuplicates: true })
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

export async function ensureSignalReviewsForSignals(
  supabase: SupabaseAdmin,
  signalIds: string[],
  signalTime = new Date().toISOString()
) {
  const ids = Array.from(new Set(signalIds.filter(Boolean)));
  if (ids.length === 0) return 0;

  const { data: signals, error } = await supabase
    .from("gpt_signals")
    .select("id, symbol, direction, entry_low, entry_high, stop_loss, tp1, tp2, tp3, no_chase_rule, strategy_version_id, strategy_version, signal_type, delivery_mode")
    .in("id", ids);

  if (error) throw error;
  const reviewRows = buildReviewRows((signals ?? []) as SignalRow[], () => signalTime);
  if (reviewRows.length === 0) return 0;

  const { data, error: upsertError } = await supabase
    .from("gpt_signal_results")
    .upsert(reviewRows, { onConflict: "signal_id", ignoreDuplicates: true })
    .select("id");

  if (upsertError) throw upsertError;
  return data?.length ?? 0;
}

export async function settleOpenSignalReviews(supabase: SupabaseAdmin) {
  const { data, error } = await supabase
    .from("gpt_signal_results")
    .select("*")
    .is("completed_at", null)
    .order("signal_sent_at", { ascending: true })
    .limit(1000);

  if (error) throw error;

  const reviews = (data ?? []) as ReviewRow[];
  if (reviews.length === 0) return { updated: 0, settled: 0 };

  const candleSymbols = new Set<string>();
  for (const review of reviews) {
    if (!review.symbol || !hasPlan(review)) continue;
    const basket = basketComponents(review.execution_context);
    if (basket.length > 0) {
      for (const component of basket) candleSymbols.add(component.symbol);
    } else {
      candleSymbols.add(review.symbol);
    }
  }

  const earliestCursor = Math.min(
    ...reviews.map((review) => dateValue(review.last_checked_at) ?? dateValue(review.signal_sent_at) ?? 0)
  );
  const candlesBySymbol = new Map<string, ReviewCandle[]>();
  for (const symbol of candleSymbols) {
    const { data: candleRows, error: candleError } = await supabase
      .from("gpt_candles")
      .select("open_time, close_time, high, low, is_closed")
      .eq("symbol", symbol)
      .eq("interval", "15m")
      .eq("is_closed", true)
      .gt("close_time", new Date(earliestCursor).toISOString())
      .order("close_time", { ascending: true })
      .limit(10000);

    if (candleError) throw candleError;
    candlesBySymbol.set(
      symbol,
      ((candleRows ?? []) as Array<Record<string, unknown>>).map(toReviewCandle)
    );
  }

  let updated = 0;
  let settled = 0;

  for (const review of reviews) {
    if (!review.symbol || !hasPlan(review)) continue;
    const before = stateFromRow(review);
    const cursor = before.lastCheckedAt ?? dateValue(review.signal_sent_at) ?? 0;
    const state = applyReviewCandles({
      direction: directionValue(review.direction),
      plan: planFromRow(review),
      candles: reviewCandles(review, candlesBySymbol).filter((candle) => candle.closeTime > cursor),
      state: before,
      executionPolicy: policyFromContext(review.execution_context),
      candlesAreSorted: true
    });

    if (!hasProgress(before, state)) continue;

    const { error: updateError } = await supabase
      .from("gpt_signal_results")
      .update(rowFromState(state))
      .eq("id", review.id);

    if (updateError) throw updateError;

    const { error: signalUpdateError } = await supabase
      .from("gpt_signals")
      .update({
        lifecycle_status: lifecycleStatus(state.finalStatus),
        updated_at: new Date().toISOString()
      })
      .eq("id", review.signal_id);

    if (signalUpdateError) throw signalUpdateError;
    updated += 1;
    if (!isSettledReviewStatus(before.finalStatus) && isSettledReviewStatus(state.finalStatus)) settled += 1;
  }

  return { updated, settled };
}

function buildReviewRows(signals: SignalRow[], signalTime: (signal: SignalRow) => string) {
  return signals
    .filter((signal) => hasPlan(signal))
    .map((signal) => ({
      signal_id: signal.id,
      strategy_version: signal.strategy_version ?? null,
      strategy_family: signal.signal_type === "alt_basket_short" ? "alt_basket" : "main",
      delivery_mode: signal.delivery_mode === "shadow" ? "shadow" : "production",
      symbol: signal.symbol,
      direction: signal.direction,
      entry_low: numberValue(signal.entry_low),
      entry_high: numberValue(signal.entry_high),
      stop_loss: numberValue(signal.stop_loss),
      tp1: numberValue(signal.tp1),
      tp2: numberValue(signal.tp2),
      tp3: numberValue(signal.tp3),
      execution_context: executionContext(signal),
      signal_sent_at: signalTime(signal),
      entry_hit: false,
      final_status: "waiting_entry",
      completed_at: null
    }));
}

function executionContext(signal: SignalRow) {
  const base = signal.no_chase_rule && typeof signal.no_chase_rule === "object" && !Array.isArray(signal.no_chase_rule)
    ? signal.no_chase_rule as Record<string, unknown>
    : {};
  return {
    ...base,
    strategyVersionId: signal.strategy_version_id ?? null,
    deliveryMode: signal.delivery_mode === "shadow" ? "shadow" : "production",
    executionPolicy: DEFAULT_REVIEW_EXECUTION_POLICY
  };
}

function policyFromContext(value: unknown): ReviewExecutionPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return LEGACY_REVIEW_EXECUTION_POLICY;
  const executionPolicy = (value as Record<string, unknown>).executionPolicy;
  if (!executionPolicy || typeof executionPolicy !== "object" || Array.isArray(executionPolicy)) {
    return LEGACY_REVIEW_EXECUTION_POLICY;
  }
  const exitMode = (executionPolicy as Record<string, unknown>).exitMode;
  return {
    ...DEFAULT_REVIEW_EXECUTION_POLICY,
    exitMode: exitMode === "legacy_furthest_tp" ? "legacy_furthest_tp" : "full_tp1"
  };
}

function stateFromRow(row: ReviewRow): SignalReviewState {
  const initial = createInitialReviewState();
  const status = reviewStatus(row.final_status);
  return {
    ...initial,
    entryHit: Boolean(row.entry_hit),
    entryTime: dateValue(row.entry_time),
    entryPrice: numberOrNull(row.entry_price_actual),
    finalStatus: status,
    exitTime: dateValue(row.exit_time ?? row.completed_at),
    exitPrice: numberOrNull(row.exit_price),
    grossR: numberOrNull(row.gross_r),
    netR: numberOrNull(row.net_r ?? row.final_r),
    grossPnlPct: numberOrNull(row.gross_pnl_pct),
    netPnlPct: numberOrNull(row.net_pnl_pct),
    mfe: numberValue(row.mfe),
    mae: numberValue(row.mae),
    lastCheckedAt: dateValue(row.last_checked_at)
  };
}

function rowFromState(state: SignalReviewState) {
  return {
    entry_hit: state.entryHit,
    entry_time: iso(state.entryTime),
    entry_price_actual: state.entryPrice,
    mfe: state.mfe,
    mae: state.mae,
    final_status: state.finalStatus,
    final_r: state.netR,
    gross_r: state.grossR,
    net_r: state.netR,
    gross_pnl_pct: state.grossPnlPct,
    net_pnl_pct: state.netPnlPct,
    exit_price: state.exitPrice,
    exit_time: iso(state.exitTime),
    completed_at: isSettledReviewStatus(state.finalStatus) ? iso(state.exitTime) : null,
    last_checked_at: iso(state.lastCheckedAt),
    updated_at: new Date().toISOString()
  };
}

function planFromRow(row: ReviewRow): TradingPlan {
  return {
    entryMode: "confirmation_wait",
    entryLow: numberValue(row.entry_low),
    entryHigh: numberValue(row.entry_high),
    stopLoss: numberValue(row.stop_loss),
    tp1: numberValue(row.tp1),
    tp2: numberValue(row.tp2),
    tp3: numberValue(row.tp3),
    theoreticalRr: 0,
    weightedRr: 0,
    costAdjustedRr: 0,
    slDistancePct: 0,
    slAtrRatio: 0,
    noChasePrice: 0
  };
}

function toReviewCandle(row: Record<string, unknown>): ReviewCandle {
  return {
    openTime: dateValue(row.open_time) ?? 0,
    closeTime: dateValue(row.close_time) ?? 0,
    high: numberValue(row.high),
    low: numberValue(row.low),
    isClosed: row.is_closed === true
  };
}

function reviewCandles(review: ReviewRow, candlesBySymbol: Map<string, ReviewCandle[]>) {
  const basket = basketComponents(review.execution_context);
  if (basket.length === 0 || review.symbol !== "ALT_SHORT_BASKET") {
    return candlesBySymbol.get(review.symbol ?? "") ?? [];
  }

  const candlesByClose = new Map<number, Map<string, ReviewCandle>>();
  for (const component of basket) {
    for (const candle of candlesBySymbol.get(component.symbol) ?? []) {
      const bySymbol = candlesByClose.get(candle.closeTime) ?? new Map<string, ReviewCandle>();
      bySymbol.set(component.symbol, candle);
      candlesByClose.set(candle.closeTime, bySymbol);
    }
  }

  return [...candlesByClose.entries()]
    .filter(([, bySymbol]) => basket.every((component) => bySymbol.has(component.symbol)))
    .map(([closeTime, bySymbol]) => {
      const componentCandles = basket.map((component) => ({
        component,
        candle: bySymbol.get(component.symbol)!
      }));
      return {
        openTime: Math.min(...componentCandles.map(({ candle }) => candle.openTime)),
        closeTime,
        high: average(componentCandles.map(({ component, candle }) => (candle.high / component.entryPrice) * 100)),
        low: average(componentCandles.map(({ component, candle }) => (candle.low / component.entryPrice) * 100)),
        isClosed: true
      };
    })
    .sort((a, b) => a.closeTime - b.closeTime);
}

function basketComponents(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const context = value as Record<string, unknown>;
  const symbols = String(context.basketSymbols ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const entries = String(context.entryPrices ?? "")
    .split(",")
    .map((item) => item.split(":"))
    .map(([symbol, price]) => [symbol?.trim().toUpperCase(), Number(price)] as const)
    .filter(([symbol, price]) => Boolean(symbol) && Number.isFinite(price) && price > 0);
  const prices = new Map(entries);

  return symbols
    .map((symbol) => ({ symbol, entryPrice: prices.get(symbol) ?? 0 }))
    .filter((item) => item.entryPrice > 0);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function hasPlan(row: {
  entry_low: number | string | null;
  entry_high: number | string | null;
  stop_loss: number | string | null;
  tp1: number | string | null;
  tp2: number | string | null;
  tp3: number | string | null;
}) {
  return [row.entry_low, row.entry_high, row.stop_loss, row.tp1, row.tp2, row.tp3].every((value) => value !== null && Number.isFinite(Number(value)));
}

function directionValue(value: unknown): Direction {
  return value === "SHORT" ? "SHORT" : "LONG";
}

function reviewStatus(value: unknown): ReviewFinalStatus {
  if (value === "open" || value === "hit_tp1" || value === "hit_tp2" || value === "hit_tp3" || value === "hit_sl") {
    return value;
  }
  return "waiting_entry";
}

function hasProgress(before: SignalReviewState, after: SignalReviewState) {
  return before.lastCheckedAt !== after.lastCheckedAt
    || before.entryHit !== after.entryHit
    || before.finalStatus !== after.finalStatus
    || before.exitTime !== after.exitTime;
}

function lifecycleStatus(status: ReviewFinalStatus) {
  if (status === "open") return "entered";
  return status;
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function numberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function dateValue(value: unknown) {
  if (!value) return null;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function iso(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}
