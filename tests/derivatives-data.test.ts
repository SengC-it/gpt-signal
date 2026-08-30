import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  DERIVATIVES_ENDPOINT_AUDIT,
  DERIVATIVES_PUBLIC_ENDPOINTS,
  buildDerivativesMetric,
  classifyPriceOiState,
  closedMetricTime,
  collectDerivativesMetrics,
  selectPointInTime,
  type CollectionInput
} from "@/lib/binance/derivatives";
import { forwardLiquidationCollectorStatus, parseForwardLiquidationEvent } from "@/lib/binance/liquidation-forward";
import {
  buildDerivativeAblation,
  selectDerivativeMetricAsOf,
  type DerivativesResearchEvent,
  type DerivativesResearchMetric
} from "@/lib/signal/derivatives-research";
import { PRODUCTION_SIGNAL_STRATEGIES } from "@/lib/signal/profitability-config";

describe("GPT-PROFIT-004 public derivatives foundation", () => {
  test("collector allow-list contains public market data only", () => {
    expect(Object.keys(DERIVATIVES_PUBLIC_ENDPOINTS)).toEqual([
      "openInterest",
      "openInterestHistory",
      "premiumIndex",
      "fundingHistory",
      "basis",
      "takerFlow",
      "globalLongShort",
      "topTraderAccount",
      "topTraderPosition"
    ]);
    expect(DERIVATIVES_ENDPOINT_AUDIT.topTraderAccount).toContain("topLongShortAccountRatio");
    expect(DERIVATIVES_ENDPOINT_AUDIT.topTraderPosition).toContain("topLongShortPositionRatio");
    expect(fs.readFileSync(path.join(process.cwd(), "src", "lib", "binance", "derivatives.ts"), "utf8")).not.toMatch(/X-MBX-APIKEY/);
  });

  test("closed metric time and PIT selection exclude current/future observations", () => {
    const now = Date.UTC(2026, 7, 30, 12, 4, 0);
    expect(closedMetricTime(now)).toBe(Date.UTC(2026, 7, 30, 11, 55, 0));
    const rows = [{ timestamp: 10 }, { timestamp: 20 }, { timestamp: 30 }];
    expect(selectPointInTime(rows, 25, (row) => row.timestamp)).toEqual({ timestamp: 20 });
    expect(selectPointInTime(rows, 5, (row) => row.timestamp)).toBeNull();
    const metricRows: DerivativesResearchMetric[] = [
      { symbol: "ETHUSDT", metric_time: "2026-08-30T00:00:00.000Z", open_interest: 1 },
      { symbol: "ETHUSDT", metric_time: "2026-08-30T00:05:00.000Z", open_interest: 999 }
    ];
    expect(selectDerivativeMetricAsOf(metricRows, "ETHUSDT", Date.parse("2026-08-30T00:02:00.000Z"))?.open_interest).toBe(1);
  });

  test("percentiles use only point-in-time OI history and interaction state is directional", () => {
    const now = Date.UTC(2026, 7, 30, 12, 4, 0);
    const input: CollectionInput = {
      symbol: "ETHUSDT",
      now,
      priceReference: { current: 110, previous: 100 },
      openInterest: { symbol: "ETHUSDT", openInterest: 110, timestamp: now - 5 * 60 * 1000 },
      openInterestHistory: [
        { symbol: "ETHUSDT", openInterest: 90, openInterestValue: null, timestamp: now - 15 * 60 * 1000 },
        { symbol: "ETHUSDT", openInterest: 100, openInterestValue: null, timestamp: now - 10 * 60 * 1000 },
        { symbol: "ETHUSDT", openInterest: 110, openInterestValue: null, timestamp: now - 5 * 60 * 1000 },
        { symbol: "ETHUSDT", openInterest: 10_000, openInterestValue: null, timestamp: now + 5 * 60 * 1000 }
      ],
      fundingHistory: [],
      basisHistory: [],
      takerHistory: [],
      globalLongShortHistory: []
    };
    const metric = buildDerivativesMetric(input);
    expect(metric.oiPercentile).toBe(100);
    expect(metric.dataQualityFlags.futureObservationsExcluded).toBe(true);
    expect(metric.priceOiState).toBe("price_up_oi_up");
    expect(classifyPriceOiState(1, -1)).toBe("price_up_oi_down");
  });

  test("funding, basis, and taker features are parsed with quality metadata", () => {
    const now = Date.UTC(2026, 7, 30, 12, 4, 0);
    const metric = buildDerivativesMetric({
      symbol: "BTCUSDT",
      now,
      openInterestHistory: [],
      premiumIndex: { symbol: "BTCUSDT", markPrice: 101, indexPrice: 100, fundingRate: 0.0001, nextFundingTime: now + 60_000, timestamp: now - 10 * 60 * 1000 },
      fundingHistory: [{ symbol: "BTCUSDT", fundingRate: 0.0001, fundingTime: now - 10 * 60 * 1000, markPrice: 101 }],
      basisHistory: [{ pair: "BTCUSDT", basis: 0.2, basisRate: 0.002, indexPrice: 100, futuresPrice: 100.2, timestamp: now - 10 * 60 * 1000 }],
      takerHistory: [{ buySellRatio: 1.2, buyVolume: 120, sellVolume: 100, timestamp: now - 10 * 60 * 1000 }],
      globalLongShortHistory: [{ symbol: "BTCUSDT", longShortRatio: 1.1, longAccount: 0.52, shortAccount: 0.48, timestamp: now - 10 * 60 * 1000 }],
      topTraderAccountHistory: [{ longShortRatio: 1.2, longAccount: 0.545, shortAccount: 0.455, timestamp: now - 10 * 60 * 1000 }],
      topTraderPositionHistory: [{ longShortRatio: 1.3, longAccount: 0.565, shortAccount: 0.435, timestamp: now - 10 * 60 * 1000 }]
    });
    expect(metric.fundingRate).toBe(0.0001);
    expect(metric.basisBps).toBe(20);
    expect(metric.takerImbalance).toBeCloseTo(0.090909, 6);
    expect(metric.globalLongShortRatio).toBe(1.1);
    expect(metric.topAccountLongShortRatio).toBe(1.2);
    expect(metric.topPositionLongShortRatio).toBe(1.3);
    expect(metric.dataQualityFlags.topTraderPositioning).toEqual({ account: "public_market_data", position: "public_market_data" });
    expect(metric.dataQualityFlags.liquidation).toBe("INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA");
  });

  test("collector is fail-soft and still emits a quality row when endpoints fail", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === DERIVATIVES_PUBLIC_ENDPOINTS.openInterest) return response({ symbol: "ETHUSDT", openInterest: "100", time: Date.UTC(2026, 7, 30, 12, 0) });
      if (pathname === DERIVATIVES_PUBLIC_ENDPOINTS.openInterestHistory) return response([{ symbol: "ETHUSDT", sumOpenInterest: "100", timestamp: Date.UTC(2026, 7, 30, 11, 55) }]);
      throw new Error("synthetic provider outage");
    }) as typeof fetch;
    const result = await collectDerivativesMetrics(["ETHUSDT"], { now: Date.UTC(2026, 7, 30, 12, 4), fetchImpl });
    expect(result.rows).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.rows[0]!.dataQualityFlags.endpointErrors).toHaveLength(7);
    expect(result.rows[0]!.openInterest).toBe(100);
  });

  test("metric persistence is idempotent append-only", () => {
    const migration = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", "202608300001_derivatives_edge_data_foundation.sql"), "utf8");
    const route = fs.readFileSync(path.join(process.cwd(), "src", "app", "api", "jobs", "sync-market", "route.ts"), "utf8");
    expect(migration).toMatch(/unique \(symbol, interval, metric_time\)/i);
    expect(migration).toMatch(/before update or delete/i);
    expect(route).toMatch(/ignoreDuplicates:\s*true/);
    expect(route).toMatch(/gpt_derivatives_metrics/);
  });

  test("family ablation compares each family against a same-event price-only baseline", () => {
    const events: DerivativesResearchEvent[] = [
      { eventId: "a", symbol: "ETHUSDT", direction: "LONG", eventTime: Date.parse("2026-01-01T00:00:00Z"), fold: 1, grossR: 1, netR: 0.5 },
      { eventId: "b", symbol: "SOLUSDT", direction: "SHORT", eventTime: Date.parse("2026-02-01T00:00:00Z"), fold: 2, grossR: -1, netR: -1.5 },
      { eventId: "c", symbol: "BNBUSDT", direction: "LONG", eventTime: Date.parse("2026-03-01T00:00:00Z"), fold: 3, grossR: 1, netR: 0.5 }
    ];
    const metrics: DerivativesResearchMetric[] = events.map((event, index) => ({
      symbol: event.symbol,
      metric_time: new Date(event.eventTime).toISOString(),
      price_change_5m: index === 1 ? -1 : 1,
      oi_change_5m: index === 1 ? 1 : 1,
      funding_z_score: index === 1 ? -1 : 1,
      basis_bps: index === 1 ? -1 : 1,
      taker_imbalance: index === 1 ? -1 : 1,
      global_long_short_ratio: index === 1 ? 0.9 : 1.1
    }));
    const result = buildDerivativeAblation({ events, metrics, historyDays: 100 });
    expect(result.baseline.eventCount).toBe(3);
    expect(result.families).toHaveLength(5);
    expect(result.families.every((family) => family.comparableBaseline.eventCount === 3)).toBe(true);
    expect(result.combined.family).toBe("combined_permitted");
  });

  test("production and GPT-PROFIT-003 holdout remain disabled/untouched", () => {
    expect(PRODUCTION_SIGNAL_STRATEGIES).toEqual([]);
    for (const marker of [
      "GPT-PROFIT-003-FINAL-UNSEEN-EXECUTION.json",
      "GPT-PROFIT-003-R1-FINAL-UNSEEN-EXECUTION.json",
      "GPT-PROFIT-003-R2-FINAL-UNSEEN-EXECUTION.json"
    ]) expect(fs.existsSync(path.join(process.cwd(), "reports", marker))).toBe(false);
  });

  test("liquidations are forward-only public stream data", () => {
    const event = parseForwardLiquidationEvent({
      e: "forceOrder",
      E: 1_000,
      o: { s: "BTCUSDT", S: "SELL", o: "LIMIT", ap: "100", z: "2", T: 999 }
    }, 1_010);
    expect(event?.notional).toBe(200);
    expect(event?.dataQualityFlags).toEqual({ forwardOnly: true, historicalBackfill: false, pointInTime: true });
    expect(parseForwardLiquidationEvent({ e: "forceOrder", o: { s: "BTCUSDT" } })).toBeNull();
    expect(forwardLiquidationCollectorStatus()).toMatchObject({ mode: "forward_only", historicalBackfill: false, backtestSafe: false });
  });
});

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
