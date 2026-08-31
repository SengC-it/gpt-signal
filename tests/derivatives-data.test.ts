import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  DERIVATIVES_ENDPOINT_AUDIT,
  DERIVATIVES_ENDPOINT_CAPABILITIES,
  DERIVATIVES_MARKET_DATA_KEY_ENDPOINTS,
  DERIVATIVES_PUBLIC_ENDPOINTS,
  buildDerivativesMetric,
  classifyPriceOiState,
  closedMetricTime,
  collectDerivativesMetrics,
  fetchGlobalLongShortHistory,
  fetchOpenInterestHistory,
  fetchTopTraderAccountHistory,
  fetchTopTraderPositionHistory,
  isFreshObservation,
  selectPointInTime,
  sourceTimingFor,
  type CollectionInput
} from "@/lib/binance/derivatives";
import { forwardLiquidationCollectorStatus, parseForwardLiquidationEvent } from "@/lib/binance/liquidation-forward";
import {
  buildDerivativeAblation,
  derivativesIntersectionCoverageDays,
  evaluateDerivativesGate,
  selectDerivativeMetricAsOf,
  summarizeDerivativeFamily,
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
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "reports", "GPT-PROFIT-004-DATA-MANIFEST.json"), "utf8"));
    expect(manifest.privateEndpointsUsed).toBe(false);
    expect(manifest.privateEndpointFamilies).toEqual([]);
  });

  test("top-trader endpoints are MARKET_DATA and require the optional key", async () => {
    expect(DERIVATIVES_ENDPOINT_CAPABILITIES.topTraderAccount).toEqual({ classification: "MARKET_DATA_API_KEY", apiKeyRequired: true });
    expect(DERIVATIVES_ENDPOINT_CAPABILITIES.topTraderPosition).toEqual({ classification: "MARKET_DATA_API_KEY", apiKeyRequired: true });
    expect(DERIVATIVES_MARKET_DATA_KEY_ENDPOINTS).toEqual([
      DERIVATIVES_PUBLIC_ENDPOINTS.topTraderAccount,
      DERIVATIVES_PUBLIC_ENDPOINTS.topTraderPosition
    ]);
    const fetchImpl = vi.fn(async () => response([])) as typeof fetch;
    await expect(fetchTopTraderAccountHistory("BTCUSDT", { fetchImpl })).rejects.toThrow("UNAVAILABLE_API_KEY_REQUIRED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("market-data key is sent only to the explicit top-trader allow-list", async () => {
    const requests: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return response([]);
    }) as typeof fetch;
    vi.stubEnv("BINANCE_MARKET_DATA_API_KEY", "market-data-test");
    try {
      await fetchTopTraderAccountHistory("BTCUSDT", { fetchImpl });
      await fetchOpenInterestHistory("BTCUSDT", { fetchImpl });
    } finally {
      vi.unstubAllEnvs();
    }
    expect((requests[0]!.headers as Record<string, string>)[["X-MBX", "APIKEY"].join("-")]).toBe("market-data-test");
    expect(requests[1]!.headers).toBeUndefined();
  });

  test("source timing enforces period close and funding settlement", () => {
    const start = Date.parse("2026-08-30T12:00:00.000Z");
    expect(sourceTimingFor({ timestamp: start }, "basis", start + 4 * 60 * 1000)).toMatchObject({
      periodStart: start,
      periodEnd: start + 5 * 60 * 1000,
      availableAt: start + 5 * 60 * 1000,
      status: "FRESH"
    });
    expect(sourceTimingFor({ timestamp: start }, "basis", start + 4 * 60 * 1000).availableAt).toBeGreaterThan(start + 4 * 60 * 1000);
    expect(sourceTimingFor({ timestamp: start }, "taker_flow", start + 6 * 60 * 1000)).toMatchObject({
      periodStart: start,
      periodEnd: start + 5 * 60 * 1000,
      availableAt: start + 5 * 60 * 1000
    });
    expect(sourceTimingFor({ fundingTime: start }, "funding", start - 1)).toMatchObject({ availableAt: start, status: "FRESH" });
    const metric = buildDerivativesMetric({
      symbol: "BTCUSDT",
      now: start + 10 * 60 * 1000,
      openInterestHistory: [],
      fundingHistory: [{ symbol: "BTCUSDT", fundingRate: 0.001, fundingTime: start + 15 * 60 * 1000, markPrice: 100 }],
      basisHistory: [],
      takerHistory: [],
      globalLongShortHistory: []
    });
    expect(metric.fundingRate).toBeNull();
  });

  test("period-end families are PIT-usable at the provider timestamp", () => {
    const periodStart = Date.parse("2026-08-30T12:00:00.000Z");
    const periodEnd = periodStart + 5 * 60 * 1000;
    for (const family of ["open_interest", "positioning", "top_trader_account", "top_trader_position"] as const) {
      expect(sourceTimingFor({ timestamp: periodEnd }, family, periodEnd)).toMatchObject({
        periodStart,
        periodEnd,
        availableAt: periodEnd,
        status: "FRESH"
      });
      expect(isFreshObservation({ timestamp: periodEnd }, family, periodEnd)).toBe(true);
      expect(isFreshObservation({ timestamp: periodEnd }, family, periodEnd - 1)).toBe(false);
    }
    for (const family of ["basis", "taker_flow"] as const) {
      expect(isFreshObservation({ timestamp: periodStart }, family, periodStart + 4 * 60 * 1000)).toBe(false);
      expect(isFreshObservation({ timestamp: periodStart }, family, periodEnd)).toBe(true);
    }
    expect(isFreshObservation({ fundingTime: periodEnd }, "funding", periodEnd - 1)).toBe(false);
    expect(isFreshObservation({ fundingTime: periodEnd }, "funding", periodEnd)).toBe(true);
  });

  test("period-end endpoint parsers preserve provider period boundaries", async () => {
    const periodEnd = Date.parse("2026-08-30T12:05:00.000Z");
    const fetchImpl = vi.fn(async () => response([{
      timestamp: periodEnd,
      sumOpenInterest: "100",
      sumOpenInterestValue: "1000",
      longShortRatio: "1.1",
      longAccount: "0.52",
      shortAccount: "0.48"
    }])) as typeof fetch;
    const oi = await fetchOpenInterestHistory("BTCUSDT", { fetchImpl });
    const positioning = await fetchGlobalLongShortHistory("BTCUSDT", { fetchImpl });
    vi.stubEnv("BINANCE_MARKET_DATA_API_KEY", "market-data-test");
    try {
      const topAccount = await fetchTopTraderAccountHistory("BTCUSDT", { fetchImpl });
      const topPosition = await fetchTopTraderPositionHistory("BTCUSDT", { fetchImpl });
      expect(topAccount[0]).toMatchObject({ timestamp: periodEnd, periodStart: periodEnd - 5 * 60 * 1000, periodEnd, availableAt: periodEnd });
      expect(topPosition[0]).toMatchObject({ timestamp: periodEnd, periodStart: periodEnd - 5 * 60 * 1000, periodEnd, availableAt: periodEnd });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(oi[0]).toMatchObject({ timestamp: periodEnd, periodStart: periodEnd - 5 * 60 * 1000, periodEnd, availableAt: periodEnd });
    expect(positioning[0]).toMatchObject({ timestamp: periodEnd, periodStart: periodEnd - 5 * 60 * 1000, periodEnd, availableAt: periodEnd });
  });

  test("closed metric time and PIT selection exclude current/future observations", () => {
    const now = Date.UTC(2026, 7, 30, 12, 4, 0);
    expect(closedMetricTime(now)).toBe(Date.UTC(2026, 7, 30, 11, 55, 0));
    const rows = [{ timestamp: 10 }, { timestamp: 20 }, { timestamp: 30 }];
    expect(selectPointInTime(rows, 25, (row) => row.timestamp)).toEqual({ timestamp: 20 });
    expect(selectPointInTime(rows, 5, (row) => row.timestamp)).toBeNull();
    const metricRows: DerivativesResearchMetric[] = [
      { symbol: "ETHUSDT", metric_time: "2026-08-30T00:00:00.000Z", available_at: "2026-08-30T00:05:00.000Z", open_interest: 1 },
      { symbol: "ETHUSDT", metric_time: "2026-08-30T00:05:00.000Z", available_at: "2026-08-30T00:10:00.000Z", open_interest: 999 }
    ];
    expect(selectDerivativeMetricAsOf(metricRows, "ETHUSDT", Date.parse("2026-08-30T00:04:00.000Z"))).toBeNull();
    expect(selectDerivativeMetricAsOf(metricRows, "ETHUSDT", Date.parse("2026-08-30T00:05:00.000Z"))?.open_interest).toBe(1);
    expect(selectDerivativeMetricAsOf(metricRows, "ETHUSDT", Date.parse("2026-08-30T00:09:00.000Z"))?.open_interest).toBe(1);
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
    expect(metric.dataQualityFlags.topTraderPositioning).toEqual({ account: "market_data_api_key", position: "market_data_api_key" });
    expect(metric.dataQualityFlags.liquidation).toBe("INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA");
  });

  test("stale 5m observations are nulled and 15m references cannot masquerade as 5m", () => {
    const now = Date.UTC(2026, 7, 30, 12, 4, 0);
    const metric = buildDerivativesMetric({
      symbol: "DOGEUSDT",
      now,
      priceReference: { current: 105, previous: 100, interval: "15m" },
      openInterestHistory: [],
      fundingHistory: [],
      basisHistory: [{ pair: "DOGEUSDT", basis: 1, basisRate: 0.01, indexPrice: 100, futuresPrice: 101, timestamp: now - 60 * 60 * 1000 }],
      takerHistory: [],
      globalLongShortHistory: []
    });
    expect(metric.priceChange5m).toBeNull();
    expect(metric.basisBps).toBeNull();
    expect(metric.dataQualityFlags.sourceTiming).toMatchObject({ basis: { status: "STALE_SOURCE_DATA", stale: true } });
    expect(metric.dataQualityFlags.staleFamilies).toContain("basis");
  });

  test("closed 5m price reference drives derivatives divergences", () => {
    const decision = Date.parse("2026-08-30T12:00:00.000Z");
    const metric = buildDerivativesMetric({
      symbol: "BTCUSDT",
      now: decision + 4 * 60 * 1000,
      priceReference: {
        current: 105,
        previous: 100,
        interval: "5m",
        currentTime: decision,
        previousTime: decision - 5 * 60 * 1000
      },
      openInterestHistory: [],
      premiumIndex: { symbol: "BTCUSDT", markPrice: 101, indexPrice: 100, fundingRate: 0.0001, nextFundingTime: decision + 60_000, timestamp: decision - 10 * 60 * 1000 },
      fundingHistory: [{ symbol: "BTCUSDT", fundingRate: 0.0001, fundingTime: decision - 10 * 60 * 1000, markPrice: 101 }],
      basisHistory: [{ pair: "BTCUSDT", basis: 0.2, basisRate: 0.002, indexPrice: 100, futuresPrice: 100.2, timestamp: decision - 5 * 60 * 1000 }],
      takerHistory: [{ buySellRatio: 1.2, buyVolume: 120, sellVolume: 100, timestamp: decision - 5 * 60 * 1000 }],
      globalLongShortHistory: []
    });
    expect(metric.priceChange5m).toBe(5);
    expect(metric.priceFundingDivergence).toBe(0.0005);
    expect(metric.priceBasisDivergence).toBe(100);
    expect(metric.aggressiveFlowDivergence).toBeCloseTo(0.454545, 6);
    expect(metric.dataQualityFlags.priceReference).toMatchObject({ interval: "5m", valid: true });
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
    expect(migration).toMatch(/period_start timestamptz/i);
    expect(migration).toMatch(/period_end timestamptz/i);
    expect(migration).toMatch(/available_at timestamptz/i);
    expect(migration).toMatch(/source_age_ms bigint/i);
    expect(route).toMatch(/ignoreDuplicates:\s*true/);
    expect(route).toMatch(/gpt_derivatives_metrics/);
    expect(route).toMatch(/interval:\s*"5m"/);
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

  test("family coverage is independent and a broken family does not truncate others", () => {
    const event: DerivativesResearchEvent = {
      eventId: "coverage-1",
      symbol: "BTCUSDT",
      direction: "LONG",
      eventTime: Date.parse("2026-08-30T12:00:00Z"),
      fold: 1,
      grossR: 1,
      netR: 0.5
    };
    const metric: DerivativesResearchMetric = {
      symbol: event.symbol,
      metric_time: new Date(event.eventTime).toISOString(),
      open_interest: 100,
      oi_change_5m: 1,
      basis_bps: 1
    };
    const result = buildDerivativeAblation({
      events: [event],
      metrics: [metric],
      historyDays: 30,
      familyCoverageDays: { open_interest: 100, basis: 20 }
    });
    expect(result.families.find((family) => family.family === "open_interest")?.status).toBe("EVALUATED");
    expect(result.families.find((family) => family.family === "open_interest")?.coverageDays).toBe(100);
    expect(result.families.find((family) => family.family === "basis")?.status).toBe("INSUFFICIENT_DERIVATIVES_HISTORY");
    expect(result.families.find((family) => family.family === "basis")?.coverageDays).toBe(20);
  });

  test("single-family Gate uses its own coverage and combined uses selected-family intersection", () => {
    const event: DerivativesResearchEvent = {
      eventId: "single-family-1",
      symbol: "BTCUSDT",
      direction: "LONG",
      eventTime: Date.parse("2026-08-30T12:00:00Z"),
      fold: 1,
      grossR: 1,
      netR: 0.5
    };
    const metric: DerivativesResearchMetric = {
      symbol: event.symbol,
      metric_time: new Date(event.eventTime).toISOString(),
      open_interest: 100,
      oi_change_5m: 1,
      basis_bps: 1
    };
    const result = buildDerivativeAblation({
      events: [event],
      metrics: [metric],
      historyDays: 30,
      familyCoverageDays: { open_interest: 120, basis: 30 }
    });
    const oi = result.families.find((family) => family.family === "open_interest")!;
    const gate = evaluateDerivativesGate({ historyDays: oi.coverageDays!, summary: oi });
    expect(gate.checks.historyAtLeast90d).toBe(true);
    expect(gate.status).not.toBe("INSUFFICIENT_DERIVATIVES_HISTORY");
    expect(derivativesIntersectionCoverageDays([120, 30])).toBe(30);
    expect(derivativesIntersectionCoverageDays([120])).toBe(120);
    expect(result.combined.coverageDays).toBeNull();
  });

  test("incremental top-30% slice improves a positively related family", () => {
    const rows = [-5, -4, -3, -2, -1, 0.5, 1, 3, -1, 8].map((netR, index) => ({
      event: {
        eventId: `positive-${index}`,
        symbol: ["BTCUSDT", "ETHUSDT", "SOLUSDT"][index % 3]!,
        direction: "LONG" as const,
        eventTime: Date.UTC(2026, 0, 1 + index),
        fold: (index % 3) + 1,
        grossR: netR,
        netR
      },
      score: index + 1
    }));
    const baseline = summarizeDerivativeFamily("price_only", rows.map(({ event }) => ({ event, score: null })));
    const summary = summarizeDerivativeFamily("open_interest", rows, baseline);
    expect(summary.conditionedEventCount).toBe(3);
    expect(summary.conditionedNetExpectancyR).toBeGreaterThan(summary.netExpectancyR!);
    expect(summary.deltaNetExpectancyR).toBeGreaterThan(0);
    expect(summary.deltaProfitFactor).toBeGreaterThan(0);
  });

  test("preliminary conditional evidence uses conditioned metrics but cannot robustly PASS without nested OOS", () => {
    const rows = [-5, -4, -3, -2, -1, 0.5, 1, 3, -1, 8].map((netR, index) => ({
      event: {
        eventId: `preliminary-${index}`,
        symbol: ["BTCUSDT", "ETHUSDT", "SOLUSDT"][index % 3]!,
        direction: "LONG" as const,
        eventTime: Date.UTC(2026, 0, 1 + index),
        fold: (index % 3) + 1,
        grossR: netR,
        netR
      },
      score: index + 1
    }));
    const baseline = summarizeDerivativeFamily("price_only", rows.map(({ event }) => ({ event, score: null })));
    const summary = summarizeDerivativeFamily("open_interest", rows, baseline);
    const gate = evaluateDerivativesGate({ historyDays: 120, summary });
    expect(summary.netExpectancyR).toBeLessThan(0);
    expect(summary.conditionedNetExpectancyR).toBeGreaterThan(0);
    expect(gate.evidenceStatus).toBe("PRELIMINARY_INCREMENTAL_EVIDENCE");
    expect(gate.status).toBe("READY_FOR_NESTED_DERIVATIVES_RESEARCH");
    expect(gate.passed).toBe(false);
    expect(gate.checks.netExpectancyPositive).toBe(true);
    expect(gate.checks.nestedValidationCompleted).toBe(false);
    expect(evaluateDerivativesGate({ historyDays: 120, summary, validation: "PURGED_NESTED_OOS" }).passed).toBe(false);
  });

  test("monotonicity is bounded to fixed score deciles", () => {
    const rows = Array.from({ length: 25 }, (_, index) => {
      const grossR = index % 2 === 0 ? 1 : -1;
      return {
        event: {
          eventId: `decile-${index}`,
          symbol: ["BTCUSDT", "ETHUSDT", "SOLUSDT"][index % 3]!,
          direction: "LONG" as const,
          eventTime: Date.UTC(2026, 0, 1 + index),
          fold: (index % 3) + 1,
          grossR,
          netR: grossR - 0.1
        },
        score: index + 1
      };
    });
    const summary = summarizeDerivativeFamily("open_interest", rows);
    expect(summary.monotonicBucketCount).toBe(10);
    expect(summary.monotonicBuckets).toHaveLength(10);
    expect(summary.monotonicValidBucketCount).toBe(10);
    expect(summary.monotonicViolations).toBeGreaterThanOrEqual(0);
    expect(summary.monotonicViolations).toBeLessThanOrEqual(9);
    expect(summary.monotonicBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(25);
    expect(summary.monotonicBuckets.every((bucket) => "grossExpectancyR" in bucket && "netExpectancyR" in bucket)).toBe(true);
  });

  test("non-predictive scores are not marked incremental", () => {
    const rows = Array.from({ length: 20 }, (_, index) => {
      const netR = index % 2 === 0 ? -1 : 1;
      return {
        event: {
          eventId: `null-${index}`,
          symbol: index % 2 ? "ETHUSDT" : "BTCUSDT",
          direction: "LONG" as const,
          eventTime: Date.UTC(2026, 0, 1 + index),
          fold: (index % 3) + 1,
          grossR: netR,
          netR
        },
        score: index + 1
      };
    });
    const baseline = summarizeDerivativeFamily("price_only", rows.map(({ event }) => ({ event, score: null })));
    const summary = summarizeDerivativeFamily("open_interest", rows, baseline);
    expect(summary.conditionedNetExpectancyR).toBeCloseTo(summary.netExpectancyR!, 6);
    expect(summary.deltaNetExpectancyR).toBeCloseTo(0, 6);
    expect(summary.deltaProfitFactor).toBeCloseTo(0, 6);
  });

  test("future gate measures single-symbol net-R concentration rather than breadth alone", () => {
    const event = (eventId: string, symbol: string, netR: number) => ({
      eventId,
      symbol,
      direction: "LONG" as const,
      eventTime: Date.parse("2026-08-30T12:00:00Z"),
      fold: 1,
      grossR: netR,
      netR
    });
    const summary = summarizeDerivativeFamily("open_interest", [
      { event: event("a", "BTCUSDT", 8), score: 1 },
      { event: event("b", "ETHUSDT", 1), score: 2 },
      { event: event("c", "SOLUSDT", 1), score: 3 }
    ]);
    const gate = evaluateDerivativesGate({ historyDays: 100, summary });
    expect(summary.symbolBreadth).toBe(3);
    expect(summary.largestSymbolAbsoluteContributionShare).toBe(0.8);
    expect(gate.checks.largestSymbolAbsoluteContributionAtMost50).toBe(false);
    expect(gate.checks.noSingleSymbolDomination).toBe(false);
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
