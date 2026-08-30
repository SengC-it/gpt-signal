import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DERIVATIVES_ENDPOINT_AUDIT,
  DERIVATIVES_ENDPOINT_CAPABILITIES,
  DERIVATIVES_MARKET_DATA_KEY_ENDPOINTS,
  DERIVATIVES_SOURCE_VERSION,
  DERIVATIVES_INTERVAL_MS,
  DERIVATIVES_PERIOD_END_TIMESTAMP_FAMILIES
} from "../src/lib/binance/derivatives.ts";

const SYMBOLS = (process.env.GPT_PROFIT_004_SYMBOLS?.split(",").map((item) => item.trim()).filter(Boolean).length
  ? process.env.GPT_PROFIT_004_SYMBOLS.split(",").map((item) => item.trim()).filter(Boolean)
  : ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"]);
const BASE_URL = process.env.BINANCE_FUTURES_BASE_URL || "https://fapi.binance.com";
const INTERVAL_MS = 5 * 60 * 1000;
const END_TIME = Number(process.env.GPT_PROFIT_004_END_TIME || Math.floor(Date.now() / INTERVAL_MS) * INTERVAL_MS - INTERVAL_MS);
const LOOKBACK_DAYS = Number(process.env.GPT_PROFIT_004_LOOKBACK_DAYS || 30);
const START_TIME = Number(process.env.GPT_PROFIT_004_START_TIME || END_TIME - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
const PAGE_LIMIT = 500;
const MAX_PAGES = Number(process.env.GPT_PROFIT_004_MAX_PAGES || Math.ceil((LOOKBACK_DAYS * 24 * 60) / (5 * PAGE_LIMIT)));
const REUSE_CACHE = process.env.GPT_PROFIT_004_REUSE_CACHE === "1";
const REQUESTED_FAMILIES = new Set((process.env.GPT_PROFIT_004_FAMILIES || "").split(",").map((item) => item.trim()).filter(Boolean));
const MARKET_DATA_API_KEY = process.env.BINANCE_MARKET_DATA_API_KEY?.trim() || null;
const MARKET_DATA_KEY_HEADER = ["X-MBX", "APIKEY"].join("-");
const REPORT_DIR = path.join(process.cwd(), "reports");
const CACHE_DIR = path.join(process.cwd(), ".cache", "gpt-profit-004");
const MANIFEST_PATH = path.join(REPORT_DIR, "GPT-PROFIT-004-DATA-MANIFEST.json");
const MANIFEST_HASH_PATH = path.join(REPORT_DIR, "GPT-PROFIT-004-DATA-MANIFEST.sha256");
const AUDIT_PATH = path.join(REPORT_DIR, "GPT-PROFIT-004-DATA-AVAILABILITY.md");
const execFileAsync = promisify(execFile);

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

const SOURCE_SPECS = [
  source("open_interest_current", DERIVATIVES_ENDPOINT_AUDIT.openInterest, false, "ANONYMOUS_PUBLIC", "current snapshot only", 1, "request", "weight 1", "server timestamp", "not historical-safe", "none"),
  source("open_interest", DERIVATIVES_ENDPOINT_AUDIT.openInterestHistory, true, "ANONYMOUS_PUBLIC", "latest 1 month", 500, "5m", "1000 IP weight units / 5m; public data limit", "period end; available at endpoint timestamp", "yes; provider window only; revisions possible", "backward"),
  source("premium_index_current", DERIVATIVES_ENDPOINT_AUDIT.premiumIndex, false, "ANONYMOUS_PUBLIC", "current snapshot only", 1, "request", "weight 1", "server timestamp", "not historical-safe", "none"),
  source("funding", DERIVATIVES_ENDPOINT_AUDIT.fundingHistory, true, "ANONYMOUS_PUBLIC", "provider history; no guaranteed long-term archive", 1000, "event / typically 8h", "500 / 5m IP shared with fundingInfo", "fundingTime settlement; available at fundingTime", "yes for settled event; rateType/revisions must be retained", "forward"),
  source("basis", DERIVATIVES_ENDPOINT_AUDIT.basis, true, "ANONYMOUS_PUBLIC", "latest 30 days", 500, "5m", "weight 0; IP limits apply", "period start; available at timestamp + 5m", "yes; provider window and contract roll risk", "forward"),
  source("taker_flow", DERIVATIVES_ENDPOINT_AUDIT.takerFlow, true, "ANONYMOUS_PUBLIC", "latest 30 days", 500, "5m", "1000 IP requests / 5m", "period start; available at timestamp + 5m", "yes; provider window and revision risk", "backward"),
  source("positioning", DERIVATIVES_ENDPOINT_AUDIT.globalLongShort, true, "ANONYMOUS_PUBLIC", "latest 30 days", 500, "5m", "1000 IP requests / 5m", "period end; available at endpoint timestamp", "yes; global account ratio only", "backward"),
  source("top_trader_account", DERIVATIVES_ENDPOINT_AUDIT.topTraderAccount, true, "MARKET_DATA_API_KEY", "latest 30 days", 500, "5m", "1000 IP requests / 5m", "period end; available at endpoint timestamp", "yes; provider window and revision risk", "backward"),
  source("top_trader_position", DERIVATIVES_ENDPOINT_AUDIT.topTraderPosition, true, "MARKET_DATA_API_KEY", "latest 30 days", 500, "5m", "1000 IP requests / 5m", "period end; available at endpoint timestamp", "yes; provider window and revision risk", "backward"),
  source("liquidation", DERIVATIVES_ENDPOINT_AUDIT.liquidation, true, "ANONYMOUS_PUBLIC", "no public historical REST backfill; websocket forward-only", null, "event stream", "websocket connection limits", "event time; available on receipt", "forward only; no safe historical backtest", "none")
];

const familyCoverage = {};
const errors = [];
for (const spec of SOURCE_SPECS.filter((item) => item.collectable && (!REQUESTED_FAMILIES.size || REQUESTED_FAMILIES.has(item.family)))) {
  familyCoverage[spec.family] = {};
  const results = await Promise.all(SYMBOLS.map(async (symbol) => {
    if (spec.family === "liquidation") return { symbol, coverage: emptyCoverage(spec, symbol, "INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA"), error: null };
    return { symbol, ...(REUSE_CACHE ? reuseCached(spec, symbol) : await backfill(spec, symbol)) };
  }));
  for (const result of results) {
    familyCoverage[spec.family][result.symbol] = result.coverage;
    if (result.error) errors.push({ family: spec.family, symbol: result.symbol, error: result.error });
  }
}

const allCoverage = Object.values(familyCoverage).flatMap((family) => Object.values(family));
const populated = allCoverage.filter((item) => item.observations > 0);
const earliest = populated.length ? Math.min(...populated.map((item) => Date.parse(item.start))) : null;
const latest = populated.length ? Math.max(...populated.map((item) => Date.parse(item.end))) : null;
const observedStarts = populated.map((item) => Date.parse(item.start));
const observedEnds = populated.map((item) => Date.parse(item.end));
const commonStart = observedStarts.length ? Math.max(...observedStarts) : null;
const commonEnd = observedEnds.length ? Math.min(...observedEnds) : null;
const commonDays = commonStart !== null && commonEnd !== null ? Math.max(0, (commonEnd - commonStart) / 86_400_000) : 0;
const familyCoverageSummaries = Object.fromEntries(Object.entries(familyCoverage).map(([family, values]) => [family, summarizeFamilyCoverage(family, Object.values(values))]));
const familyCoverageDays = Object.fromEntries(Object.entries(familyCoverageSummaries).map(([family, summary]) => [family, summary.calendarCoverageDays]));
const combinedCoverageDays = summarizeFamilyCoverage("combined", Object.values(familyCoverage).flatMap((values) => Object.values(values))).calendarCoverageDays;
const files = populated.map((item) => item.fileSha256).filter(Boolean).sort();
const datasetHash = sha256(files.join("\n"));
const totalExpected = allCoverage.reduce((sum, item) => sum + (item.expectedObservations ?? 0), 0);
const totalObserved = allCoverage.reduce((sum, item) => sum + item.observations, 0);
const gridObserved = allCoverage.reduce((sum, item) => sum + (item.expectedObservations === null ? 0 : item.observations), 0);
const consolidatedMetricKeys = new Set();
for (const item of populated) {
  if (!item.file) continue;
  try {
    const rows = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), item.file), "utf8"));
    for (const row of Array.isArray(rows) ? rows : []) if (Number.isFinite(Number(row.timestamp))) consolidatedMetricKeys.add(`${item.symbol}:${row.timestamp}`);
  } catch { /* coverage already records the source file status */ }
}
const manifest = {
  task: "GPT-PROFIT-004 — Derivatives Edge Data Foundation",
  schemaVersion: "gpt-profit-004-data-manifest-v2",
  generatedAt: new Date().toISOString(),
  sourceVersion: DERIVATIVES_SOURCE_VERSION,
  baseUrl: BASE_URL,
  requestedWindow: { start: iso(START_TIME), end: iso(END_TIME), lookbackDays: LOOKBACK_DAYS },
  backfill: { pageLimit: PAGE_LIMIT, maxPagesPerSymbolFamily: MAX_PAGES, noInterpolation: true, noFuturePercentiles: true },
  symbols: SYMBOLS,
  sourceSpecs: SOURCE_SPECS,
  endpointCapabilities: DERIVATIVES_ENDPOINT_CAPABILITIES,
  privateEndpointsUsed: false,
  privateEndpointFamilies: [],
  anonymousPublicFamilies: SOURCE_SPECS.filter((spec) => spec.classification === "ANONYMOUS_PUBLIC").map((spec) => spec.family),
  marketDataKeyFamilies: SOURCE_SPECS.filter((spec) => spec.classification === "MARKET_DATA_API_KEY").map((spec) => spec.family),
  marketDataApiKeyConfigured: Boolean(MARKET_DATA_API_KEY),
  familyCoverage,
  familyCoverageSummaries,
  familyCoverageDays,
  combinedCoverageDays: round(combinedCoverageDays),
  totalRows: totalObserved,
  consolidatedMetricRows: consolidatedMetricKeys.size,
  totalExpectedRows: totalExpected,
  missingDataRatio: totalExpected ? round(Math.max(0, totalExpected - gridObserved) / totalExpected) : null,
  earliestMetricTime: earliest === null ? null : iso(earliest),
  latestMetricTime: latest === null ? null : iso(latest),
  commonMetricWindow: { start: commonStart === null ? null : iso(commonStart), end: commonEnd === null ? null : iso(commonEnd) },
  // Retained as a descriptive intersection only. Research gates use each
  // family's own coverageDays and the selected-family intersection.
  historicalCoverageDays: round(commonDays),
  historicalCoverageAtLeast90d: commonDays >= 90,
  coverageMethod: "family-specific; global common window is descriptive only",
  sourceGapInvestigations: {
    DOGEUSDT_basis: {
      status: "SOURCE_GAP_UNRESOLVED",
      observedGap: !familyCoverage.basis?.DOGEUSDT?.end || Date.parse(familyCoverage.basis.DOGEUSDT.end) < END_TIME,
      latestObserved: familyCoverage.basis?.DOGEUSDT?.end ?? null,
      note: !familyCoverage.basis?.DOGEUSDT?.end || Date.parse(familyCoverage.basis.DOGEUSDT.end) < END_TIME
        ? "The provider window ends before the requested end. No interpolation or indefinite forward-fill is used; root cause requires provider-side confirmation."
        : "The earlier truncation was not reproduced on the fixed-window refresh; the provider returned observations through the requested end. The historical cause of the prior gap remains unresolved."
    }
  },
  datasetHash,
  errors,
  prohibitedSources: ["private Binance API", "account API", "position API", "user trade API", "liquidation REST history without reliable public PIT data"],
  databasePersistence: "migration included in Draft PR; not applied to Production"
};
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
const manifestSha = sha256(fs.readFileSync(MANIFEST_PATH));
fs.writeFileSync(MANIFEST_HASH_PATH, `${manifestSha}  ${path.basename(MANIFEST_PATH)}\n`);
fs.writeFileSync(AUDIT_PATH, renderAudit(manifest));
console.log(JSON.stringify({ manifest: path.relative(process.cwd(), MANIFEST_PATH), manifestSha256: manifestSha, totalRows: totalObserved, historicalCoverageDays: commonDays, familyCoverageDays, errors: errors.length }, null, 2));

