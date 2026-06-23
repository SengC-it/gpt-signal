import { NextResponse } from "next/server";
import { runBacktest } from "@/lib/signal/backtest";
import { sampleSignals } from "@/lib/sample-data";
import { getSupabaseAdmin, hasSupabaseServerEnv } from "@/lib/supabase/server";

export async function POST() {
  const runnableSignals = sampleSignals.filter((item) => item.plan);
  const result = runBacktest(
    runnableSignals.map((item) => ({
      direction: item.direction,
      plan: item.plan!,
      futureCandles: [
        {
          symbol: item.symbol,
          interval: "15m",
          openTime: Date.now(),
          closeTime: Date.now() + 899_999,
          open: item.plan!.entryHigh,
          high: item.plan!.tp1,
          low: item.plan!.entryLow,
          close: item.plan!.tp1,
          volume: 100,
          quoteVolume: 10000,
          trades: 100,
          takerBuyVolume: 50,
          takerBuyQuoteVolume: 5000,
          isClosed: true
        }
      ]
    }))
  );

  if (hasSupabaseServerEnv()) {
    const supabase = getSupabaseAdmin();
    await supabase.from("gpt_backtest_runs").insert({
      symbols: runnableSignals.map((item) => item.symbol),
      cost_model: { feeRate: 0.001, slippageRate: 0.0005 },
      result_summary: result
    });
  }

  return NextResponse.json({ ok: true, persisted: hasSupabaseServerEnv(), result });
}

