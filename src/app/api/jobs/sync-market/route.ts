import { NextResponse } from "next/server";
import { fetchFuturesKlines, configuredSymbols } from "@/lib/binance/client";
import { buildSignalEmail } from "@/lib/notifications/templates";
import { evaluateSignalCandidate } from "@/lib/signal/engine";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const secret = process.env.SIGNAL_SYNC_SECRET;
  if (secret) {
    const provided = request.headers.get("x-signal-sync-secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const symbols = configuredSymbols();
  const btcCandles = await fetchFuturesKlines({ symbol: "BTCUSDT", interval: "15m", limit: 80 });
  const generated = [];

  for (const symbol of symbols.filter((item) => item !== "BTCUSDT")) {
    const candles = await fetchFuturesKlines({ symbol, interval: "15m", limit: 80 });
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
    for (const signal of qualified) {
      const opportunityId = [
        signal.symbol,
        signal.direction,
        signal.signalType,
        signal.marketRegime,
        "15m"
      ].join(":");
      await supabase.from("opportunities").upsert({
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
      const { data } = await supabase
        .from("signals")
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
        const email = buildSignalEmail(signal);
        await supabase.from("notifications").insert({
          signal_id: data.id,
          channel: "email",
          subject: email.subject,
          body: email.body,
          recipient: process.env.NOTIFICATION_EMAIL_TO ?? null,
          status: "queued"
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    generated: generated.length,
    qualified: qualified.length,
    persisted: hasSupabaseServerEnv(),
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

