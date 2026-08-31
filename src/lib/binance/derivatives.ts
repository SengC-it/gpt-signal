const DEFAULT_BASE_URL = "https://fapi.binance.com";
export const DERIVATIVES_INTERVAL = "5m";
export const DERIVATIVES_INTERVAL_MS = 5 * 60 * 1000;
export const DERIVATIVES_SOURCE_VERSION = "binance-usdm-public-rest-v1";
export const DERIVATIVES_HISTORY_LIMIT = 100;
/** Binance reports these 5m statistics at the end of the represented period. */
export const DERIVATIVES_PERIOD_END_TIMESTAMP_FAMILIES = [
  "open_interest",
  "positioning",
  "top_trader_account",
  "top_trader_position"
] as const;
export const DERIVATIVES_PERIODIC_FRESHNESS_TOLERANCE_MS = 10 * 60 * 1000;
export const DERIVATIVES_FUNDING_FRESHNESS_TOLERANCE_MS = 9 * 60 * 60 * 1000;

export const DERIVATIVES_FAMILY_FRESHNESS_TOLERANCE_MS = Object.freeze({
  open_interest: DERIVATIVES_PERIODIC_FRESHNESS_TOLERANCE_MS,
  funding: DERIVATIVES_FUNDING_FRESHNESS_TOLERANCE_MS,
  basis: DERIVATIVES_PERIODIC_FRESHNESS_TOLERANCE_MS,
  taker_flow: DERIVATIVES_PERIODIC_FRESHNESS_TOLERANCE_MS,
  positioning: DERIVATIVES_PERIODIC_FRESHNESS_TOLERANCE_MS,
  top_trader_account: DERIVATIVES_PERIODIC_FRESHNESS_TOLERANCE_MS,
  top_trader_position: DERIVATIVES_PERIODIC_FRESHNESS_TOLERANCE_MS,
  liquidation: 0
} as const);

/**
 * This list is deliberately limited to public market-data endpoints.  No
 * account, position, order, or user-trade endpoint belongs in the collector.
 */
export const DERIVATIVES_PUBLIC_ENDPOINTS = Object.freeze({
  openInterest: "/fapi/v1/openInterest",
  openInterestHistory: "/futures/data/openInterestHist",
  premiumIndex: "/fapi/v1/premiumIndex",
  fundingHistory: "/fapi/v1/fundingRate",
  basis: "/futures/data/basis",
  takerFlow: "/futures/data/takerlongshortRatio",
  globalLongShort: "/futures/data/globalLongShortAccountRatio",
  topTraderAccount: "/futures/data/topLongShortAccountRatio",
  topTraderPosition: "/futures/data/topLongShortPositionRatio"
});

/**
 * Availability metadata is kept separate from the collector allow-list. The
 * Top-trader endpoints are aggregate MARKET_DATA endpoints and require the
 * optional BINANCE_MARKET_DATA_API_KEY. They never use account credentials.
 * Liquidations have a public stream but no safe historical REST backfill.
 */
export const DERIVATIVES_ENDPOINT_AUDIT = Object.freeze({
  ...DERIVATIVES_PUBLIC_ENDPOINTS,
  liquidation: "websocket:!forceOrder@arr"
});

export type DerivativesEndpointClassification = "ANONYMOUS_PUBLIC" | "MARKET_DATA_API_KEY" | "PRIVATE";

/** Capability classification is intentionally separate from the endpoint allow-list. */
export const DERIVATIVES_ENDPOINT_CAPABILITIES = Object.freeze({
  openInterest: { classification: "ANONYMOUS_PUBLIC" as const, apiKeyRequired: false },
  openInterestHistory: { classification: "ANONYMOUS_PUBLIC" as const, apiKeyRequired: false },
  premiumIndex: { classification: "ANONYMOUS_PUBLIC" as const, apiKeyRequired: false },
  fundingHistory: { classification: "ANONYMOUS_PUBLIC" as const, apiKeyRequired: false },
  basis: { classification: "ANONYMOUS_PUBLIC" as const, apiKeyRequired: false },
  takerFlow: { classification: "ANONYMOUS_PUBLIC" as const, apiKeyRequired: false },
  globalLongShort: { classification: "ANONYMOUS_PUBLIC" as const, apiKeyRequired: false },
  topTraderAccount: { classification: "MARKET_DATA_API_KEY" as const, apiKeyRequired: true },
  topTraderPosition: { classification: "MARKET_DATA_API_KEY" as const, apiKeyRequired: true },
  liquidation: { classification: "ANONYMOUS_PUBLIC" as const, apiKeyRequired: false }
});

export const DERIVATIVES_MARKET_DATA_KEY_ENDPOINTS = Object.freeze([
  DERIVATIVES_PUBLIC_ENDPOINTS.topTraderAccount,
  DERIVATIVES_PUBLIC_ENDPOINTS.topTraderPosition
]);

const MARKET_DATA_KEY_HEADER = ["X-MBX", "APIKEY"].join("-");

type FetchLike = typeof fetch;

export type DerivativesRequestOptions = {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  limit?: number;
};

export type SourceTiming = {
  sourceTimestamp: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  availableAt: number | null;
  sourceAgeMs: number | null;
  stale: boolean;
  status: "FRESH" | "STALE_SOURCE_DATA" | "MISSING" | "UNAVAILABLE_API_KEY_REQUIRED";
};

export type TimedOpenInterest = {
  symbol: string;
  openInterest: number;
  openInterestValue: number | null;
  timestamp: number;
  sourceTimestamp?: number;
  periodStart?: number;
  periodEnd?: number;
  availableAt?: number;
};

export type TimedFunding = {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  markPrice: number | null;
  sourceTimestamp?: number;
  periodStart?: number | null;
  periodEnd?: number;
  availableAt?: number;
};

export type TimedBasis = {
  pair: string;
  basis: number | null;
  basisRate: number | null;
  indexPrice: number | null;
  futuresPrice: number | null;
  timestamp: number;
  sourceTimestamp?: number;
  periodStart?: number;
  periodEnd?: number;
  availableAt?: number;
};

export type TimedTakerFlow = {
  buySellRatio: number | null;
  buyVolume: number | null;
  sellVolume: number | null;
  timestamp: number;
  sourceTimestamp?: number;
  periodStart?: number;
  periodEnd?: number;
  availableAt?: number;
};

