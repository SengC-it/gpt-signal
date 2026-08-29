import { NextResponse } from "next/server";
import { fetchFuturesFundingRate, fetchFuturesKlines, configuredSymbols } from "@/lib/binance/client";
import { sendEmail } from "@/lib/notifications/mailer";
import { filterStrongAlertSignals, resolveStrongAlertIntervalMinutes, shouldRunStrongAlertWindow } from "@/lib/notifications/policy";
import { buildSignalEmail, buildSignalSummaryEmail } from "@/lib/notifications/templates";
import {
  ALT_BASKET_SHORT_CONFIG_V1,
  ALT_BASKET_SHORT_CONFIG_V2,
  ALT_BASKET_SHORT_OPPORTUNITY_ID_V1,
  ALT_BASKET_SHORT_OPPORTUNITY_ID_V2,
  evaluateAltBasketShortStrategy,
  expandAltBasketSignal
} from "@/lib/signal/alt-basket-strategy";
import { evaluateSignalCandidate } from "@/lib/signal/engine";
import { compareSignalConcentration } from "@/lib/signal/concentration-control";
import { canSendNotifications } from "@/lib/signal/delivery";
import { ALT_BASKET_DELIVERY_MODE } from "@/lib/signal/profitability-config";
import { DEFAULT_REVIEW_EXECUTION_POLICY } from "@/lib/signal/review";
import {
  ensureSignalReviewsForSentNotifications,
  ensureSignalReviewsForSignals,
  settleOpenSignalReviews
} from "@/lib/signal/review-repository";
import { resolveMainStrategyConfig, strategyParameters } from "@/lib/signal/strategy-config";
import type { Candle, DeliveryMode, SignalEvaluation } from "@/lib/signal/types";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase/server";

const SYNC_INTERVALS = ["15m", "1h", "4h"] as const;
const OPEN_LIFECYCLE_STATUSES = ["planned", "waiting_entry", "entered", "setup_confirmed"] as const;
const MAIN_STRATEGY_VERSION = process.env.MAIN_STRATEGY_VERSION?.trim() || "v2";
const SHADOW_MAIN_STRATEGY_VERSION = process.env.SHADOW_MAIN_STRATEGY_VERSION?.trim() || null;
const ALT_BASKET_STRATEGY_VERSION = process.env.ALT_BASKET_STRATEGY_VERSION === "v2" ? "v2" : "v1";
const SHADOW_ALT_BASKET_STRATEGY_VERSION = process.env.SHADOW_ALT_BASKET_STRATEGY_VERSION === "v2" ? "v2" : null;
const ALT_BASKET_CONFIG = ALT_BASKET_STRATEGY_VERSION === "v2" ? ALT_BASKET_SHORT_CONFIG_V2 : ALT_BASKET_SHORT_CONFIG_V1;
const ALT_BASKET_OPPORTUNITY_ID = ALT_BASKET_STRATEGY_VERSION === "v2"
  ? ALT_BASKET_SHORT_OPPORTUNITY_ID_V2
  : ALT_BASKET_SHORT_OPPORTUNITY_ID_V1;
const SHADOW_ALT_BASKET_OPPORTUNITY_ID = SHADOW_ALT_BASKET_STRATEGY_VERSION === "v2"
  ? ALT_BASKET_SHORT_OPPORTUNITY_ID_V2
  : ALT_BASKET_SHORT_OPPORTUNITY_ID_V1;

