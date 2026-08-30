import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  simulateEntryLabel,
  GPT_PROFIT_003_FINAL_UNSEEN_END,
  GPT_PROFIT_003_FINAL_UNSEEN_START
} from "../src/lib/signal/entry-edge.ts";
import {
  DERIVATIVES_FEE_RATE,
  DERIVATIVES_LABEL_HORIZON_BARS,
  DERIVATIVES_SLIPPAGE_RATE,
  GPT_PROFIT_004_FORWARD_START,
  GPT_PROFIT_004_RESEARCH_CUTOFF,
  buildDerivativeAblation,
  evaluateDerivativesGate,
  DERIVATIVE_FAMILIES
} from "../src/lib/signal/derivatives-research.ts";
import { forwardLiquidationCollectorStatus } from "../src/lib/binance/liquidation-forward.ts";
import {
  DERIVATIVES_INTERVAL_MS,
  DERIVATIVES_PERIOD_END_TIMESTAMP_FAMILIES
} from "../src/lib/binance/derivatives.ts";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"];
const TRADE_SYMBOLS = SYMBOLS.filter((symbol) => symbol !== "BTCUSDT");
const DATA_DIR = path.join(process.cwd(), ".cache", "historical-backtest", process.env.PROFITABILITY_004_CACHE_KEY || "profit-002-latest");
const METRIC_DIR = path.join(process.cwd(), ".cache", "gpt-profit-004");
const REPORT_DIR = path.join(process.cwd(), "reports");
const MANIFEST_PATH = path.join(REPORT_DIR, "GPT-PROFIT-004-DATA-MANIFEST.json");
const MANIFEST_HASH_PATH = path.join(REPORT_DIR, "GPT-PROFIT-004-DATA-MANIFEST.sha256");
const REPORT_JSON_PATH = path.join(REPORT_DIR, "GPT-PROFIT-004-RESEARCH.json");
const REPORT_MD_PATH = path.join(REPORT_DIR, "GPT-PROFIT-004.md");
const CUTOFF = Date.parse(GPT_PROFIT_004_RESEARCH_CUTOFF);
const LABEL_END = CUTOFF;
const DECISION_END = LABEL_END - DERIVATIVES_LABEL_HORIZON_BARS * 15 * 60 * 1000;
const FORBIDDEN_HOLDOUT_MARKERS = [
  "GPT-PROFIT-003-FINAL-UNSEEN-EXECUTION.json",
  "GPT-PROFIT-003-R1-FINAL-UNSEEN-EXECUTION.json",
  "GPT-PROFIT-003-R2-FINAL-UNSEEN-EXECUTION.json"
];

fs.mkdirSync(REPORT_DIR, { recursive: true });
for (const marker of FORBIDDEN_HOLDOUT_MARKERS) {
  if (fs.existsSync(path.join(REPORT_DIR, marker))) throw new Error(`GPT-PROFIT-003 holdout marker exists; refusing to run GPT-PROFIT-004: ${marker}`);
}

const manifest = readJson(MANIFEST_PATH) ?? {};
const metrics = readMetricCache();
const metricFileCount = fs.existsSync(METRIC_DIR) ? fs.readdirSync(METRIC_DIR).filter((name) => name.endsWith(".json")).length : 0;
const candlesBySymbol = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, readCandles(symbol)]));
const metricTimes = metrics.map((row) => metricTime(row)).filter(Number.isFinite);
const metricStart = metricTimes.length ? Math.min(...metricTimes) : null;
const analysisStart = metricStart === null ? CUTOFF : metricStart;
const events = buildPriceOnlyEvents(candlesBySymbol, Math.max(analysisStart, Date.parse("2025-01-01T00:00:00.000Z")), DECISION_END);
const familyCoverageDays = Object.fromEntries(DERIVATIVE_FAMILIES.map((family) => [
  family,
  Number(manifest.familyCoverageDays?.[family] ?? manifest.familyCoverageSummaries?.[family]?.calendarCoverageDays ?? manifest.historicalCoverageDays ?? 0)
]));
const historyDays = Number(manifest.combinedCoverageDays ?? manifest.historicalCoverageDays ?? (metricTimes.length ? (Math.max(...metricTimes) - Math.min(...metricTimes)) / 86_400_000 : 0));
const ablation = buildDerivativeAblation({ events, metrics, historyDays, familyCoverageDays });
const bestFamily = ablation.families
  .filter((summary) => summary.status === "EVALUATED" && Number.isFinite(summary.deltaNetExpectancyR))
  .sort((left, right) => (right.deltaNetExpectancyR ?? -Infinity) - (left.deltaNetExpectancyR ?? -Infinity))[0] ?? null;