export type TimedPositioning = {
  symbol: string;
  longShortRatio: number | null;
  longAccount: number | null;
  shortAccount: number | null;
  timestamp: number;
  sourceTimestamp?: number;
  periodStart?: number;
  periodEnd?: number;
  availableAt?: number;
};

export type TimedTopTraderPositioning = {
  longShortRatio: number | null;
  longAccount: number | null;
  shortAccount: number | null;
  timestamp: number;
  sourceTimestamp?: number;
  periodStart?: number;
  periodEnd?: number;
  availableAt?: number;
};

export type CurrentOpenInterest = {
  symbol: string;
  openInterest: number;
  timestamp: number;
  sourceTimestamp?: number;
  periodStart?: null;
  periodEnd?: number;
  availableAt?: number;
};

export type PremiumIndex = {
  symbol: string;
  markPrice: number | null;
  indexPrice: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  timestamp: number;
  sourceTimestamp?: number;
  periodStart?: null;
  periodEnd?: number;
  availableAt?: number;
};

export type PriceReference = {
  current: number;
  previous: number;
  interval?: string;
  currentTime?: number;
  previousTime?: number;
};

export type DerivativesMetric = {
  symbol: string;
  interval: typeof DERIVATIVES_INTERVAL;
  metricTime: number;
  openInterest: number | null;
  openInterestValue: number | null;
  oiChange5m: number | null;
  oiChange15m: number | null;
  oiChange1h: number | null;
  oiChange4h: number | null;
  oiAcceleration: number | null;
  oiPercentile: number | null;
  fundingRate: number | null;
  lastSettledFunding: number | null;
  fundingPercentile: number | null;
  fundingZScore: number | null;
  fundingAcceleration: number | null;
  fundingExtremePositive: boolean | null;
  fundingExtremeNegative: boolean | null;
  priceFundingDivergence: number | null;
  oiFundingInteraction: number | null;
  nextFundingTime: number | null;
  perpetualPremiumBps: number | null;
  basisBps: number | null;
  basisRate: number | null;
  basisAcceleration: number | null;
  basisPercentile: number | null;
  basisExpansion: boolean | null;
  basisContraction: boolean | null;
  priceBasisDivergence: number | null;
  takerBuyRatio: number | null;
  takerSellRatio: number | null;
  takerImbalance: number | null;
  takerAcceleration: number | null;
  aggressiveFlowDivergence: number | null;
  globalLongShortRatio: number | null;
  globalLongShortChange: number | null;
  topAccountLongShortRatio: number | null;
  topPositionLongShortRatio: number | null;
  topAccountLongShortChange: number | null;
  topPositionLongShortChange: number | null;
  positioningDivergence: number | null;
  liquidationNotional: number | null;
  priceChange5m: number | null;
  priceOiState: string | null;
  sourceTimestamp: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  availableAt: number | null;
  sourceAgeMs: number | null;
  fetchedAt: number;
  sourceEndpoint: string;
  sourceVersion: string;
  dataQualityFlags: Record<string, unknown>;
};

export type DerivativesCollectionResult = {
  rows: DerivativesMetric[];
  attemptedSymbols: string[];
  endpointStatus: Record<string, { ok: number; failed: number; observations: number }>;
  errors: Array<{ symbol: string; endpoint: string; message: string }>;
};

export type CollectionInput = {
  symbol: string;
  now: number;
  priceReference?: PriceReference;
  openInterest?: CurrentOpenInterest | null;
  openInterestHistory: TimedOpenInterest[];
  premiumIndex?: PremiumIndex | null;
  fundingHistory: TimedFunding[];
  basisHistory: TimedBasis[];
  takerHistory: TimedTakerFlow[];
  globalLongShortHistory: TimedPositioning[];
  topTraderAccountHistory?: TimedTopTraderPositioning[];
  topTraderPositionHistory?: TimedTopTraderPositioning[];
  endpointErrors?: Array<{ endpoint: string; message: string }>;
};

export async function fetchCurrentOpenInterest(symbol: string, options: DerivativesRequestOptions = {}) {
  const data = await requestJson<Record<string, unknown>>(DERIVATIVES_PUBLIC_ENDPOINTS.openInterest, { symbol }, options);
  const timestamp = finiteNumber(data.time);
  return {
    symbol,
    openInterest: finiteNumber(data.openInterest),
    timestamp,
    sourceTimestamp: timestamp,
    periodStart: null,
    periodEnd: timestamp,
    availableAt: timestamp
  } satisfies CurrentOpenInterest;
}

export async function fetchOpenInterestHistory(symbol: string, options: DerivativesRequestOptions = {}) {
  const data = await requestJson<unknown[]>(DERIVATIVES_PUBLIC_ENDPOINTS.openInterestHistory, {
    symbol,
    period: DERIVATIVES_INTERVAL,
    limit: options.limit ?? DERIVATIVES_HISTORY_LIMIT
  }, options);
  return data.flatMap((item) => {
    const row = asRecord(item);
    const openInterest = finiteNumberOrNull(row.sumOpenInterest);
    const timestamp = finiteNumberOrNull(row.timestamp);
    if (openInterest === null || timestamp === null) return [];
    return [{
      symbol,
      openInterest,
      openInterestValue: finiteNumberOrNull(row.sumOpenInterestValue),
      timestamp,
      sourceTimestamp: timestamp,
      periodStart: timestamp - DERIVATIVES_INTERVAL_MS,
      periodEnd: timestamp,
      availableAt: timestamp
    } satisfies TimedOpenInterest];
  });
}

export async function fetchPremiumIndex(symbol: string, options: DerivativesRequestOptions = {}) {
  const data = await requestJson<Record<string, unknown>>(DERIVATIVES_PUBLIC_ENDPOINTS.premiumIndex, { symbol }, options);
  return {
    symbol,
    markPrice: finiteNumberOrNull(data.markPrice),
    indexPrice: finiteNumberOrNull(data.indexPrice),
    fundingRate: finiteNumberOrNull(data.lastFundingRate),
    nextFundingTime: finiteNumberOrNull(data.nextFundingTime),
    timestamp: finiteNumber(data.time),
    sourceTimestamp: finiteNumber(data.time),
    periodStart: null,
    periodEnd: finiteNumber(data.time),
    availableAt: finiteNumber(data.time)
  } satisfies PremiumIndex;
}