async function runSync(request: Request) {
  const secret = process.env.SIGNAL_SYNC_SECRET;
  if (secret) {
    const provided = request.headers.get("x-signal-sync-secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const symbols = Array.from(new Set(["BTCUSDT", ...configuredSymbols()]));
  const candleSets = new Map<string, Candle[]>();

  for (const symbol of symbols) {
    for (const interval of SYNC_INTERVALS) {
      const candles = await fetchFuturesKlines({ symbol, interval, limit: 120 });
      candleSets.set(candleKey(symbol, interval), candles);
    }
  }

  const btcCandles = closedCandles(candleSets.get(candleKey("BTCUSDT", "15m")) ?? []);
  const generated: SignalEvaluation[] = [];
  let persistedSignals = 0;
  let persistedNotifications = 0;
  let persistedCandles = 0;
  let strongAlerts = 0;
  const altBasketAlerts = 0;
  let sentEmails = 0;
  let failedEmails = 0;
  let persistedReviews = 0;
  let updatedReviews = 0;
  let settledReviews = 0;
  let reviewErrors = 0;
  const strongAlertIntervalMinutes = resolveStrongAlertIntervalMinutes(process.env.STRONG_ALERT_INTERVAL_MINUTES);
  const strongAlertEvaluationTime = btcCandles.at(-1)?.closeTime ?? Date.now();
  const strongAlertWindowOpen = shouldRunStrongAlertWindow(strongAlertEvaluationTime, strongAlertIntervalMinutes);
  const altSymbols = configuredSymbols().filter((symbol) => symbol !== "BTCUSDT");
  const fundingRates = await fetchFundingRates(altSymbols);

  for (const symbol of symbols.filter((item) => item !== "BTCUSDT")) {
    const candles = closedCandles(candleSets.get(candleKey(symbol, "15m")) ?? []);
    if (candles.length < 40 || btcCandles.length < 40) continue;

    const direction = candles.at(-1)!.close >= candles.at(-10)!.close ? "LONG" : "SHORT";
    const strategyVersions = [
      { version: MAIN_STRATEGY_VERSION, deliveryMode: "production" as const },
      ...(SHADOW_MAIN_STRATEGY_VERSION && SHADOW_MAIN_STRATEGY_VERSION !== MAIN_STRATEGY_VERSION
        ? [{ version: SHADOW_MAIN_STRATEGY_VERSION, deliveryMode: "shadow" as const }]
        : [])
    ];

    for (const strategy of strategyVersions) {
      const strategyConfig = resolveMainStrategyConfig(strategy.version);
      const evaluation = evaluateSignalCandidate({
        symbol,
        direction,
        signalType: "trend_pullback",
        candles15m: candles,
        btcCandles15m: btcCandles,
        btcCandles4h: closedCandles(candleSets.get(candleKey("BTCUSDT", "4h")) ?? []),
        strategyVersion: strategy.version,
        strategyConfig,
        now: Date.now(),
        fundingRate: null,
        oiChange15m: null,
        circuitBreakerActive: false
      });

      generated.push({
        ...evaluation,
        deliveryMode: strategy.deliveryMode,
        strategyFamily: "main",
        strategyParameters: strategyParameters(strategyConfig)
      });
    }
  }

  const altBasketInput = {
    btcCandles4h: closedCandles(candleSets.get(candleKey("BTCUSDT", "4h")) ?? []),
    basketCandles15m: Object.fromEntries(
      altSymbols.map((symbol) => [symbol, closedCandles(candleSets.get(candleKey(symbol, "15m")) ?? [])])
    ),
    fundingRates
  };
  const altBasketSignal = evaluateAltBasketShortStrategy({ ...altBasketInput, config: ALT_BASKET_CONFIG });
  const altBasketSignals = altBasketSignal
    ? expandAltBasketSignal({
      ...altBasketSignal,
      strategyVersion: ALT_BASKET_STRATEGY_VERSION,
      deliveryMode: ALT_BASKET_DELIVERY_MODE,
      strategyFamily: "alt_basket",
      strategyParameters: {
        family: "alt_basket",
        takeProfitPct: ALT_BASKET_CONFIG.takeProfitPct,
        stopLossPct: ALT_BASKET_CONFIG.stopLossPct,
        exitMode: "full_tp1",
        expiry: "none",
        sameCandlePriority: "stop"
      }
    })
    : [];
  generated.push(...altBasketSignals);
  const shadowAltBasketSignal = SHADOW_ALT_BASKET_STRATEGY_VERSION && SHADOW_ALT_BASKET_STRATEGY_VERSION !== ALT_BASKET_STRATEGY_VERSION
    ? evaluateAltBasketShortStrategy({
        ...altBasketInput,
        config: SHADOW_ALT_BASKET_STRATEGY_VERSION === "v2" ? ALT_BASKET_SHORT_CONFIG_V2 : ALT_BASKET_SHORT_CONFIG_V1
      })
    : null;
  const shadowAltBasketSignals = shadowAltBasketSignal
    ? expandAltBasketSignal({
      ...shadowAltBasketSignal,
      strategyVersion: SHADOW_ALT_BASKET_STRATEGY_VERSION!,
      deliveryMode: "shadow",
      strategyFamily: "alt_basket",
      strategyParameters: {
        family: "alt_basket",
        takeProfitPct: shadowAltBasketSignal.noChaseRule.takeProfitPct ?? 0,
        stopLossPct: shadowAltBasketSignal.noChaseRule.stopLossPct ?? 0,
        exitMode: "full_tp1",
        expiry: "none",
        sameCandlePriority: "stop"
      }
    })
    : [];
  generated.push(...shadowAltBasketSignals);

  const qualified = generated.filter((item) => item.signalType !== "alt_basket_short" && (item.level === "A" || item.level === "S"));
  const concentrationComparison = compareSignalConcentration(
    qualified
      .filter((signal) => signal.deliveryMode === "production" && signal.lifecycleStatus === "planned")
      .map((signal) => ({ signal, evidenceStatus: "UNPROVEN" }))
  );

  if (hasSupabaseServerEnv()) {
    const supabase = getSupabaseAdmin();
    await supabase.from("gpt_symbols").upsert(
      symbols.map((symbol) => ({
        symbol,
        status: "enabled",
        pool_type: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"].includes(symbol) ? "A" : "B",
        updated_at: new Date().toISOString()
      })),
      { onConflict: "symbol" }
    );

    const candleRows = Array.from(candleSets.values()).flat().map(candleToRow);
    if (candleRows.length > 0) {
      await supabase.from("gpt_candles").upsert(candleRows, {
        onConflict: "symbol,interval,open_time"
      });
      persistedCandles = candleRows.length;
    }

    const newSignalRecords: { id: string; signal: SignalEvaluation }[] = [];

    for (const signal of qualified) {
      const deliveryMode = signal.deliveryMode ?? "production";
      const strategyVersionId = await ensureStrategyVersion(supabase, signal);
      const opportunityId = [
        signal.symbol,
        signal.direction,
        signal.signalType,
        signal.marketRegime,
        signal.strategyVersion ?? MAIN_STRATEGY_VERSION,
        "15m"
      ].join(":");
      await supabase.from("gpt_opportunities").upsert({
        id: opportunityId,
        symbol: signal.symbol,
        direction: signal.direction,
        opportunity_type: signal.signalType,
        structure_id: signal.marketRegime,
        lifecycle_status: signal.lifecycleStatus,
        current_score: signal.score,
        current_level: signal.level,
        last_updated_at: new Date().toISOString()
      });

      const { data: existingSignal } = await supabase
        .from("gpt_signals")
        .select("id, level, lifecycle_status")
        .eq("opportunity_id", opportunityId)
        .eq("delivery_mode", deliveryMode)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        existingSignal &&
        existingSignal.level === signal.level &&
        existingSignal.lifecycle_status === signal.lifecycleStatus
      ) {
        continue;
      }

      const { data } = await supabase
        .from("gpt_signals")
        .insert({
          opportunity_id: opportunityId,
          strategy_version_id: strategyVersionId,
          strategy_version: signal.strategyVersion ?? MAIN_STRATEGY_VERSION,
          delivery_mode: deliveryMode,
          symbol: signal.symbol,
          direction: signal.direction,
          signal_type: signal.signalType,
          lifecycle_status: signal.lifecycleStatus,
          level: signal.level,
          score: signal.score,
          entry_mode: signal.plan?.entryMode ?? "confirmation_wait",
          entry_low: signal.plan?.entryLow ?? null,
          entry_high: signal.plan?.entryHigh ?? null,
          stop_loss: signal.plan?.stopLoss ?? null,
          tp1: signal.plan?.tp1 ?? null,
          tp2: signal.plan?.tp2 ?? null,
          tp3: signal.plan?.tp3 ?? null,
          theoretical_rr: signal.plan?.theoreticalRr ?? null,
          weighted_rr: signal.plan?.weightedRr ?? null,
          cost_adjusted_rr: signal.plan?.costAdjustedRr ?? null,
          gross_tp1_return_pct: signal.costEdge?.grossTp1ReturnPct ?? null,
          estimated_round_trip_cost_pct: signal.costEdge?.estimatedRoundTripCostPct ?? null,
          estimated_net_tp1_return_pct: signal.costEdge?.estimatedNetTp1ReturnPct ?? null,
          cost_coverage_ratio: signal.costEdge?.costCoverageRatio ?? null,
          sl_distance_pct: signal.plan?.slDistancePct ?? null,
          sl_atr_ratio: signal.plan?.slAtrRatio ?? null,
          btc_state: signal.btcState,
          market_regime: signal.marketRegime,
          relative_strength_score: signal.relativeStrengthScore,
          data_quality_score: signal.dataQualityScore,
          reasons: signal.reasons,
          invalidation_rules: signal.invalidationRules,
          no_chase_rule: {
            ...signal.noChaseRule,
            strategyVersion: signal.strategyVersion ?? MAIN_STRATEGY_VERSION,
            deliveryMode,
            executionPolicy: DEFAULT_REVIEW_EXECUTION_POLICY
          }
        })
        .select("id")
        .single();

      if (data?.id) {
        persistedSignals += 1;
        if (!canSendNotifications(deliveryMode)) {
          try {
            persistedReviews += await ensureSignalReviewsForSignals(supabase, [data.id]);
          } catch {
            reviewErrors += 1;
          }
        } else {
          newSignalRecords.push({ id: data.id, signal });
        }
      }
    }

    if (altBasketSignals.length > 0 && !await findOpenAltBasketSignal(supabase, ALT_BASKET_DELIVERY_MODE, ALT_BASKET_STRATEGY_VERSION)) {
      const records = await persistAltBasketSignals(
        supabase,
        altBasketSignals,
        ALT_BASKET_OPPORTUNITY_ID,
        ALT_BASKET_STRATEGY_VERSION,
        ALT_BASKET_DELIVERY_MODE
      );
      const signalIds = records.map((record) => record.id);
      persistedSignals += signalIds.length;
      try {
        persistedReviews += await ensureSignalReviewsForSignals(supabase, signalIds);
      } catch {
        reviewErrors += 1;
      }
    }

    if (shadowAltBasketSignals.length > 0 && !await findOpenAltBasketSignal(supabase, "shadow", SHADOW_ALT_BASKET_STRATEGY_VERSION!)) {
      const records = await persistAltBasketSignals(
        supabase,
        shadowAltBasketSignals,
        SHADOW_ALT_BASKET_OPPORTUNITY_ID,
        SHADOW_ALT_BASKET_STRATEGY_VERSION!,
        "shadow"
      );
      const signalIds = records.map((record) => record.id);
      persistedSignals += signalIds.length;
      try {
        persistedReviews += await ensureSignalReviewsForSignals(supabase, signalIds);
      } catch {
        reviewErrors += 1;
      }
    }

    const strongAlertSignals = strongAlertWindowOpen ? filterStrongAlertSignals(newSignalRecords.map((record) => record.signal)) : [];
    strongAlerts = strongAlertSignals.length;

    if (strongAlertSignals.length > 0) {
      const email = buildSignalSummaryEmail(strongAlertSignals);
      const { data: notifications } = await supabase
        .from("gpt_notifications")
        .insert(
          newSignalRecords
            .filter((record) => strongAlertSignals.includes(record.signal))
            .map((record) => ({
              signal_id: record.id,
              channel: "email",
              subject: email.subject,
              body: buildSignalEmail(record.signal).body,
              recipient: process.env.NOTIFICATION_EMAIL_TO ?? null,
              status: "queued"
            }))
        )
        .select("id");
      const strongAlertNotificationIds = notifications?.map((notification) => notification.id) ?? [];
      persistedNotifications += strongAlertNotificationIds.length;

      const sendResult = await sendEmail({
        to: process.env.NOTIFICATION_EMAIL_TO,
        subject: email.subject,
        body: email.body
      });

      if (strongAlertNotificationIds.length > 0 && sendResult.status !== "skipped") {
        await supabase
          .from("gpt_notifications")
          .update({
            status: sendResult.status === "sent" ? "sent" : "failed",
            sent_at: sendResult.status === "sent" ? new Date().toISOString() : null,
            error_message: sendResult.status === "failed" ? sendResult.error : null
          })
          .in("id", strongAlertNotificationIds);
      }

      if (sendResult.status === "sent") sentEmails = 1;
      if (sendResult.status === "failed") failedEmails = 1;
      if (sendResult.status === "sent") {
        try {
          persistedReviews += await ensureSignalReviewsForSentNotifications(supabase, strongAlertNotificationIds);
        } catch {
          reviewErrors += 1;
        }
      }
    }

    try {
      const reviewResult = await settleOpenSignalReviews(supabase);
      updatedReviews = reviewResult.updated;
      settledReviews = reviewResult.settled;
    } catch {
      reviewErrors += 1;
    }

    await supabase.from("gpt_system_events").insert({
      event_type: "market_sync",
      severity: "info",
      message: "Market sync completed",
      metadata: {
        symbols: symbols.length,
        candles: candleRows.length,
        generated: generated.length,
        qualified: qualified.length,
        strongAlerts,
        altBasketAlerts,
        strongAlertIntervalMinutes,
        strongAlertWindowOpen,
        persistedSignals,
        persistedNotifications,
        persistedReviews,
        updatedReviews,
        settledReviews,
        reviewErrors,
        sentEmails,
        failedEmails,
        concentrationComparison: {
          mode: concentrationComparison.mode,
          productionChanged: concentrationComparison.productionChanged,
          selected: concentrationComparison.selected.map(({ signal }) => signal.symbol),
          suppressed: concentrationComparison.suppressed.map(({ signal }) => signal.symbol)
        }
      }
    });
  }

  return NextResponse.json({
    ok: true,
    generated: generated.length,
    qualified: qualified.length,
    strongAlerts,
    altBasketAlerts,
    persisted: hasSupabaseServerEnv(),
    persistedCandles,
    persistedSignals,
    persistedNotifications,
    persistedReviews,
    updatedReviews,
    settledReviews,
    reviewErrors,
    sentEmails,
    failedEmails,
    strongAlertIntervalMinutes,
    strongAlertWindowOpen,
    concentrationComparison: {
      mode: concentrationComparison.mode,
      productionChanged: concentrationComparison.productionChanged,
      selected: concentrationComparison.selected.map(({ signal }) => signal.symbol),
      suppressed: concentrationComparison.suppressed.map(({ signal }) => signal.symbol)
    },
    signals: generated.map((item) => ({
      symbol: item.symbol,
      level: item.level,
      score: item.score,
      status: item.lifecycleStatus,
      deliveryMode: item.deliveryMode,
      costEdge: item.costEdge
    }))
  });
}

export async function POST(request: Request) {
  try {
    return await runSync(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown market sync error";
    if (hasSupabaseServerEnv()) {
      try {
        await getSupabaseAdmin().from("gpt_system_events").insert({
          event_type: "market_sync_error",
          severity: "error",
          message: "Market sync failed",
          metadata: { error: message }
        });
      } catch {
        // Preserve the original sync error when health-event persistence also fails.
      }
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Use POST to run market sync.",
    supabaseConfigured: hasSupabaseServerEnv()
  });
}

function candleKey(symbol: string, interval: string) {
  return `${symbol}:${interval}`;
}

function closedCandles(candles: Candle[]) {
  return candles.filter((item) => item.isClosed);
}

function candleToRow(candle: Candle) {
  return {
    symbol: candle.symbol,
    interval: candle.interval,
    open_time: new Date(candle.openTime).toISOString(),
    close_time: new Date(candle.closeTime).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    quote_volume: candle.quoteVolume,
    trades: candle.trades,
    taker_buy_volume: candle.takerBuyVolume,
    taker_buy_quote_volume: candle.takerBuyQuoteVolume,
    is_closed: candle.isClosed,
    data_quality_score: candle.isClosed ? 100 : 70
  };
}

async function ensureStrategyVersion(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  signal: SignalEvaluation
) {
  const family = signal.strategyFamily ?? (signal.signalType === "alt_basket_short" ? "alt_basket" : "main");
  const version = signal.strategyVersion ?? (family === "main" ? MAIN_STRATEGY_VERSION : ALT_BASKET_STRATEGY_VERSION);
  const name = family === "main" ? "GPT Signal Main" : "GPT Signal Alt Basket";
  const parameters = signal.strategyParameters ?? {
    family,
    exitMode: "full_tp1",
    expiry: "none",
    sameCandlePriority: "stop"
  };
  const { data, error } = await supabase
    .from("gpt_strategy_versions")
    .upsert({
      name,
      version,
      parameters,
      enabled: true,
      notes: signal.deliveryMode === "shadow" ? "Shadow validation candidate; never notify." : "Runtime production strategy."
    }, { onConflict: "name,version" })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

async function persistAltBasketSignals(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  signals: SignalEvaluation[],
  baseOpportunityId: string,
  strategyVersion: string,
  deliveryMode: DeliveryMode
) {
  if (signals.length === 0) return [];
  const strategyVersionId = await ensureStrategyVersion(supabase, signals[0]);
  const records: Array<{ id: string; signal: SignalEvaluation }> = [];
  const createdAt = new Date().toISOString();

  for (const signal of signals) {
    const opportunityId = `${baseOpportunityId}:${signal.symbol}${deliveryMode === "shadow" ? ":shadow" : ""}`;
    const { error: opportunityError } = await supabase.from("gpt_opportunities").upsert({
      id: opportunityId,
      symbol: signal.symbol,
      direction: signal.direction,
      opportunity_type: signal.signalType,
      structure_id: signal.marketRegime,
      lifecycle_status: signal.lifecycleStatus,
      current_score: signal.score,
      current_level: signal.level,
      last_updated_at: new Date().toISOString()
    });
    if (opportunityError) throw opportunityError;

    const { data, error } = await supabase.from("gpt_signals").insert({
      opportunity_id: opportunityId,
      strategy_version_id: strategyVersionId,
      strategy_version: strategyVersion,
      delivery_mode: deliveryMode,
      symbol: signal.symbol,
      direction: signal.direction,
      signal_type: signal.signalType,
      lifecycle_status: signal.lifecycleStatus,
      level: signal.level,
      score: signal.score,
      entry_mode: signal.plan?.entryMode ?? "confirmation_wait",
      entry_low: signal.plan?.entryLow ?? null,
      entry_high: signal.plan?.entryHigh ?? null,
      stop_loss: signal.plan?.stopLoss ?? null,
      tp1: signal.plan?.tp1 ?? null,
      tp2: signal.plan?.tp2 ?? null,
      tp3: signal.plan?.tp3 ?? null,
      theoretical_rr: signal.plan?.theoreticalRr ?? null,
      weighted_rr: signal.plan?.weightedRr ?? null,
      cost_adjusted_rr: signal.plan?.costAdjustedRr ?? null,
      gross_tp1_return_pct: signal.costEdge?.grossTp1ReturnPct ?? null,
      estimated_round_trip_cost_pct: signal.costEdge?.estimatedRoundTripCostPct ?? null,
      estimated_net_tp1_return_pct: signal.costEdge?.estimatedNetTp1ReturnPct ?? null,
      cost_coverage_ratio: signal.costEdge?.costCoverageRatio ?? null,
      sl_distance_pct: signal.plan?.slDistancePct ?? null,
      sl_atr_ratio: signal.plan?.slAtrRatio ?? null,
      btc_state: signal.btcState,
      market_regime: signal.marketRegime,
      relative_strength_score: signal.relativeStrengthScore,
      data_quality_score: signal.dataQualityScore,
      reasons: signal.reasons,
      invalidation_rules: signal.invalidationRules,
      created_at: createdAt,
      updated_at: createdAt,
      no_chase_rule: {
        ...signal.noChaseRule,
        strategyVersion,
        deliveryMode,
        executionPolicy: DEFAULT_REVIEW_EXECUTION_POLICY
      }
    }).select("id").single();
    if (error) throw error;
    if (data?.id) records.push({ id: data.id, signal });
  }

  return records;
}

async function fetchFundingRates(symbols: string[]) {
  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return [symbol, await fetchFuturesFundingRate(symbol)] as const;
      } catch {
        return [symbol, null] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

async function findOpenAltBasketSignal(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  deliveryMode: DeliveryMode,
  strategyVersion: string
) {
  const { data } = await supabase
    .from("gpt_signals")
    .select("id, lifecycle_status, created_at")
    .eq("signal_type", "alt_basket_short")
    .eq("delivery_mode", deliveryMode)
    .eq("strategy_version", strategyVersion)
    .in("lifecycle_status", [...OPEN_LIFECYCLE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}