const gate = bestFamily ? evaluateDerivativesGate({ historyDays, summary: bestFamily }) : {
  status: historyDays < 90 ? "INSUFFICIENT_DERIVATIVES_HISTORY" : "FAIL",
  passed: false,
  reasons: [historyDays < 90 ? "no family can be evaluated with >=90d coverage" : "no evaluated family"],
  checks: { historyAtLeast90d: historyDays >= 90 }
};
const result = historyDays < 90 || ablation.families.every((summary) => summary.status === "INSUFFICIENT_DERIVATIVES_HISTORY")
  ? "INSUFFICIENT_DERIVATIVES_HISTORY"
  : gate.passed ? "DERIVATIVES_EDGE_REQUIRES_SEPARATE_REVIEW" : "NO DERIVATIVES EDGE FOUND";
const report = {
  task: "GPT-PROFIT-004 — Derivatives Edge Data Foundation",
  generatedAt: new Date().toISOString(),
  result,
  boundary: {
    researchCutoff: GPT_PROFIT_004_RESEARCH_CUTOFF,
    forwardValidationStarts: GPT_PROFIT_004_FORWARD_START,
    labelEnd: new Date(LABEL_END).toISOString(),
    decisionEnd: new Date(DECISION_END).toISOString(),
    explicitlySeparateFromGPTProfit003Holdout: true,
    gptProfit003Holdout: { start: GPT_PROFIT_003_FINAL_UNSEEN_START, end: GPT_PROFIT_003_FINAL_UNSEEN_END, executions: 0 }
  },
  sources: {
    manifest: path.relative(process.cwd(), MANIFEST_PATH).replaceAll("\\", "/"),
    manifestSha256: fileHash(MANIFEST_HASH_PATH) ? readShaSidecar(MANIFEST_HASH_PATH) : null,
    sourceObservationRows: Number(manifest.totalRows ?? 0),
    metricFiles: metricFileCount,
    metricRows: metrics.length,
    earliestMetric: metricTimes.length ? new Date(Math.min(...metricTimes)).toISOString() : null,
    latestMetric: metricTimes.length ? new Date(Math.max(...metricTimes)).toISOString() : null,
    historicalCoverageDays: historyDays,
    historicalCoverageAtLeast90d: historyDays >= 90,
    familyCoverageDays,
    familyCoverage: manifest.familyCoverageSummaries ?? {},
    coverageMethod: "family-specific; combined coverage is selected-family intersection"
  },
  labels: {
    primary: "+1R before -1R",
    secondary: "+1.25R before -1R",
    horizonBars: DERIVATIVES_LABEL_HORIZON_BARS,
    sameCandlePriority: "STOP FIRST",
    feePerSide: DERIVATIVES_FEE_RATE,
    slippagePerSide: DERIVATIVES_SLIPPAGE_RATE,
    source: "fixed entry-edge label simulator; no derivative-derived threshold"
  },
  ablationProtocol: {
    comparableBaseline: "unconditional outcomes for the same events with fresh point-in-time family data",
    conditionedSlice: "deterministic top 30% of each family score; no threshold grid",
    deltaDefinition: "conditioned slice metric minus its same-event unconditional baseline",
    familyEligibility: "positive delta net and PF, positive delta gross or predictive evidence, conditioned fold consistency, and conditioned sample/breadth"
  },
  events: { priceOnlyEvents: events.length, symbols: TRADE_SYMBOLS, noCandidateSearch: true },
  baseline: ablation.baseline,
  families: ablation.families,
  combinedPermitted: ablation.combined,
  bestIncrementalFamily: bestFamily?.family ?? null,
  internalGate: gate,
  candidateSearch: { maxCandidates: 8, candidatesGenerated: 0, bestCandidate: null, status: "NO_CANDIDATE_SEARCH_IN_DATA_FOUNDATION" },
  prospectiveCollector: { enabled: true, integratedInto: "src/app/api/jobs/sync-market/route.ts", failSoft: true, appendOnlyTable: "gpt_derivatives_metrics", priceChange5mSource: "Binance USD-M /fapi/v1/klines interval=5m closed candles" },
  liquidationForwardCollector: forwardLiquidationCollectorStatus(),
  safety: {
    mainV2DeliveryMode: "shadow",
    altBasketDeliveryMode: "shadow",
    productionSignalStrategies: [],
    autoTrading: false,
    privateBinanceApi: false,
    accountAccess: false,
    positionControl: false,
    productionEnabled: false
  },
  provenance: {
    mainBaseSha: resolveRef("origin/main") ?? resolveRef("main"),
    branchHeadSha: resolveRef("HEAD"),
    sourceParentSha: resolveParentSha(),
    dataManifestSha256: readShaSidecar(MANIFEST_HASH_PATH),
    researchScriptSha256: fileHash(path.resolve(process.cwd(), "scripts", "gpt-profit-004-research.mjs")),
    researchModuleSha256: fileHash(path.resolve(process.cwd(), "src", "lib", "signal", "derivatives-research.ts")),
    derivativesCollectorSha256: fileHash(path.resolve(process.cwd(), "src", "lib", "binance", "derivatives.ts")),
    liquidationForwardCollectorSha256: fileHash(path.resolve(process.cwd(), "src", "lib", "binance", "liquidation-forward.ts"))
  },
  holdoutExecutions: 0,
  finalUnseenExecuted: false,
  finalModelGenerated: false,
  productionEnabledStrategies: []
};
fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(REPORT_MD_PATH, renderMarkdown(report));
console.log(JSON.stringify({ result, events: events.length, metricRows: metrics.length, historyDays, bestFamily: bestFamily?.family ?? null, gate: gate.status }, null, 2));

