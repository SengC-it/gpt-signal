import { NextResponse } from "next/server";
import { fetchFuturesKlines, configuredSymbols } from "@/lib/binance/client";
import { buildSignalEmail } from "@/lib/notifications/templates";
import { evaluateSignalCandidate } from "@/lib/signal/engine";
import type { Candle } from "@/lib/signal/types";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase/server";

const SYNC_INTERVALS = ["15m", "1h", "4h"] as const;

export async function POST(request: Request) {
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
  const generated = [];
  let persistedSignals = 0;
  let persistedNotifications = 0;
  let persistedCandles = 0;

  for (const symbol of symbols.filter((item) => item !== "BTCUSDT")) {
    const candles = closedCandles(candleSets.get(candleKey(symbol, "15m")) ?? []);
    if (candles.length < 40 || btcCandles.length < 40) continue;

    const direction = candles.at(-1)!.close >= candles.at(-10)!.close ? "LONG" : "SHORT";
    const evaluation = evaluateSignalCandidate({
      symbol,
      direction,
      signalType: "trend_pullback",
      candles15m: candles,
      btcCandles15m: btcCandles,
      now: Date.now(),
      fundingRate: null,
      oiChange15m: null,
      circuitBreakerActive: false
    });

    generated.push(evaluation);
  }

  const qualified = generated.filter((item) => item.level === "A" || item.level === "S");

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

    for (const signal of qualified) {
      const opportunityId = [
        signal.symbol,
        signal.direction,
        signal.signalType,
        signal.marketRegime,
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
          sl_distance_pct: signal.plan?.slDistancePct ?? null,
          sl_atr_ratio: signal.plan?.slAtrRatio ?? null,
          btc_state: signal.btcState,
          market_regime: signal.marketRegime,
          relative_strength_score: signal.relativeStrengthScore,
          data_quality_score: signal.dataQualityScore,
          reasons: signal.reasons,
          invalidation_rules: signal.invalidationRules,
          no_chase_rule: signal.noChaseRule
        })
        .select("id")
        .single();

      if (data?.id) {
        persistedSignals += 1;
        const email = buildSignalEmail(signal);
        await supabase.from("gpt_notifications").insert({
          signal_id: data.id,
          channel: "email",
          subject: email.subject,
          body: email.body,
          recipient: process.env.NOTIFICATION_EMAIL_TO ?? null,
          status: "queued"
        });
        persistedNotifications += 1;
      }
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
        persistedSignals,
        persistedNotifications
      }
    });
  }

  return NextResponse.json({
    ok: true,
    generated: generated.length,
    qualified: qualified.length,
    persisted: hasSupabaseServerEnv(),
    persistedCandles,
    persistedSignals,
    persistedNotifications,
    signals: generated.map((item) => ({
      symbol: item.symbol,
      level: item.level,
      score: item.score,
      status: item.lifecycleStatus
    }))
  });
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