export async function fetchFundingHistory(symbol: string, options: DerivativesRequestOptions = {}) {
  const data = await requestJson<unknown[]>(DERIVATIVES_PUBLIC_ENDPOINTS.fundingHistory, {
    symbol,
    limit: options.limit ?? DERIVATIVES_HISTORY_LIMIT
  }, options);
  return data.flatMap((item) => {
    const row = asRecord(item);
    const fundingRate = finiteNumberOrNull(row.fundingRate);
    const fundingTime = finiteNumberOrNull(row.fundingTime);
    if (fundingRate === null || fundingTime === null) return [];
    return [{
      symbol,
      fundingRate,
      fundingTime,
      markPrice: finiteNumberOrNull(row.markPrice),
      sourceTimestamp: fundingTime,
      periodStart: null,
      periodEnd: fundingTime,
      availableAt: fundingTime
    } satisfies TimedFunding];
  });
}

export async function fetchBasisHistory(symbol: string, options: DerivativesRequestOptions = {}) {
  const data = await requestJson<unknown[]>(DERIVATIVES_PUBLIC_ENDPOINTS.basis, {
    pair: symbol,
    contractType: "PERPETUAL",
    period: DERIVATIVES_INTERVAL,
    limit: options.limit ?? DERIVATIVES_HISTORY_LIMIT
  }, options);
  return data.flatMap((item) => {
    const row = asRecord(item);
    const timestamp = finiteNumberOrNull(row.timestamp);
    if (timestamp === null) return [];
    return [{
      pair: symbol,
      basis: finiteNumberOrNull(row.basis),
      basisRate: finiteNumberOrNull(row.basisRate),
      indexPrice: finiteNumberOrNull(row.indexPrice),
      futuresPrice: finiteNumberOrNull(row.futuresPrice),
      timestamp,
      sourceTimestamp: timestamp,
      periodStart: timestamp,
      periodEnd: timestamp + DERIVATIVES_INTERVAL_MS,
      availableAt: timestamp + DERIVATIVES_INTERVAL_MS
    } satisfies TimedBasis];
  });
}

export async function fetchTakerFlowHistory(symbol: string, options: DerivativesRequestOptions = {}) {
  const data = await requestJson<unknown[]>(DERIVATIVES_PUBLIC_ENDPOINTS.takerFlow, {
    symbol,
    period: DERIVATIVES_INTERVAL,
    limit: options.limit ?? DERIVATIVES_HISTORY_LIMIT
  }, options);
  return data.flatMap((item) => {
    const row = asRecord(item);
    const timestamp = finiteNumberOrNull(row.timestamp);
    if (timestamp === null) return [];
    return [{
      buySellRatio: finiteNumberOrNull(row.buySellRatio),
      buyVolume: finiteNumberOrNull(row.buyVol),
      sellVolume: finiteNumberOrNull(row.sellVol),
      timestamp,
      sourceTimestamp: timestamp,
      periodStart: timestamp,
      periodEnd: timestamp + DERIVATIVES_INTERVAL_MS,
      availableAt: timestamp + DERIVATIVES_INTERVAL_MS
    } satisfies TimedTakerFlow];
  });
}

export async function fetchGlobalLongShortHistory(symbol: string, options: DerivativesRequestOptions = {}) {
  const data = await requestJson<unknown[]>(DERIVATIVES_PUBLIC_ENDPOINTS.globalLongShort, {
    symbol,
    period: DERIVATIVES_INTERVAL,
    limit: options.limit ?? DERIVATIVES_HISTORY_LIMIT
  }, options);
  return data.flatMap((item) => {
    const row = asRecord(item);
    const timestamp = finiteNumberOrNull(row.timestamp);
    if (timestamp === null) return [];
    return [{
      symbol,
      longShortRatio: finiteNumberOrNull(row.longShortRatio),
      longAccount: finiteNumberOrNull(row.longAccount),
      shortAccount: finiteNumberOrNull(row.shortAccount),
      timestamp,
      sourceTimestamp: timestamp,
      periodStart: timestamp - DERIVATIVES_INTERVAL_MS,
      periodEnd: timestamp,
      availableAt: timestamp
    } satisfies TimedPositioning];
  });
}

export async function fetchTopTraderAccountHistory(symbol: string, options: DerivativesRequestOptions = {}) {
  return fetchTopTraderHistory(symbol, DERIVATIVES_PUBLIC_ENDPOINTS.topTraderAccount, options);
}

export async function fetchTopTraderPositionHistory(symbol: string, options: DerivativesRequestOptions = {}) {
  return fetchTopTraderHistory(symbol, DERIVATIVES_PUBLIC_ENDPOINTS.topTraderPosition, options);
}

async function fetchTopTraderHistory(symbol: string, endpoint: string, options: DerivativesRequestOptions) {
  const data = await requestJson<unknown[]>(endpoint, {
    symbol,
    period: DERIVATIVES_INTERVAL,
    limit: options.limit ?? DERIVATIVES_HISTORY_LIMIT
  }, options);
  return data.flatMap((item) => {
    const row = asRecord(item);
    const timestamp = finiteNumberOrNull(row.timestamp);
    if (timestamp === null) return [];
    return [{
      longShortRatio: finiteNumberOrNull(row.longShortRatio),
      longAccount: finiteNumberOrNull(row.longAccount),
      shortAccount: finiteNumberOrNull(row.shortAccount),
      timestamp,
      sourceTimestamp: timestamp,
      periodStart: timestamp - DERIVATIVES_INTERVAL_MS,
      periodEnd: timestamp,
      availableAt: timestamp
    } satisfies TimedTopTraderPositioning];
  });
}