function buildPriceOnlyEvents(candlesBySymbol, startTime, endTime) {
  const btc = candlesBySymbol.BTCUSDT;
  const events = [];
  for (const symbol of TRADE_SYMBOLS) {
    const candles = candlesBySymbol[symbol];
    if (!candles.length || !btc.length) continue;
    const firstIndex = candles.findIndex((candle) => candle.closeTime >= startTime);
    const startIndex = Math.max(80, firstIndex < 0 ? candles.length : firstIndex);
    const endIndex = candles.findIndex((candle) => candle.closeTime > endTime);
    const lastIndex = endIndex < 0 ? candles.length - 1 : endIndex - 1;
    for (let index = startIndex; index <= lastIndex; index += 1) {
      const current = candles[index];
      if (!current || current.closeTime > endTime) continue;
      // Fixed price-only benchmark: direction is the sign of the prior 4h
      // close-to-close move and entries are sampled every four bars. This is
      // a comparator, not a new setup or a candidate strategy.
      if ((index - startIndex) % 4 !== 0 || index < 16) continue;
      const direction = current.close >= candles[index - 16].close ? "LONG" : "SHORT";
      const risk = Math.max(averageRange(candles, index, 14), current.close * 0.0005);
      const stopLoss = direction === "LONG" ? current.close - risk : current.close + risk;
      const label = simulateEntryLabel({
        direction,
        entryPrice: current.close,
        stopLoss,
        risk,
        eventTime: current.closeTime,
        targetR: 1,
        futureCandles: candles.slice(index + 1, index + 1 + DERIVATIVES_LABEL_HORIZON_BARS)
      });
      if (current.closeTime < startTime || current.closeTime > endTime) continue;
      if (current.closeTime + DERIVATIVES_LABEL_HORIZON_BARS * 15 * 60 * 1000 > LABEL_END) continue;
      events.push({ eventId: `${symbol}:price-only:${current.openTime}:${direction}`, symbol, direction, eventTime: current.closeTime, fold: foldFor(current.closeTime, startTime, endTime), grossR: label.grossR, netR: label.netR });
    }
  }
  return events.sort((left, right) => left.eventTime - right.eventTime);
}