function source(family, endpoint, collectable, classification, historicalLookback, maxLimit, interval, rateLimit, pointInTime, backtest, pagination) {
  const apiKeyRequired = classification === "MARKET_DATA_API_KEY";
  return {
    family,
    endpoint,
    officialUrl: endpoint.startsWith("http") ? endpoint : `${BASE_URL}${endpoint.startsWith("/") ? endpoint : ""}`,
    public: classification !== "PRIVATE",
    anonymousPublic: classification === "ANONYMOUS_PUBLIC",
    classification,
    apiKeyRequired,
    collectable,
    historicalLookback,
    maxLimit,
    samplingInterval: interval,
    symbols: SYMBOLS,
    rateLimit,
    pointInTime,
    safeForBacktest: backtest.startsWith("yes"),
    pagination,
    survivorshipRisk: "symbol universe is fixed to currently configured symbols; delisted contracts are not inferred",
    revisionRisk: backtest.includes("provider") || backtest.includes("window") ? "provider-limited history / possible revisions; retain source timestamps" : backtest
  };
}

async function backfill(spec, symbol) {
  if (spec.apiKeyRequired && !MARKET_DATA_API_KEY) {
    const cachePath = path.join(CACHE_DIR, `${symbol}-${spec.family}.json`);
    fs.writeFileSync(cachePath, "[]\n");
    return { coverage: emptyCoverage(spec, symbol, "UNAVAILABLE_API_KEY_REQUIRED"), error: null };
  }
  const observations = [];
  const backward = spec.pagination === "backward";
  let cursor = backward ? END_TIME : START_TIME;
  let error = null;
  for (let page = 0; page < MAX_PAGES && cursor <= END_TIME; page += 1) {
    const params = sourceParams(spec.family, symbol, cursor, END_TIME, backward);
    try {
      const data = await requestWithRetry(spec.endpoint, params);
      const normalized = normalize(spec.family, data).filter((row) => row.timestamp >= START_TIME && row.timestamp <= END_TIME);
      if (process.env.GPT_PROFIT_004_DEBUG === "1") console.error(`${spec.family}/${symbol}: raw=${Array.isArray(data) ? data.length : typeof data} normalized=${normalized.length} start=${START_TIME} end=${END_TIME}`);
      if (!normalized.length) break;
      observations.push(...normalized);
      const boundary = backward ? Math.min(...normalized.map((row) => row.timestamp)) : Math.max(...normalized.map((row) => row.timestamp));
      if (!Number.isFinite(boundary)) break;
      if (backward) {
        if (boundary <= START_TIME) break;
        cursor = boundary - (spec.family === "funding" ? 1 : INTERVAL_MS);
      } else {
        if (boundary >= END_TIME) break;
        cursor = boundary + (spec.family === "funding" ? 1 : INTERVAL_MS);
      }
      if (normalized.length < (spec.maxLimit ?? PAGE_LIMIT)) break;
      await new Promise((resolve) => setTimeout(resolve, 80));
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      break;
    }
  }
  const deduped = [...new Map(observations.map((row) => [row.timestamp, row])).values()].sort((left, right) => left.timestamp - right.timestamp);
  const cachePath = path.join(CACHE_DIR, `${symbol}-${spec.family}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(deduped, null, 2) + "\n");
  const coverage = buildCoverage(spec, symbol, deduped, observations.length - deduped.length, cachePath, error);
  return { coverage, error };
}

function reuseCached(spec, symbol) {
  const cachePath = path.join(CACHE_DIR, `${symbol}-${spec.family}.json`);
  if (spec.apiKeyRequired && !MARKET_DATA_API_KEY) {
    fs.writeFileSync(cachePath, "[]\n");
    return { coverage: emptyCoverage(spec, symbol, "UNAVAILABLE_API_KEY_REQUIRED"), error: null };
  }
  try {
    const rows = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const normalized = Array.isArray(rows)
      ? rows
        .filter((row) => Number(row?.timestamp) >= START_TIME && Number(row?.timestamp) <= END_TIME)
        .map((row) => ({ ...row, ...timingFor(spec.family, Number(row.timestamp)) }))
      : [];
    fs.writeFileSync(cachePath, JSON.stringify(normalized, null, 2) + "\n");
    return { coverage: buildCoverage(spec, symbol, normalized, 0, cachePath, null), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { coverage: buildCoverage(spec, symbol, [], 0, cachePath, message), error: message };
  }
}

function sourceParams(family, symbol, cursor, endTime, backward) {
  const range = backward ? { endTime: cursor } : { startTime: cursor, endTime };
  if (family === "open_interest") return { symbol, period: "5m", limit: PAGE_LIMIT, ...range };
  if (family === "funding") return { symbol, limit: 1000, startTime: START_TIME, endTime };
  if (family === "basis") return { pair: symbol, contractType: "PERPETUAL", period: "5m", limit: PAGE_LIMIT, ...range };
  return { symbol, period: "5m", limit: PAGE_LIMIT, ...range };
}

function normalize(family, data) {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item;
    const timestamp = number(row.timestamp ?? row.fundingTime);
    if (timestamp === null) return [];
    const timing = timingFor(family, timestamp);
    if (family === "open_interest") return [{ timestamp, ...timing, openInterest: number(row.sumOpenInterest), openInterestValue: number(row.sumOpenInterestValue) }];
    if (family === "funding") return [{ timestamp, ...timing, fundingRate: number(row.fundingRate), markPrice: number(row.markPrice) }];
    if (family === "basis") return [{ timestamp, ...timing, basis: number(row.basis), basisRate: number(row.basisRate), indexPrice: number(row.indexPrice), futuresPrice: number(row.futuresPrice) }];
    if (family === "taker_flow") return [{ timestamp, ...timing, buySellRatio: number(row.buySellRatio), buyVolume: number(row.buyVol), sellVolume: number(row.sellVol) }];
    if (family === "top_trader_account" || family === "top_trader_position") return [{ timestamp, ...timing, longShortRatio: number(row.longShortRatio), longAccount: number(row.longAccount), shortAccount: number(row.shortAccount) }];
    return [{ timestamp, ...timing, longShortRatio: number(row.longShortRatio), longAccount: number(row.longAccount), shortAccount: number(row.shortAccount) }];
  });
}

function timingFor(family, timestamp) {
  const periodEndTimestamp = DERIVATIVES_PERIOD_END_TIMESTAMP_FAMILIES.includes(family);
  const periodic = family !== "funding";
  const periodStart = !periodic ? null : periodEndTimestamp ? timestamp - DERIVATIVES_INTERVAL_MS : timestamp;
  const periodEnd = !periodic ? timestamp : periodEndTimestamp ? timestamp : timestamp + DERIVATIVES_INTERVAL_MS;
  const availableAt = periodEnd;
  return { source_timestamp: timestamp, period_start: periodStart, period_end: periodEnd, available_at: availableAt };
}

function buildCoverage(spec, symbol, rows, duplicates, cachePath, error) {
  const expectedObservations = spec.family === "funding" ? null : Math.floor((END_TIME - START_TIME) / INTERVAL_MS) + 1;
  const missingRatio = expectedObservations ? round(Math.max(0, expectedObservations - rows.length) / expectedObservations) : null;
  const first = rows.at(0)?.source_timestamp ?? rows.at(0)?.timestamp ?? null;
  const last = rows.at(-1)?.source_timestamp ?? rows.at(-1)?.timestamp ?? null;
  const calendarCoverageDays = first !== null && last !== null
    ? round(Math.max(0, last - first + (spec.family === "funding" ? 0 : DERIVATIVES_INTERVAL_MS)) / 86_400_000)
    : 0;
  // Coverage staleness is a trailing freshness diagnostic, not a claim that
  // every historical row is stale merely because it is old relative to now.
  const lastRow = rows.at(-1);
  const staleRows = lastRow && Number.isFinite(Number(lastRow.available_at)) && END_TIME - Number(lastRow.available_at) > freshnessTolerance(spec.family)
    ? [lastRow]
    : [];
  return {
    symbol,
    family: spec.family,
    file: path.relative(process.cwd(), cachePath).replaceAll("\\", "/"),
    fileSha256: fs.existsSync(cachePath) ? sha256(fs.readFileSync(cachePath)) : null,
    start: first === null ? null : iso(first),
    end: last === null ? null : iso(last),
    earliest: first === null ? null : iso(first),
    latest: last === null ? null : iso(last),
    calendarCoverageDays,
    commonWindow: { start: first === null ? null : iso(first), end: last === null ? null : iso(last) },
    sourceTiming: timingDescription(spec.family),
    staleRatio: rows.length ? round(staleRows.length / rows.length) : null,
    observations: rows.length,
    expectedObservations,
    missingRatio,
    duplicates,
    freshnessMs: last === null ? null : Math.max(0, END_TIME - last),
    source: spec.endpoint,
    sourceStatus: error ? "error" : rows.length ? "ok" : "empty",
    error
  };
}

function emptyCoverage(spec, symbol, status) {
  return { symbol, family: spec.family, file: null, fileSha256: null, start: null, end: null, earliest: null, latest: null, calendarCoverageDays: 0, commonWindow: { start: null, end: null }, sourceTiming: timingDescription(spec.family), staleRatio: null, observations: 0, expectedObservations: null, missingRatio: null, duplicates: 0, freshnessMs: null, source: spec.endpoint, sourceStatus: status, error: null };
}

function summarizeFamilyCoverage(family, values) {
  const populated = values.filter((value) => value.observations > 0 && value.start && value.end);
  const starts = populated.map((value) => Date.parse(value.start));
  const ends = populated.map((value) => Date.parse(value.end));
  const commonStart = starts.length ? Math.max(...starts) : null;
  const commonEnd = ends.length ? Math.min(...ends) : null;
  const calendarCoverageDays = commonStart !== null && commonEnd !== null
    ? round(Math.max(0, commonEnd - commonStart + (family === "funding" ? 0 : DERIVATIVES_INTERVAL_MS)) / 86_400_000)
    : 0;
  const observations = values.reduce((sum, value) => sum + value.observations, 0);
  const expected = values.reduce((sum, value) => sum + (value.expectedObservations ?? 0), 0);
  const staleNumerator = values.reduce((sum, value) => sum + (value.staleRatio === null ? 0 : value.staleRatio * value.observations), 0);
  return {
    family,
    earliest: populated.length ? iso(Math.min(...starts)) : null,
    latest: populated.length ? iso(Math.max(...ends)) : null,
    commonWindow: { start: commonStart === null ? null : iso(commonStart), end: commonEnd === null ? null : iso(commonEnd) },
    calendarCoverageDays,
    symbolsMeetingCoverage: populated.filter((value) => value.calendarCoverageDays >= 90).map((value) => value.symbol),
    symbolsWithData: populated.map((value) => value.symbol),
    missingRatio: expected ? round(Math.max(0, expected - values.reduce((sum, value) => sum + value.observations, 0)) / expected) : null,
    staleRatio: observations ? round(staleNumerator / observations) : null,
    observations
  };
}

function freshnessTolerance(family) {
  return family === "funding" ? 9 * 60 * 60 * 1000 : 10 * 60 * 1000;
}

function timingDescription(family) {
  if (family === "funding") return { period: "event", sourceTimestamp: "fundingTime", periodStart: null, periodEnd: "fundingTime", availableAt: "fundingTime", rule: "last settled funding may persist only within funding freshness tolerance" };
  if (family === "liquidation") return { period: "event", sourceTimestamp: "eventTime", periodStart: null, periodEnd: null, availableAt: "receivedAt", rule: "forward-only" };
  if (family === "open_interest_current" || family === "premium_index_current") return { period: "snapshot", sourceTimestamp: "server timestamp", periodStart: null, periodEnd: null, availableAt: "server timestamp", rule: "current snapshot is not historical-safe" };
  if (DERIVATIVES_PERIOD_END_TIMESTAMP_FAMILIES.includes(family)) return { period: "5m", sourceTimestamp: "provider timestamp (period end)", periodStart: "timestamp - 5m", periodEnd: "timestamp", availableAt: "timestamp", rule: "period-end observation is PIT-usable at the endpoint timestamp" };
  return { period: "5m", sourceTimestamp: "provider timestamp (period start)", periodStart: "timestamp", periodEnd: "timestamp + 5m", availableAt: "timestamp + 5m", rule: "period must be closed before PIT use" };
}

async function requestJson(endpoint, params) {
  if (DERIVATIVES_MARKET_DATA_KEY_ENDPOINTS.includes(endpoint) && !MARKET_DATA_API_KEY) throw new Error("UNAVAILABLE_API_KEY_REQUIRED");
  const url = new URL(endpoint, BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const powershell = process.platform === "win32"
    ? await runPowerShell(url.toString(), DERIVATIVES_MARKET_DATA_KEY_ENDPOINTS.includes(endpoint) ? MARKET_DATA_API_KEY : null)
    : null;
  if (powershell?.status === 0) {
    try {
      const parsed = JSON.parse(powershell.stdout);
      if (process.env.GPT_PROFIT_004_DEBUG === "1") console.error(`powershell json: ${powershell.stdout.slice(0, 120).replaceAll("\n", " ")}`);
      // PowerShell serializes an Object[] pipeline as { value: [...], Count }.
      // Unwrap that transport envelope without changing the provider payload.
      return parsed && !Array.isArray(parsed) && Array.isArray(parsed.value) ? parsed.value : parsed;
    } catch { /* fall through */ }
  }
  const fetchResult = await tryFetch(url.toString(), DERIVATIVES_MARKET_DATA_KEY_ENDPOINTS.includes(endpoint) ? MARKET_DATA_API_KEY : null);
  if (fetchResult.ok) return fetchResult.value;
  throw new Error(fetchResult.error || powershell?.stderr || `request failed: ${endpoint}`);
}

async function requestWithRetry(endpoint, params) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestJson(endpoint, params);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(lastError || `request failed: ${endpoint}`);
}

async function runPowerShell(url, marketDataApiKey = null) {
  try {
    const header = marketDataApiKey ? ` -Headers @{ '${MARKET_DATA_KEY_HEADER}' = '${marketDataApiKey.replaceAll("'", "''")}' }` : "";
    const command = `$ProgressPreference='SilentlyContinue'; Invoke-RestMethod -Uri '${url.replaceAll("'", "''")}' -UseBasicParsing -TimeoutSec 30${header} | ConvertTo-Json -Depth 20`;
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { status: error?.code ?? 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? error?.message ?? String(error) };
  }
}

async function tryFetch(url, marketDataApiKey = null) {
  try {
    const headers = marketDataApiKey ? { [MARKET_DATA_KEY_HEADER]: marketDataApiKey } : undefined;
    const response = await globalThis.fetch(url, { cache: "no-store", ...(headers ? { headers } : {}) });
    if (!response.ok) return { ok: false, error: `${response.status} ${response.statusText}` };
    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function renderAudit(manifest) {
  const lines = [
    "# GPT-PROFIT-004 Data Availability Audit",
    "",
    "This audit is a data-foundation deliverable. It does not add a strategy, read a private Binance API, or consume any GPT-PROFIT-003 holdout.",
    "",
    `Generated: ${manifest.generatedAt}; source version: \`${manifest.sourceVersion}\`; requested window: ${manifest.requestedWindow.start} → ${manifest.requestedWindow.end}.`,
    "",
    "## Endpoint capability matrix",
    "",
    "| Family | Endpoint | Capability | Anonymous | API key | Historical lookback | Interval | Point-in-time / backtest | Risks |",
    "|---|---|---|---:|---:|---|---|---|---|",
    ...manifest.sourceSpecs.map((spec) => `| ${spec.family} | \`${spec.endpoint}\` | ${spec.classification} | ${spec.anonymousPublic ? "yes" : "no"} | ${spec.apiKeyRequired ? "yes" : "no"} | ${spec.historicalLookback} | ${spec.samplingInterval} | ${spec.pointInTime}; safe=${spec.safeForBacktest ? "yes" : "no"} | ${spec.revisionRisk}; ${spec.survivorshipRisk} |`),
    "",
    "### Source timing matrix",
    "",
    "| Family | Period start | Period end | available_at | Freshness policy |",
    "|---|---|---|---|---|",
    ...manifest.sourceSpecs.map((spec) => { const timing = timingDescription(spec.family); return `| ${spec.family} | ${timing.periodStart ?? "n/a"} | ${timing.periodEnd ?? "n/a"} | ${timing.availableAt ?? "n/a"} | ${timing.rule} |`; }),
    "",
    `Top-trader capability: **MARKET_DATA_API_KEY**; key configured: **${manifest.marketDataApiKeyConfigured}**; without the optional \`BINANCE_MARKET_DATA_API_KEY\`, status is \`UNAVAILABLE_API_KEY_REQUIRED\`. No key is sent to non-allowlisted endpoints.`,
    `Private/account endpoints used: **${manifest.privateEndpointsUsed}**; private endpoint families: ${manifest.privateEndpointFamilies.length ? manifest.privateEndpointFamilies.join(", ") : "none"}.`,
    "",
    "Official source URLs: [USDⓈ-M Futures market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data), [open interest history](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics), [funding history](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History), [basis](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Basis), [taker ratio](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Taker-BuySell-Volume), [global long/short](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio), [top-trader account](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data), [top-trader position](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data).",
    "",
    "## Collection result",
    "",
    `- Symbols: ${manifest.symbols.join(", ")}`,
    `- Rows observed across source files: ${manifest.totalRows}; expected on fixed 5m grids where applicable: ${manifest.totalExpectedRows}; missing ratio: ${manifest.missingDataRatio ?? "n/a (event-driven source)"}.`,
    `- Consolidated point-in-time rows prepared for \`gpt_derivatives_metrics\`: ${manifest.consolidatedMetricRows}; the migration is included but not applied to Production in this Draft PR.`,
    `- Earliest metric: ${manifest.earliestMetricTime ?? "none"}; latest metric: ${manifest.latestMetricTime ?? "none"}; global common span (descriptive only): ${manifest.historicalCoverageDays} days; family gates use independent coverage.`,
    `- Dataset hash: \`${manifest.datasetHash}\`; manifest sidecar is generated next to this report.`,
    `- Database status: ${manifest.databasePersistence}.`,
    "",
    "| Family | Observed rows | Calendar coverage | Symbols with data | Symbols >=90d | Missing | Stale | Status |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
    ...Object.entries(manifest.familyCoverage).map(([family, values]) => {
      const list = Object.values(values);
      const summary = manifest.familyCoverageSummaries[family];
      return `| ${family} | ${list.reduce((sum, item) => sum + item.observations, 0)} | ${summary.calendarCoverageDays}d | ${summary.symbolsWithData.length}/${manifest.symbols.length} | ${summary.symbolsMeetingCoverage.length} | ${summary.missingRatio ?? "n/a"} | ${summary.staleRatio ?? "n/a"} | ${family === "liquidation" ? "INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA" : list.some((item) => item.sourceStatus === "UNAVAILABLE_API_KEY_REQUIRED") ? "UNAVAILABLE_API_KEY_REQUIRED" : list.some((item) => item.observations > 0) ? "collected / coverage-limited" : "unavailable in run"} |`;
    }),
    "",
    "Family coverage is independent: a DOGE basis gap does not reduce OI, funding, taker, or positioning coverage. Combined Gate coverage is the intersection of actually selected families only.",
    `DOGE basis investigation: **${manifest.sourceGapInvestigations.DOGEUSDT_basis.status}** (observedGap=${manifest.sourceGapInvestigations.DOGEUSDT_basis.observedGap}); latest observed: ${manifest.sourceGapInvestigations.DOGEUSDT_basis.latestObserved ?? "none"}. ${manifest.sourceGapInvestigations.DOGEUSDT_basis.note}`,
    "",
    "## Backtest safety decisions",
    "",
    "- All stored observations are timestamped at or before the requested closed-period boundary. Percentiles are calculated only from observations available at that point; no future rows are interpolated or used.",
    "- Top-trader account/position ratios are aggregate MARKET_DATA observations. They require only the optional BINANCE_MARKET_DATA_API_KEY; without it they are explicitly unavailable rather than silently reused. No user account, private position, order, or user-trade endpoint is called.",
    "- Liquidation has no reliable public historical REST series in this foundation. It is explicitly `INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA`; only a future public stream may be collected.",
    "- Liquidation adapter: `src/lib/binance/liquidation-forward.ts`; adapterImplemented=true, runtimeCollectorEnabled=false, historicalBackfill=false, backtestSafe=false, status=FORWARD_COLLECTOR_NOT_DEPLOYED.",
    "- The configured symbol list reflects currently supported symbols and therefore does not make survivorship claims about delisted contracts. Provider retention and revisions remain part of every row's quality flags.",
    "- A coverage span below 90 days disables the derivatives Internal Gate and any robust-edge claim. It is a legitimate `INSUFFICIENT_DERIVATIVES_HISTORY` outcome.",
    "",
    "## Safety boundary",
    "",
    "`PRODUCTION_SIGNAL_STRATEGIES=[]`; Main V2 and ALT Basket remain Shadow. AUTO_TRADING=false, PRIVATE_BINANCE_API=false. This foundation only persists public market-data metrics and computes research diagnostics."
  ];
  return lines.join("\n") + "\n";
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function iso(value) { return new Date(value).toISOString(); }
function round(value) { return Math.round(value * 1_000_000) / 1_000_000; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