export function buildDerivativesMetric(input: CollectionInput): DerivativesMetric {
  const metricTime = closedMetricTime(input.now);
  // metricTime is the period start; the represented closed candle becomes
  // available at metricTime + 5m. Every source is joined against that close
  // boundary rather than its provider timestamp alone. Period-end Binance
  // families are therefore eligible exactly at this boundary.
  const decisionTime = metricTime + DERIVATIVES_INTERVAL_MS;
  const oiRaw = latestAtOrBefore(input.openInterestHistory, decisionTime, (item) => observationAvailableAt(item, "open_interest"));
  const oi = isFreshObservation(oiRaw, "open_interest", decisionTime) ? oiRaw : null;
  const oiCurrentRaw = input.openInterest && observationAvailableAt(input.openInterest, "open_interest") <= decisionTime ? input.openInterest : null;
  const oiCurrent = isFreshObservation(oiCurrentRaw, "open_interest", decisionTime) ? oiCurrentRaw : null;
  const latestOpenInterest = oi?.openInterest ?? oiCurrent?.openInterest ?? null;
  const oiChanges = [5, 15, 60, 240].map((minutes) => {
    const previous = latestAtOrBefore(
      input.openInterestHistory,
      decisionTime - minutes * 60 * 1000,
      (item) => observationAvailableAt(item, "open_interest")
    );
    return latestOpenInterest !== null && previous && previous.openInterest > 0
      ? round((latestOpenInterest - previous.openInterest) / previous.openInterest * 100)
      : null;
  });
  const oiAcceleration = oiChanges[0] !== null && oiChanges[1] !== null
    ? round(oiChanges[0] - oiChanges[1] / 3)
    : null;

  const fundingRaw = latestAtOrBefore(input.fundingHistory, decisionTime, (item) => observationAvailableAt(item, "funding"));
  const funding = isFreshObservation(fundingRaw, "funding", decisionTime) ? fundingRaw : null;
  const priorFunding = funding
    ? latestAtOrBefore(input.fundingHistory, funding.fundingTime - 1, (item) => item.fundingTime, funding.fundingTime)
    : null;
  const premiumRaw = input.premiumIndex && observationAvailableAt(input.premiumIndex, "premium") <= decisionTime ? input.premiumIndex : null;
  const premium = isFreshObservation(premiumRaw, "funding", decisionTime) ? premiumRaw : null;
  const basisRaw = latestAtOrBefore(input.basisHistory, decisionTime, (item) => observationAvailableAt(item, "basis"));
  const basis = isFreshObservation(basisRaw, "basis", decisionTime) ? basisRaw : null;
  const priorBasis = basis
    ? latestAtOrBefore(input.basisHistory, basis.timestamp - 1, (item) => item.timestamp, basis.timestamp)
    : null;
  const takerRaw = latestAtOrBefore(input.takerHistory, decisionTime, (item) => observationAvailableAt(item, "taker_flow"));
  const taker = isFreshObservation(takerRaw, "taker_flow", decisionTime) ? takerRaw : null;
  const priorTaker = taker
    ? latestAtOrBefore(input.takerHistory, taker.timestamp - 1, (item) => item.timestamp, taker.timestamp)
    : null;
  const positioningRaw = latestAtOrBefore(input.globalLongShortHistory, decisionTime, (item) => observationAvailableAt(item, "positioning"));
  const positioning = isFreshObservation(positioningRaw, "positioning", decisionTime) ? positioningRaw : null;
  const priorPositioning = positioning
    ? latestAtOrBefore(input.globalLongShortHistory, positioning.timestamp - 1, (item) => item.timestamp, positioning.timestamp)
    : null;
  const topAccountRaw = latestAtOrBefore(input.topTraderAccountHistory ?? [], decisionTime, (item) => observationAvailableAt(item, "top_trader_account"));
  const topAccount = isFreshObservation(topAccountRaw, "top_trader_account", decisionTime) ? topAccountRaw : null;
  const topPositionRaw = latestAtOrBefore(input.topTraderPositionHistory ?? [], decisionTime, (item) => observationAvailableAt(item, "top_trader_position"));
  const topPosition = isFreshObservation(topPositionRaw, "top_trader_position", decisionTime) ? topPositionRaw : null;
  const priorTopAccount = topAccount
    ? latestAtOrBefore(input.topTraderAccountHistory ?? [], topAccount.timestamp - 1, (item) => item.timestamp, topAccount.timestamp)
    : null;
  const priorTopPosition = topPosition
    ? latestAtOrBefore(input.topTraderPositionHistory ?? [], topPosition.timestamp - 1, (item) => item.timestamp, topPosition.timestamp)
    : null;
  const priceReferenceIs5m = input.priceReference
    && (!input.priceReference.interval || input.priceReference.interval === DERIVATIVES_INTERVAL)
    && (input.priceReference.currentTime === undefined || input.priceReference.previousTime === undefined
      || input.priceReference.currentTime - input.priceReference.previousTime === DERIVATIVES_INTERVAL_MS)
    && (input.priceReference.currentTime === undefined || input.priceReference.currentTime <= decisionTime);
  const priceChange5m = priceReferenceIs5m
    && input.priceReference!.previous > 0
    ? round((input.priceReference!.current - input.priceReference!.previous) / input.priceReference!.previous * 100)
    : null;
  const takerImbalance = taker?.buyVolume !== null && taker?.buyVolume !== undefined && taker?.sellVolume !== null && taker?.sellVolume !== undefined
    ? round((taker.buyVolume - taker.sellVolume) / Math.max(taker.buyVolume + taker.sellVolume, Number.EPSILON))
    : null;
  const priorTakerImbalance = priorTaker?.buyVolume !== null && priorTaker?.buyVolume !== undefined && priorTaker?.sellVolume !== null && priorTaker?.sellVolume !== undefined
    ? (priorTaker.buyVolume - priorTaker.sellVolume) / Math.max(priorTaker.buyVolume + priorTaker.sellVolume, Number.EPSILON)
    : null;
  const premiumBps = premium?.markPrice !== null && premium?.markPrice !== undefined && premium?.indexPrice !== null && premium?.indexPrice !== undefined && premium.indexPrice > 0
    ? round((premium.markPrice / premium.indexPrice - 1) * 10_000)
    : null;
  const basisBps = basis?.basis !== null && basis?.basis !== undefined && basis?.indexPrice !== null && basis?.indexPrice !== undefined && basis.indexPrice > 0
    ? round(basis.basis / basis.indexPrice * 10_000)
    : basis?.basisRate !== null && basis?.basisRate !== undefined ? round(basis.basisRate * 10_000) : null;
  const priorBasisBps = priorBasis?.basis !== null && priorBasis?.basis !== undefined && priorBasis?.indexPrice !== null && priorBasis?.indexPrice !== undefined && priorBasis.indexPrice > 0
    ? priorBasis.basis / priorBasis.indexPrice * 10_000
    : priorBasis?.basisRate !== null && priorBasis?.basisRate !== undefined ? priorBasis.basisRate * 10_000 : null;
  const sourceTimestamps = [
    oi?.sourceTimestamp ?? oi?.timestamp,
    funding?.sourceTimestamp ?? funding?.fundingTime,
    premium?.sourceTimestamp ?? premium?.timestamp,
    basis?.sourceTimestamp ?? basis?.timestamp,
    taker?.sourceTimestamp ?? taker?.timestamp,
    positioning?.sourceTimestamp ?? positioning?.timestamp,
    topAccount?.sourceTimestamp ?? topAccount?.timestamp,
    topPosition?.sourceTimestamp ?? topPosition?.timestamp
  ].filter((value): value is number => value !== undefined && value !== null);
  const sourceTiming = {
    open_interest: sourceTimingFor(oiRaw, "open_interest", decisionTime),
    funding: sourceTimingFor(fundingRaw, "funding", decisionTime),
    basis: sourceTimingFor(basisRaw, "basis", decisionTime),
    taker_flow: sourceTimingFor(takerRaw, "taker_flow", decisionTime),
    positioning: sourceTimingFor(positioningRaw, "positioning", decisionTime),
    top_trader_account: sourceTimingFor(topAccountRaw, "top_trader_account", decisionTime),
    top_trader_position: sourceTimingFor(topPositionRaw, "top_trader_position", decisionTime)
  } satisfies Record<string, SourceTiming>;
  const fundingRate = premium?.fundingRate ?? funding?.fundingRate ?? null;
  const fundingValues = input.fundingHistory.filter((item) => observationAvailableAt(item, "funding") <= decisionTime).map((item) => item.fundingRate);
  const fundingPercentile = percentileRank(fundingRate, fundingValues);
  const basisAcceleration = basisBps !== null && priorBasisBps !== null ? round(basisBps - priorBasisBps) : null;
  const fundingExtremePositive = fundingPercentile === null ? null : fundingPercentile >= 95;
  const fundingExtremeNegative = fundingPercentile === null ? null : fundingPercentile <= 5;
  const priceFundingDivergence = priceChange5m !== null && fundingRate !== null ? round(priceChange5m * fundingRate) : null;
  const oiFundingInteraction = oiChanges[0] !== null && fundingRate !== null ? round(oiChanges[0] * fundingRate) : null;
  const priceBasisDivergence = priceChange5m !== null && basisBps !== null ? round(priceChange5m * basisBps) : null;
  const takerSellRatio = taker?.buyVolume !== null && taker?.buyVolume !== undefined && taker?.sellVolume !== null && taker?.sellVolume !== undefined
    ? round(taker.sellVolume / Math.max(taker.buyVolume + taker.sellVolume, Number.EPSILON))
    : null;
  const aggressiveFlowDivergence = priceChange5m !== null && takerImbalance !== null ? round(priceChange5m * takerImbalance) : null;
  const missingFields = [
    ["openInterest", latestOpenInterest],
    ["fundingRate", premium?.fundingRate ?? funding?.fundingRate ?? null],
    ["basisBps", basisBps],
    ["takerBuyRatio", taker?.buySellRatio ?? null],
    ["globalLongShortRatio", positioning?.longShortRatio ?? null],
    ["topAccountLongShortRatio", topAccount?.longShortRatio ?? null],
    ["topPositionLongShortRatio", topPosition?.longShortRatio ?? null],
    ["liquidationNotional", null]
  ].filter(([, value]) => value === null).map(([name]) => name);
  const endpointErrors = input.endpointErrors ?? [];
  const unavailableEndpoint = (endpoint: string) => endpointErrors.some((error) => error.endpoint === endpoint && error.message.includes("UNAVAILABLE_API_KEY_REQUIRED"));
  if (unavailableEndpoint(DERIVATIVES_PUBLIC_ENDPOINTS.topTraderAccount)) sourceTiming.top_trader_account = unavailableTiming();
  if (unavailableEndpoint(DERIVATIVES_PUBLIC_ENDPOINTS.topTraderPosition)) sourceTiming.top_trader_position = unavailableTiming();
  const sourceStatus = {
    openInterest: unavailableEndpoint(DERIVATIVES_PUBLIC_ENDPOINTS.openInterestHistory) || unavailableEndpoint(DERIVATIVES_PUBLIC_ENDPOINTS.openInterest)
      ? "UNAVAILABLE_API_KEY_REQUIRED" : !endpointErrors.some((error) => error.endpoint === DERIVATIVES_PUBLIC_ENDPOINTS.openInterestHistory || error.endpoint === DERIVATIVES_PUBLIC_ENDPOINTS.openInterest),
    funding: !endpointErrors.some((error) => error.endpoint === DERIVATIVES_PUBLIC_ENDPOINTS.fundingHistory),
    basis: !endpointErrors.some((error) => error.endpoint === DERIVATIVES_PUBLIC_ENDPOINTS.basis),
    takerFlow: !endpointErrors.some((error) => error.endpoint === DERIVATIVES_PUBLIC_ENDPOINTS.takerFlow),
    globalLongShort: !endpointErrors.some((error) => error.endpoint === DERIVATIVES_PUBLIC_ENDPOINTS.globalLongShort),
    topTraderAccount: unavailableEndpoint(DERIVATIVES_PUBLIC_ENDPOINTS.topTraderAccount)
      ? "UNAVAILABLE_API_KEY_REQUIRED" : !endpointErrors.some((error) => error.endpoint === DERIVATIVES_PUBLIC_ENDPOINTS.topTraderAccount),
    topTraderPosition: unavailableEndpoint(DERIVATIVES_PUBLIC_ENDPOINTS.topTraderPosition)
      ? "UNAVAILABLE_API_KEY_REQUIRED" : !endpointErrors.some((error) => error.endpoint === DERIVATIVES_PUBLIC_ENDPOINTS.topTraderPosition),
    liquidation: "insufficient_historical_public_data"
  };

  return {
    symbol: input.symbol,
    interval: DERIVATIVES_INTERVAL,
    metricTime,
    openInterest: latestOpenInterest,
    openInterestValue: oi?.openInterestValue ?? null,
    oiChange5m: oiChanges[0],
    oiChange15m: oiChanges[1],
    oiChange1h: oiChanges[2],
    oiChange4h: oiChanges[3],
    oiAcceleration,
    oiPercentile: percentileRank(latestOpenInterest, input.openInterestHistory
      .filter((item) => observationAvailableAt(item, "open_interest") <= decisionTime)
      .map((item) => item.openInterest)),
    fundingRate,
    lastSettledFunding: funding?.fundingRate ?? null,
    fundingPercentile,
    fundingZScore: zScore(funding?.fundingRate ?? null, input.fundingHistory
      .filter((item) => observationAvailableAt(item, "funding") <= decisionTime)
      .map((item) => item.fundingRate)),
    fundingAcceleration: funding && priorFunding ? round(funding.fundingRate - priorFunding.fundingRate) : null,
    fundingExtremePositive,
    fundingExtremeNegative,
    priceFundingDivergence,
    oiFundingInteraction,
    nextFundingTime: premium?.nextFundingTime ?? null,
    perpetualPremiumBps: premiumBps,
    basisBps,
    basisRate: basis?.basisRate ?? null,
    basisAcceleration,
    basisPercentile: percentileRank(basisBps, input.basisHistory
      .filter((item) => observationAvailableAt(item, "basis") <= decisionTime)
      .map((item) => {
      if (item.basis !== null && item.indexPrice && item.indexPrice > 0) return item.basis / item.indexPrice * 10_000;
      return item.basisRate !== null ? item.basisRate * 10_000 : null;
    }).filter((value): value is number => value !== null)),
    basisExpansion: basisAcceleration === null ? null : basisAcceleration > 0,
    basisContraction: basisAcceleration === null ? null : basisAcceleration < 0,
    priceBasisDivergence,
    takerBuyRatio: taker?.buySellRatio ?? null,
    takerSellRatio,
    takerImbalance,
    takerAcceleration: takerImbalance !== null && priorTakerImbalance !== null ? round(takerImbalance - priorTakerImbalance) : null,
    aggressiveFlowDivergence,
    globalLongShortRatio: positioning?.longShortRatio ?? null,
    globalLongShortChange: positioning && priorPositioning && positioning.longShortRatio !== null && priorPositioning.longShortRatio !== null
      ? round(positioning.longShortRatio - priorPositioning.longShortRatio)
      : null,
    topAccountLongShortRatio: topAccount?.longShortRatio ?? null,
    topPositionLongShortRatio: topPosition?.longShortRatio ?? null,
    topAccountLongShortChange: topAccount && priorTopAccount && topAccount.longShortRatio !== null && priorTopAccount.longShortRatio !== null
      ? round(topAccount.longShortRatio - priorTopAccount.longShortRatio) : null,
    topPositionLongShortChange: topPosition && priorTopPosition && topPosition.longShortRatio !== null && priorTopPosition.longShortRatio !== null
      ? round(topPosition.longShortRatio - priorTopPosition.longShortRatio) : null,
    positioningDivergence: topAccount?.longShortRatio !== null && topAccount?.longShortRatio !== undefined && topPosition?.longShortRatio !== null && topPosition?.longShortRatio !== undefined
      ? round(topAccount.longShortRatio - topPosition.longShortRatio) : null,
    liquidationNotional: null,
    priceChange5m,
    priceOiState: classifyPriceOiState(priceChange5m, oiChanges[0]),
    sourceTimestamp: sourceTimestamps.length > 0 ? Math.min(...sourceTimestamps) : null,
    periodStart: metricTime,
    periodEnd: decisionTime,
    availableAt: decisionTime,
    sourceAgeMs: Object.values(sourceTiming).map((timing) => timing.sourceAgeMs).filter((value): value is number => value !== null).reduce((max, value) => Math.max(max, value), 0) || null,
    fetchedAt: input.now,
    sourceEndpoint: Object.values(DERIVATIVES_PUBLIC_ENDPOINTS).join(","),
    sourceVersion: DERIVATIVES_SOURCE_VERSION,
    dataQualityFlags: {
      pointInTime: true,
      closedPeriod: metricTime < input.now,
      futureObservationsExcluded: true,
      sourceStatus,
      sourceTiming,
      staleFamilies: Object.entries(sourceTiming).filter(([, timing]) => timing.stale).map(([family]) => family),
      priceReference: {
        interval: input.priceReference?.interval ?? null,
        currentTime: input.priceReference?.currentTime ?? null,
        previousTime: input.priceReference?.previousTime ?? null,
        valid: Boolean(priceReferenceIs5m),
        source: "Binance USD-M /fapi/v1/klines interval=5m closed candles"
      },
      missingFields,
      endpointErrors,
      revisionRisk: {
        openInterestHistory: "provider_limited_recent_window",
        fundingHistory: "provider_history_may_be_revised_or_rate_type_changed",
        positioning: "provider_limited_recent_window",
        liquidation: "no_historical_public_rest_backfill"
      },
      topTraderPositioning: {
        account: topAccount ? "market_data_api_key" : "unavailable",
        position: topPosition ? "market_data_api_key" : "unavailable"
      },
      liquidation: "INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA"
    }
  };
}