function readMetricCache() {
  if (!fs.existsSync(METRIC_DIR)) return [];
  const byKey = new Map();
  for (const name of fs.readdirSync(METRIC_DIR).filter((item) => item.endsWith(".json"))) {
    const match = /^(.*)-(open_interest|funding|basis|taker_flow|positioning|top_trader_account|top_trader_position)\.json$/.exec(name);
    if (!match) continue;
    let values;
    try { values = JSON.parse(fs.readFileSync(path.join(METRIC_DIR, name), "utf8")); } catch { values = []; }
    if (!Array.isArray(values)) continue;
    const symbol = match[1];
    for (const value of values) {
      const timestamp = Number(value?.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      const family = match[2];
      const key = `${symbol}:${timestamp}`;
      const row = byKey.get(key) ?? { symbol, metric_time: new Date(timestamp).toISOString(), timestamp, family_timing: {} };
      const periodEndTimestamp = DERIVATIVES_PERIOD_END_TIMESTAMP_FAMILIES.includes(family);
      const fallbackPeriodStart = periodEndTimestamp ? timestamp - DERIVATIVES_INTERVAL_MS : family === "funding" ? null : timestamp;
      const fallbackPeriodEnd = family === "funding" || periodEndTimestamp ? timestamp : timestamp + DERIVATIVES_INTERVAL_MS;
      const timing = {
        source_timestamp: NumberOrNull(value.source_timestamp ?? timestamp),
        period_start: NumberOrNull(value.period_start ?? fallbackPeriodStart),
        period_end: NumberOrNull(value.period_end ?? fallbackPeriodEnd),
        available_at: NumberOrNull(value.available_at ?? (family === "funding" || periodEndTimestamp ? timestamp : timestamp + DERIVATIVES_INTERVAL_MS)),
        stale: false
      };
      row.family_timing[family] = timing;
      if (row.available_at === undefined || timing.available_at < row.available_at) row.available_at = timing.available_at;
      if (family === "open_interest") Object.assign(row, { open_interest: NumberOrNull(value.openInterest), open_interest_value: NumberOrNull(value.openInterestValue) });
      if (family === "funding") Object.assign(row, { funding_rate: NumberOrNull(value.fundingRate), last_settled_funding: NumberOrNull(value.fundingRate) });
      if (family === "basis") Object.assign(row, { basis_bps: basisBps(value), basis_rate: NumberOrNull(value.basisRate) });
      if (family === "taker_flow") Object.assign(row, { taker_buy_ratio: NumberOrNull(value.buySellRatio), taker_imbalance: imbalance(value.buyVolume, value.sellVolume) });
      if (family === "positioning") Object.assign(row, { global_long_short_ratio: NumberOrNull(value.longShortRatio) });
      if (family === "top_trader_account") Object.assign(row, { top_account_long_short_ratio: NumberOrNull(value.longShortRatio) });
      if (family === "top_trader_position") Object.assign(row, { top_position_long_short_ratio: NumberOrNull(value.longShortRatio) });
      byKey.set(key, row);
    }
  }
  const rows = [...byKey.values()].sort((left, right) => metricTime(left) - metricTime(right));
  const lastOiBySymbol = new Map();
  const lastPositioningBySymbol = new Map();
  const lastTopAccountBySymbol = new Map();
  const lastTopPositionBySymbol = new Map();
  for (const row of rows) {
    const hasPositioning = Number.isFinite(row.global_long_short_ratio);
    const hasTopAccount = Number.isFinite(row.top_account_long_short_ratio);
    const hasTopPosition = Number.isFinite(row.top_position_long_short_ratio);
    const previousOi = lastOiBySymbol.get(row.symbol);
    if (row.open_interest !== undefined && row.open_interest !== null && previousOi?.value > 0 && row.timestamp - previousOi.timestamp <= 2 * 5 * 60 * 1000) row.oi_change_5m = (row.open_interest - previousOi.value) / previousOi.value * 100;
    if (row.open_interest !== undefined && row.open_interest !== null) lastOiBySymbol.set(row.symbol, { value: row.open_interest, timestamp: row.timestamp });
    const previousPositioning = lastPositioningBySymbol.get(row.symbol);
    const previousTopAccount = lastTopAccountBySymbol.get(row.symbol);
    const previousTopPosition = lastTopPositionBySymbol.get(row.symbol);
    if (hasPositioning && Number.isFinite(previousPositioning?.value) && row.timestamp - previousPositioning.timestamp <= 2 * 5 * 60 * 1000) row.global_long_short_change = row.global_long_short_ratio - previousPositioning.value;
    if (hasTopAccount && Number.isFinite(previousTopAccount?.value) && row.timestamp - previousTopAccount.timestamp <= 2 * 5 * 60 * 1000) row.top_account_long_short_change = row.top_account_long_short_ratio - previousTopAccount.value;
    if (hasTopPosition && Number.isFinite(previousTopPosition?.value) && row.timestamp - previousTopPosition.timestamp <= 2 * 5 * 60 * 1000) row.top_position_long_short_change = row.top_position_long_short_ratio - previousTopPosition.value;
    if (hasPositioning) lastPositioningBySymbol.set(row.symbol, { value: row.global_long_short_ratio, timestamp: row.timestamp });
    if (hasTopAccount) lastTopAccountBySymbol.set(row.symbol, { value: row.top_account_long_short_ratio, timestamp: row.timestamp });
    if (hasTopPosition) lastTopPositionBySymbol.set(row.symbol, { value: row.top_position_long_short_ratio, timestamp: row.timestamp });
  }
  return rows;
}

function NumberOrNull(value) { if (value === null || value === undefined || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function imbalance(buy, sell) { const left = NumberOrNull(buy); const right = NumberOrNull(sell); return left === null || right === null ? null : (left - right) / Math.max(left + right, Number.EPSILON); }
function basisBps(value) { const basis = NumberOrNull(value.basis); const index = NumberOrNull(value.indexPrice); const rate = NumberOrNull(value.basisRate); return basis !== null && index !== null && index > 0 ? basis / index * 10_000 : rate === null ? null : rate * 10_000; }

function readCandles(symbol) {
  const filePath = path.join(DATA_DIR, `${symbol}-15m.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const values = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(values) ? values.map((row) => ({ ...row, openTime: Number(row.openTime), closeTime: Number(row.closeTime), isClosed: true })).filter((row) => Number.isFinite(row.closeTime) && Number.isFinite(row.close)) : [];
  } catch { return []; }
}

function metricTime(row) {
  const value = row.metricTime ?? row.metric_time;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function foldFor(time, start, end) {
  const fraction = (time - start) / Math.max(end - start, 1);
  return Math.min(3, Math.max(1, Math.floor(fraction * 3) + 1));
}
function averageRange(candles, index, period) {
  const start = Math.max(1, index - period + 1);
  const ranges = candles.slice(start, index + 1).map((candle, offset) => {
    const previous = candles[start + offset - 1]?.close ?? candle.open;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previous), Math.abs(candle.low - previous));
  });
  return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0;
}
function readJson(filePath) { try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; } }
function fileHash(filePath) { return fs.existsSync(filePath) ? crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex") : null; }
function readShaSidecar(filePath) { if (!fs.existsSync(filePath)) return null; return fs.readFileSync(filePath, "utf8").trim().split(/\s+/)[0] || null; }
function resolveRef(ref) {
  try { return execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim(); } catch {
    // Some restricted runners disallow child processes even though the
    // repository is readable. Resolve ordinary refs from .git as a
    // deterministic provenance fallback rather than emitting null hashes.
    if (ref.endsWith("^")) return null;
    const headPath = path.join(process.cwd(), ".git", "HEAD");
    let normalized = ref;
    try {
      if (ref === "HEAD") {
        const head = fs.readFileSync(headPath, "utf8").trim();
        normalized = head.startsWith("ref: ") ? head.slice(5) : head;
      } else if (ref === "origin/main") {
        normalized = "refs/remotes/origin/main";
      } else if (ref === "main") {
        normalized = "refs/heads/main";
      } else if (!ref.startsWith("refs/")) {
        normalized = `refs/${ref}`;
      }
      const refPath = path.join(process.cwd(), ".git", normalized);
      if (fs.existsSync(refPath)) return fs.readFileSync(refPath, "utf8").trim() || null;
      const packedPath = path.join(process.cwd(), ".git", "packed-refs");
      if (fs.existsSync(packedPath)) {
        const line = fs.readFileSync(packedPath, "utf8").split(/\r?\n/).find((item) => item.endsWith(` ${normalized}`));
        if (line) return line.split(" ")[0] ?? null;
      }
    } catch { /* provenance remains nullable if the git metadata is unavailable */ }
    return null;
  }
}
function resolveParentSha() {
  try { return resolveRef("HEAD^"); } catch { return null; }
}
function renderMarkdown(report) {
  const lines = [
    "# GPT-PROFIT-004 — Derivatives Edge Data Foundation",
    "",
    `Result: **${report.result}**`,
    "",
    `Research cutoff: ${report.boundary.researchCutoff}; forward validation starts: ${report.boundary.forwardValidationStarts}. This is separate from GPT-PROFIT-003 Final Unseen, which remains at ${report.holdoutExecutions} executions.`,
    "",
    `Source observations: ${report.sources.sourceObservationRows}; consolidated PIT metric rows: ${report.sources.metricRows} across ${report.sources.metricFiles} cache files; earliest: ${report.sources.earliestMetric ?? "none"}; latest: ${report.sources.latestMetric ?? "none"}; combined selected-family history: ${report.sources.historicalCoverageDays.toFixed(2)} days; >=90d: **${report.sources.historicalCoverageAtLeast90d}**.`,
    `Family coverage (independent): ${Object.entries(report.sources.familyCoverageDays).map(([family, days]) => `${family}=${Number(days).toFixed(2)}d`).join(", ")}.`,
    `Price-only diagnostic events: ${report.events.priceOnlyEvents}; label horizon: ${report.labels.horizonBars} bars; costs: fee ${report.labels.feePerSide} + slippage ${report.labels.slippagePerSide} per side; same-candle priority: ${report.labels.sameCandlePriority}.`,
    "",
    "## Incremental information ablation",
    "",
    "Unconditional family columns are the comparable baseline population for that family. Conditioned columns are the deterministic score top 30% slice; deltas are conditioned minus that same-event baseline.",
    "",
    "| Family | Base events | Base settled | Base Gross E[R] | Base Net E[R] | Base PF | Cond events | Cond settled | Cond Gross E[R] | Cond Net E[R] | Cond PF | Δ Gross E[R] | Δ Net E[R] | Δ PF | Spearman | Mono violations | Top lift | Base symbols | Cond symbols | Base months | Cond folds | Missing | Stale | Status |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    row(report.baseline),
    ...report.families.map(row),
    row(report.combinedPermitted),
    "",
    ...report.families.map((summary) => `- ${summary.family} net-R contribution concentration: largest absolute=${format(summary.largestSymbolAbsoluteContributionShare)}, largest positive=${format(summary.largestSymbolPositiveContributionShare)}; future Gate requires each <= 0.50.`),
    "",
    `Best incremental family: **${report.bestIncrementalFamily ?? "none"}**. No candidate search was run (candidates generated: ${report.candidateSearch.candidatesGenerated}).`,
    "",
    "## Gate and collection",
    "",
    `Internal Gate: **${report.internalGate.status}**; reasons: ${report.internalGate.reasons.join(", ") || "none"}.`,
    "",
    "The prospective collector is enabled in the existing market sync, writes append-only `gpt_derivatives_metrics`, and is fail-soft: endpoint or table errors are returned in sync metadata without failing the candle/signal sync.",
    "",
    `Liquidation remains \`INSUFFICIENT_HISTORICAL_LIQUIDATION_DATA\`; adapterImplemented=${report.liquidationForwardCollector.adapterImplemented}, runtimeCollectorEnabled=${report.liquidationForwardCollector.runtimeCollectorEnabled}, status=${report.liquidationForwardCollector.status}. Top-trader account/position ratios require the optional MARKET_DATA key and are excluded when unavailable.`,
    "",
    "## Safety",
    "",
    "Main V2 and ALT Basket remain Shadow; `PRODUCTION_SIGNAL_STRATEGIES=[]`; no Production email, account access, position control, orders, leverage, or automatic trading. AUTO_TRADING=false; PRIVATE_BINANCE_API=false."
  ];
  return lines.join("\n") + "\n";
}
function row(summary) {
  return `| ${summary.family} | ${summary.eventCount} | ${summary.settled} | ${format(summary.grossExpectancyR)} | ${format(summary.netExpectancyR)} | ${format(summary.profitFactor)} | ${summary.conditionedEventCount} | ${summary.conditionedSettled} | ${format(summary.conditionedGrossExpectancyR)} | ${format(summary.conditionedNetExpectancyR)} | ${format(summary.conditionedProfitFactor)} | ${format(summary.deltaGrossExpectancyR)} | ${format(summary.deltaNetExpectancyR)} | ${format(summary.deltaProfitFactor)} | ${format(summary.spearman)} | ${format(summary.monotonicViolations)} | ${format(summary.conditionalLiftR)} | ${summary.symbolBreadth} | ${summary.conditionedSymbolBreadth} | ${summary.monthBreadth} | ${summary.conditionedFoldConsistency} | ${summary.missingExcludedCount} | ${summary.staleExcludedCount} | ${summary.status} |`;
}
function format(value) { return value === null || value === undefined ? "n/a" : Number.isFinite(value) ? value.toFixed(6) : String(value); }