export async function collectDerivativesMetrics(
  symbols: string[],
  options: DerivativesRequestOptions & { now?: number; priceReferences?: Record<string, PriceReference> } = {}
): Promise<DerivativesCollectionResult> {
  const now = options.now ?? Date.now();
  const endpointStatus: DerivativesCollectionResult["endpointStatus"] = {};
  const errors: DerivativesCollectionResult["errors"] = [];
  const rows = await Promise.all(symbols.map(async (symbol) => {
    const jobs: Array<[string, () => Promise<unknown>]> = [
      [DERIVATIVES_PUBLIC_ENDPOINTS.openInterest, () => fetchCurrentOpenInterest(symbol, options)],
      [DERIVATIVES_PUBLIC_ENDPOINTS.openInterestHistory, () => fetchOpenInterestHistory(symbol, options)],
      [DERIVATIVES_PUBLIC_ENDPOINTS.premiumIndex, () => fetchPremiumIndex(symbol, options)],
      [DERIVATIVES_PUBLIC_ENDPOINTS.fundingHistory, () => fetchFundingHistory(symbol, options)],
      [DERIVATIVES_PUBLIC_ENDPOINTS.basis, () => fetchBasisHistory(symbol, options)],
      [DERIVATIVES_PUBLIC_ENDPOINTS.takerFlow, () => fetchTakerFlowHistory(symbol, options)],
      [DERIVATIVES_PUBLIC_ENDPOINTS.globalLongShort, () => fetchGlobalLongShortHistory(symbol, options)],
      [DERIVATIVES_PUBLIC_ENDPOINTS.topTraderAccount, () => fetchTopTraderAccountHistory(symbol, options)],
      [DERIVATIVES_PUBLIC_ENDPOINTS.topTraderPosition, () => fetchTopTraderPositionHistory(symbol, options)]
    ];
    const settled = await Promise.all(jobs.map(async ([endpoint, job]) => {
      try {
        const value = await job();
        const observations = Array.isArray(value) ? value.length : value ? 1 : 0;
        endpointStatus[endpoint] = endpointStatus[endpoint] ?? { ok: 0, failed: 0, observations: 0 };
        endpointStatus[endpoint].ok += 1;
        endpointStatus[endpoint].observations += observations;
        return { endpoint, value, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        endpointStatus[endpoint] = endpointStatus[endpoint] ?? { ok: 0, failed: 0, observations: 0 };
        endpointStatus[endpoint].failed += 1;
        errors.push({ symbol, endpoint, message });
        return { endpoint, value: null, error: message };
      }
    }));
    const value = new Map(settled.map((item) => [item.endpoint, item.value]));
    return buildDerivativesMetric({
      symbol,
      now,
      priceReference: options.priceReferences?.[symbol],
      openInterest: (value.get(DERIVATIVES_PUBLIC_ENDPOINTS.openInterest) as CurrentOpenInterest | null) ?? null,
      openInterestHistory: (value.get(DERIVATIVES_PUBLIC_ENDPOINTS.openInterestHistory) as TimedOpenInterest[] | null) ?? [],
      premiumIndex: (value.get(DERIVATIVES_PUBLIC_ENDPOINTS.premiumIndex) as PremiumIndex | null) ?? null,
      fundingHistory: (value.get(DERIVATIVES_PUBLIC_ENDPOINTS.fundingHistory) as TimedFunding[] | null) ?? [],
      basisHistory: (value.get(DERIVATIVES_PUBLIC_ENDPOINTS.basis) as TimedBasis[] | null) ?? [],
      takerHistory: (value.get(DERIVATIVES_PUBLIC_ENDPOINTS.takerFlow) as TimedTakerFlow[] | null) ?? [],
      globalLongShortHistory: (value.get(DERIVATIVES_PUBLIC_ENDPOINTS.globalLongShort) as TimedPositioning[] | null) ?? [],
      topTraderAccountHistory: (value.get(DERIVATIVES_PUBLIC_ENDPOINTS.topTraderAccount) as TimedTopTraderPositioning[] | null) ?? [],
      topTraderPositionHistory: (value.get(DERIVATIVES_PUBLIC_ENDPOINTS.topTraderPosition) as TimedTopTraderPositioning[] | null) ?? [],
      endpointErrors: settled.filter((item) => item.error).map((item) => ({ endpoint: item.endpoint, message: item.error! }))
    });
  }));

  return { rows, attemptedSymbols: [...symbols], endpointStatus, errors };
}

export function toDerivativesMetricRow(metric: DerivativesMetric) {
  return {
    symbol: metric.symbol,
    interval: metric.interval,
    metric_time: new Date(metric.metricTime).toISOString(),
    open_interest: metric.openInterest,
    open_interest_value: metric.openInterestValue,
    oi_change_5m: metric.oiChange5m,
    oi_change_15m: metric.oiChange15m,
    oi_change_1h: metric.oiChange1h,
    oi_change_4h: metric.oiChange4h,
    oi_acceleration: metric.oiAcceleration,
    oi_percentile: metric.oiPercentile,
    funding_rate: metric.fundingRate,
    last_settled_funding: metric.lastSettledFunding,
    funding_percentile: metric.fundingPercentile,
    funding_z_score: metric.fundingZScore,
    funding_acceleration: metric.fundingAcceleration,
    funding_extreme_positive: metric.fundingExtremePositive,
    funding_extreme_negative: metric.fundingExtremeNegative,
    price_funding_divergence: metric.priceFundingDivergence,
    oi_funding_interaction: metric.oiFundingInteraction,
    next_funding_time: metric.nextFundingTime === null ? null : new Date(metric.nextFundingTime).toISOString(),
    perpetual_premium_bps: metric.perpetualPremiumBps,
    basis_bps: metric.basisBps,
    basis_rate: metric.basisRate,
    basis_acceleration: metric.basisAcceleration,
    basis_percentile: metric.basisPercentile,
    basis_expansion: metric.basisExpansion,
    basis_contraction: metric.basisContraction,
    price_basis_divergence: metric.priceBasisDivergence,
    taker_buy_ratio: metric.takerBuyRatio,
    taker_sell_ratio: metric.takerSellRatio,
    taker_imbalance: metric.takerImbalance,
    taker_acceleration: metric.takerAcceleration,
    aggressive_flow_divergence: metric.aggressiveFlowDivergence,
    global_long_short_ratio: metric.globalLongShortRatio,
    global_long_short_change: metric.globalLongShortChange,
    top_account_long_short_ratio: metric.topAccountLongShortRatio,
    top_position_long_short_ratio: metric.topPositionLongShortRatio,
    top_account_long_short_change: metric.topAccountLongShortChange,
    top_position_long_short_change: metric.topPositionLongShortChange,
    positioning_divergence: metric.positioningDivergence,
    liquidation_notional: metric.liquidationNotional,
    price_change_5m: metric.priceChange5m,
    price_oi_state: metric.priceOiState,
    source_timestamp: metric.sourceTimestamp === null ? null : new Date(metric.sourceTimestamp).toISOString(),
    period_start: metric.periodStart === null ? null : new Date(metric.periodStart).toISOString(),
    period_end: metric.periodEnd === null ? null : new Date(metric.periodEnd).toISOString(),
    available_at: metric.availableAt === null ? null : new Date(metric.availableAt).toISOString(),
    source_age_ms: metric.sourceAgeMs,
    fetched_at: new Date(metric.fetchedAt).toISOString(),
    data_quality_flags: metric.dataQualityFlags,
    source_endpoint: metric.sourceEndpoint,
    source_version: metric.sourceVersion
  };
}

export function closedMetricTime(now: number) {
  return Math.floor((now - DERIVATIVES_INTERVAL_MS) / DERIVATIVES_INTERVAL_MS) * DERIVATIVES_INTERVAL_MS;
}

export function selectPointInTime<T>(rows: T[], asOf: number, getTimestamp: (row: T) => number) {
  return rows
    .filter((row) => getTimestamp(row) <= asOf)
    .sort((a, b) => getTimestamp(a) - getTimestamp(b))
    .at(-1) ?? null;
}

export function classifyPriceOiState(priceChangePct: number | null, oiChangePct: number | null) {
  if (priceChangePct === null || oiChangePct === null) return null;
  if (priceChangePct >= 0 && oiChangePct >= 0) return "price_up_oi_up";
  if (priceChangePct >= 0 && oiChangePct < 0) return "price_up_oi_down";
  if (priceChangePct < 0 && oiChangePct >= 0) return "price_down_oi_up";
  return "price_down_oi_down";
}

type TimedObservation = {
  timestamp?: number;
  fundingTime?: number;
  sourceTimestamp?: number;
  periodStart?: number | null;
  periodEnd?: number | null;
  availableAt?: number | null;
};

type TimingFamily = keyof typeof DERIVATIVES_FAMILY_FRESHNESS_TOLERANCE_MS | "premium";

export function observationAvailableAt(row: TimedObservation | null | undefined, family: TimingFamily) {
  if (!row) return Number.NEGATIVE_INFINITY;
  if (Number.isFinite(row.availableAt)) return row.availableAt!;
  const timestamp = row.sourceTimestamp ?? row.timestamp ?? row.fundingTime;
  if (!Number.isFinite(timestamp)) return Number.NEGATIVE_INFINITY;
  if (family === "funding" || family === "liquidation" || family === "premium"
    || isPeriodEndTimestampFamily(family)) return timestamp!;
  return timestamp! + DERIVATIVES_INTERVAL_MS;
}

export function isPeriodEndTimestampFamily(family: string): family is typeof DERIVATIVES_PERIOD_END_TIMESTAMP_FAMILIES[number] {
  return (DERIVATIVES_PERIOD_END_TIMESTAMP_FAMILIES as readonly string[]).includes(family);
}

export function observationSourceTimestamp(row: TimedObservation | null | undefined) {
  if (!row) return null;
  const value = row.sourceTimestamp ?? row.timestamp ?? row.fundingTime;
  return Number.isFinite(value) ? value! : null;
}

export function sourceTimingFor(
  row: TimedObservation | null | undefined,
  family: keyof typeof DERIVATIVES_FAMILY_FRESHNESS_TOLERANCE_MS,
  decisionTime: number
): SourceTiming {
  if (!row) return { sourceTimestamp: null, periodStart: null, periodEnd: null, availableAt: null, sourceAgeMs: null, stale: false, status: "MISSING" };
  const sourceTimestamp = observationSourceTimestamp(row);
  const periodStart = row.periodStart === undefined
    ? family === "funding" ? null : sourceTimestamp === null ? null : isPeriodEndTimestampFamily(family) ? sourceTimestamp - DERIVATIVES_INTERVAL_MS : sourceTimestamp
    : row.periodStart;
  const periodEnd = row.periodEnd === undefined
    ? (family === "funding" ? sourceTimestamp : sourceTimestamp === null ? null : isPeriodEndTimestampFamily(family) ? sourceTimestamp : sourceTimestamp + DERIVATIVES_INTERVAL_MS)
    : row.periodEnd;
  const availableAt = observationAvailableAt(row, family);
  const sourceAgeMs = Number.isFinite(availableAt) ? Math.max(0, decisionTime - availableAt) : null;
  const stale = sourceAgeMs !== null && sourceAgeMs > DERIVATIVES_FAMILY_FRESHNESS_TOLERANCE_MS[family];
  return {
    sourceTimestamp,
    periodStart: periodStart ?? null,
    periodEnd: periodEnd ?? null,
    availableAt: Number.isFinite(availableAt) ? availableAt : null,
    sourceAgeMs,
    stale,
    status: stale ? "STALE_SOURCE_DATA" : "FRESH"
  };
}

export function isFreshObservation<T extends TimedObservation>(row: T | null | undefined, family: keyof typeof DERIVATIVES_FAMILY_FRESHNESS_TOLERANCE_MS, decisionTime: number) {
  const timing = sourceTimingFor(row, family, decisionTime);
  return timing.status === "FRESH" && timing.availableAt !== null && timing.availableAt <= decisionTime;
}

function unavailableTiming(): SourceTiming {
  return { sourceTimestamp: null, periodStart: null, periodEnd: null, availableAt: null, sourceAgeMs: null, stale: false, status: "UNAVAILABLE_API_KEY_REQUIRED" };
}

async function requestJson<T>(endpoint: string, params: Record<string, string | number>, options: DerivativesRequestOptions) {
  const url = new URL(endpoint, options.baseUrl || process.env.BINANCE_FUTURES_BASE_URL || DEFAULT_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const requiresMarketDataKey = DERIVATIVES_MARKET_DATA_KEY_ENDPOINTS.includes(endpoint as typeof DERIVATIVES_MARKET_DATA_KEY_ENDPOINTS[number]);
  const marketDataApiKey = process.env.BINANCE_MARKET_DATA_API_KEY?.trim();
  if (requiresMarketDataKey && !marketDataApiKey) throw new Error("UNAVAILABLE_API_KEY_REQUIRED");
  const headers: Record<string, string> = {};
  if (requiresMarketDataKey && marketDataApiKey) headers[MARKET_DATA_KEY_HEADER] = marketDataApiKey;
  const response = await (options.fetchImpl ?? fetch)(url, { cache: "no-store", ...(Object.keys(headers).length ? { headers } : {}) });
  if (!response.ok) throw new Error(`${endpoint} failed: ${response.status} ${response.statusText}`);
  return await response.json() as T;
}

function latestAtOrBefore<T>(rows: T[], timestamp: number, getTimestamp: (row: T) => number, excludeTimestamp?: number) {
  return rows
    .filter((row) => getTimestamp(row) <= timestamp && getTimestamp(row) !== excludeTimestamp)
    .sort((a, b) => getTimestamp(a) - getTimestamp(b))
    .at(-1) ?? null;
}

function percentileRank(value: number | null, history: number[]) {
  if (value === null || history.length < 2) return null;
  const sorted = history.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  return round(sorted.filter((item) => item <= value).length / sorted.length * 100);
}

function zScore(value: number | null, history: number[]) {
  const finite = history.filter(Number.isFinite);
  if (value === null || finite.length < 2) return null;
  const mean = finite.reduce((sum, item) => sum + item, 0) / finite.length;
  const variance = finite.reduce((sum, item) => sum + (item - mean) ** 2, 0) / finite.length;
  const standardDeviation = Math.sqrt(variance);
  return standardDeviation > 0 ? round((value - mean) / standardDeviation) : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown) {
  const result = finiteNumberOrNull(value);
  if (result === null) throw new Error("Binance response contained a non-numeric value");
  return result;
}

function finiteNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
