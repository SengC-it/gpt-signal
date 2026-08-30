import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { evaluateSignalCandidate } from "../src/lib/signal/engine.ts";
import { applyReviewCandles, createInitialReviewState, isSettledReviewStatus } from "../src/lib/signal/review.ts";
import { MAIN_STRATEGY_V2 } from "../src/lib/signal/strategy-config.ts";
import { mainOpportunityId, reviewStatusToLifecycle, shouldCreateRuntimeSignal } from "../src/lib/signal/runtime-parity.ts";
import {
  PROFITABILITY_002_DISCOVERY_CUTOFF,
  PROFITABILITY_002_FEE_RATE,
  PROFITABILITY_002_SLIPPAGE_RATE,
  buildProfitability002Candidates,
  classifyResearchRegime,
  costCoverageBand,
  evaluateProfitability002InternalGate,
  isDiscoveryCandle,
  isHoldoutCandle,
  relativeStrengthBand,
  scoreBand,
  simulateResearchOutcome,
  slAtrRatioBand,
  summarizeResearchTrades,
  volatilityBand
} from "../src/lib/signal/profitability-002.ts";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"];
const TRADE_SYMBOLS = SYMBOLS.filter((symbol) => symbol !== "BTCUSDT");
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const FOUR_HOURS = 4 * 60 * 60 * 1000;
const DATA_DIR = path.join(process.cwd(), ".cache", "historical-backtest", process.env.PROFITABILITY_002_CACHE_KEY || "profit-002-latest");
const REPORT_DIR = path.join(process.cwd(), "reports");
const CUTOFF = Date.parse(PROFITABILITY_002_DISCOVERY_CUTOFF);
const FEE_RATE = Number(process.env.PROFITABILITY_002_FEE_RATE || PROFITABILITY_002_FEE_RATE);
const SLIPPAGE_RATE = Number(process.env.PROFITABILITY_002_SLIPPAGE_RATE || PROFITABILITY_002_SLIPPAGE_RATE);
const TRAIN_DAYS = Number(process.env.PROFITABILITY_002_TRAIN_DAYS || 120);
const TEST_DAYS = Number(process.env.PROFITABILITY_002_TEST_DAYS || 45);
const PURGE_HOURS = Number(process.env.PROFITABILITY_002_PURGE_HOURS || 4);
const FOLD_COUNT = Number(process.env.PROFITABILITY_002_FOLDS || 3);

fs.mkdirSync(REPORT_DIR, { recursive: true });
const candlesBySymbol = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, readCandles(symbol)]));
const commonTimes = intersectTimes(SYMBOLS.map((symbol) => candlesBySymbol[symbol].map((candle) => candle.openTime)));
if (commonTimes.length < 1000) throw new Error(`Insufficient common candle history: ${commonTimes.length}`);
const aligned = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, alignBars(candlesBySymbol[symbol], commonTimes)]));
const btc4h = aggregateFourHour(aligned.BTCUSDT);
const btc4hIndexByTime = buildBtc4hIndexByTime(commonTimes, btc4h);
const startIndex = 60;
const discoveryEndIndex = lastIndexAtOrBefore(CUTOFF);
const holdoutStartIndex = firstIndexAfter(CUTOFF);
const endIndex = commonTimes.length - 1;
if (discoveryEndIndex <= startIndex || holdoutStartIndex > endIndex) throw new Error("Discovery/holdout boundary is not present in the frozen data.");

const manifest = readManifest();
const candidates = buildProfitability002Candidates();
if (candidates.length > 16) throw new Error(`Candidate count ${candidates.length} exceeds the hard limit of 16.`);
const baselineCandidate = {
  id: "main-v2-parity-baseline",
  family: "A_balanced_payoff_trend_pullback",
  rationale: "Unchanged Main V2 parity reference; no parameter changes and no research-only sideways/cost filters.",
  config: MAIN_STRATEGY_V2,
  directionMode: "momentum",
  exitMode: "hard_sl_tp",
  timeStopCandles: null,
  minimumCostCoverageRatio: 0,
  sidewaysPolicy: "allow"
};

// This file is written before any holdout simulation is allowed to run.
const freeze = {
  frozenAt: new Date().toISOString(),
  discoveryCutoff: PROFITABILITY_002_DISCOVERY_CUTOFF,
  holdoutDefinition: "closed candles strictly after the cutoff; one execution after candidate freeze only",
  candidateCount: candidates.length,
  candidates: candidates.map((candidate) => ({
    id: candidate.id,
    family: candidate.family,
    rationale: candidate.rationale,
    directionMode: candidate.directionMode,
    exitMode: candidate.exitMode,
    timeStopCandles: candidate.timeStopCandles,
    minimumCostCoverageRatio: candidate.minimumCostCoverageRatio,
    sidewaysPolicy: candidate.sidewaysPolicy,
    parameters: candidate.config
  })),
  protocol: {
    signalInputs: "closed 15m candle through the decision candle; BTC 4h aggregate includes only bars closed by that candle",
    reviewStarts: "strictly after the signal candle; one active runtime lifecycle per opportunity id, same-symbol opportunities may coexist across different opportunity ids",
    opportunityDedupe: "symbol+direction+signalType+marketRegime+strategyVersion+15m, then latest level+lifecycle",
    signalCooldown: "none (runtime parity)",
    noChase: "shared runtime shouldMarkNoChase rule",
    execution: "entry reference is plan.entryHigh LONG / plan.entryLow SHORT; TP1 or SL first; same-candle stop wins; fee 0.10%/side; slippage 0.05%/side",
    selection: "purged walk-forward training only; test folds are never used to change parameters; no holdout result is read until this freeze exists",
    holdout: "single run only if internal gate passes; never retuned or redefined"
  }
};
fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-002-CANDIDATE-FREEZE.json"), JSON.stringify(freeze, null, 2));

const baselineDiscoveryTrades = simulateCandidate(baselineCandidate, startIndex, discoveryEndIndex + 1);
const baselineSummary = summarizeResearchTrades(baselineDiscoveryTrades);
const attribution = buildLossAttribution(baselineDiscoveryTrades);
const calibration = buildScoreCalibration(baselineDiscoveryTrades);
const repeatedAttribution = buildRepeatedAttribution(baselineDiscoveryTrades);

const folds = buildPurgedFolds(startIndex, discoveryEndIndex);
const foldReports = [];
const candidateFoldTrades = new Map(candidates.map((candidate) => [candidate.id, []]));
const selectedFoldTrades = new Map(candidates.map((candidate) => [candidate.id, []]));
const selectedFoldCounts = new Map(candidates.map((candidate) => [candidate.id, 0]));
for (const fold of folds) {
  const training = candidates.map((candidate) => {
    const trades = simulateCandidate(candidate, fold.trainStartIndex, fold.trainEndIndex + 1);
    return { candidate, trades, summary: summarizeResearchTrades(trades) };
  });
  const selected = selectTrainingCandidate(training);
  const testTradesByCandidate = new Map();
  for (const candidate of candidates) {
    const trades = simulateCandidate(candidate, fold.testStartIndex, fold.testEndIndex + 1);
    candidateFoldTrades.get(candidate.id).push(trades);
    testTradesByCandidate.set(candidate.id, trades);
  }
  const testTrades = selected ? testTradesByCandidate.get(selected.candidate.id) ?? [] : [];
  if (selected) {
    selectedFoldTrades.get(selected.candidate.id).push(testTrades);
    selectedFoldCounts.set(selected.candidate.id, selectedFoldCounts.get(selected.candidate.id) + 1);
  }
  foldReports.push({
    fold: fold.fold,
    train: {
      start: iso(commonTimes[fold.trainStartIndex]),
      end: iso(commonTimes[fold.trainEndIndex]),
      selected: selected?.candidate.id ?? null,
      selectedSummary: selected?.summary ?? summarizeResearchTrades([]),
      leaderboard: trainingLeaderboard(training)
    },
    test: {
      start: iso(commonTimes[fold.testStartIndex]),
      end: iso(commonTimes[fold.testEndIndex]),
      selected: selected?.candidate.id ?? null,
      summary: summarizeResearchTrades(testTrades)
    }
  });
}

const candidateOos = candidates.map((candidate) => {
  const foldTrades = candidateFoldTrades.get(candidate.id).flat();
  const summary = summarizeResearchTrades(foldTrades);
  const positiveFolds = candidateFoldTrades.get(candidate.id)
    .map((trades) => summarizeResearchTrades(trades).netR > 0)
    .filter(Boolean).length;
  const gate = evaluateProfitability002InternalGate({
    summary,
    positiveFoldCount: positiveFolds,
    foldCount: folds.length,
    noLeakage: true
  });
  return {
    candidate,
    summary,
    positiveFolds,
    selectedFolds: selectedFoldCounts.get(candidate.id),
    gate,
    trades: foldTrades
  };
}).sort((a, b) => b.summary.expectancyR - a.summary.expectancyR || b.summary.profitFactor - a.summary.profitFactor || b.summary.netR - a.summary.netR);
const trainingSelectedCandidate = [...selectedFoldCounts.entries()]
  .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const selectedCandidateResult = trainingSelectedCandidate
  ? candidateOos.find((result) => result.candidate.id === trainingSelectedCandidate)
  : null;
const internalWinner = selectedCandidateResult && selectedCandidateResult.gate.passed ? selectedCandidateResult : null;

// The holdout is deliberately invoked only after freeze + internal gate.
let finalHoldout = {
  executed: false,
  status: "NO_CANDIDATE_FOR_FINAL_HOLDOUT",
  selectedCandidate: null,
  summary: summarizeResearchTrades([]),
  range: { start: iso(commonTimes[holdoutStartIndex]), end: iso(commonTimes[endIndex]) }
};
if (internalWinner) {
  const holdoutTrades = simulateCandidate(internalWinner.candidate, holdoutStartIndex, endIndex + 1);
  const holdoutSummary = summarizeResearchTrades(holdoutTrades);
  const status = holdoutSummary.settledTrades < 50
    ? "INSUFFICIENT_SAMPLE"
    : holdoutSummary.netR > 0 && holdoutSummary.profitFactor >= 1.2 && holdoutSummary.expectancyR > 0 && holdoutSummary.payoffRatio >= 0.65
      ? "PASS"
      : "FAIL";
  finalHoldout = {
    executed: true,
    status,
    selectedCandidate: internalWinner.candidate.id,
    summary: holdoutSummary,
    range: { start: iso(commonTimes[holdoutStartIndex]), end: iso(commonTimes[endIndex]) }
  };
}

const productionEnabled = false;
const report = {
  task: "GPT-PROFIT-002",
  generatedAt: new Date().toISOString(),
  codeVersion: resolveCodeVersion(),
  safety: {
    mainV2DeliveryMode: "shadow",
    altBasketDeliveryMode: "shadow",
    productionEnabled,
    autoTrading: false,
    privateBinanceApi: false,
    candidatesDeliveryMode: "shadow_candidate",
    productionEmail: false
  },
  data: {
    manifest,
    commonBars: commonTimes.length,
    discovery: { start: iso(commonTimes[startIndex]), end: iso(commonTimes[discoveryEndIndex]), bars: discoveryEndIndex - startIndex + 1 },
    cutoff: PROFITABILITY_002_DISCOVERY_CUTOFF,
    holdout: finalHoldout.range,
    holdoutStartsAtIndex: holdoutStartIndex,
    gaps: dataQualityReport()
  },
  parity: {
    simulator: "runtime opportunity id + level/lifecycle dedupe; review previous closed candle before current signal evaluation; same-symbol concurrent opportunities retained; no cooldown; shared no-chase rule",
    execution: { feeRatePerSide: FEE_RATE, slippageRatePerSide: SLIPPAGE_RATE, sameCandlePriority: "stop", candleTiming: "closed candles only" },
    baselineMainV2Discovery: baselineSummary,
    priorAcceptedParityReference: {
      source: "reports/GPT-PROFIT-001-R1-PARITY.md",
      fullOos: { settledTrades: 4365, netR: -952.65, profitFactor: 0.4, expectancyR: -0.218 },
      final60dHoldout: { settledTrades: 1398, netR: -369.23, profitFactor: 0.341, expectancyR: -0.264 }
    }
  },
  lossAttribution: attribution,
  scoreCalibration: calibration,
  repeatedSignalAttribution: repeatedAttribution,
  candidateFreeze: path.relative(process.cwd(), path.join(REPORT_DIR, "GPT-PROFIT-002-CANDIDATE-FREEZE.json")).replaceAll("\\", "/"),
  walkForward: {
    trainDays: TRAIN_DAYS,
    testDays: TEST_DAYS,
    purgeHours: PURGE_HOURS,
    folds: foldReports,
    leaderboard: candidateOos.map((result) => ({ id: result.candidate.id, family: result.candidate.family, summary: result.summary, positiveFolds: result.positiveFolds, selectedFolds: result.selectedFolds, gate: result.gate }))
  },
  bestInternalOos: selectedCandidateResult
    ? { candidateId: selectedCandidateResult.candidate.id, summary: selectedCandidateResult.summary, positiveFolds: selectedCandidateResult.positiveFolds, selectedFolds: selectedCandidateResult.selectedFolds }
    : null,
  internalGate: selectedCandidateResult
    ? { selectedByTraining: selectedCandidateResult.candidate.id, selectedFolds: selectedCandidateResult.selectedFolds, ...selectedCandidateResult.gate }
    : { selectedCandidate: null, status: "NO_CANDIDATE_FOR_FINAL_HOLDOUT" },
  finalHoldout,
  result: internalWinner && finalHoldout.status === "PASS" ? "SHADOW_CANDIDATE_ONLY" : "NO EDGE FOUND"
};

fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-002-RESEARCH.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-002-LOSS-ATTRIBUTION.md"), renderLossAttribution(report));
fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-002.md"), renderSummary(report));
console.log(JSON.stringify(report, null, 2));

function simulateCandidate(candidate, fromIndex, toIndexExclusive) {
  const trades = [];
  for (const symbol of TRADE_SYMBOLS) {
    const series = aligned[symbol];
    const indexByCloseTime = new Map(series.map((candle, index) => [candle.closeTime, index]));
    const latestByOpportunity = new Map();
    for (let index = Math.max(startIndex, fromIndex); index < toIndexExclusive; index += 1) {
      const current = series[index];
      if (!current) continue;
      for (const latest of latestByOpportunity.values()) {
        if (!latest.plan || latest.createdIndex >= index - 1 || isSettledReviewStatus(latest.reviewState.finalStatus)) continue;
        latest.reviewState = applyReviewCandles({
          direction: latest.direction,
          plan: latest.plan,
          candles: [series[index - 1]],
          state: latest.reviewState,
          feeRate: FEE_RATE,
          slippageRate: SLIPPAGE_RATE,
          candlesAreSorted: true
        });
        latest.lifecycleStatus = reviewStatusToLifecycle(latest.reviewState.finalStatus);
      }

      const btcIndex = btc4hIndexByTime[index];
      const btc4hWindow = btcIndex >= 0 ? btc4h.slice(Math.max(0, btcIndex - 49), btcIndex + 1) : [];
      const symbolWindow = series.slice(Math.max(0, index - 60), index + 1);
      const btcWindow = aligned.BTCUSDT.slice(Math.max(0, index - 60), index + 1);
      const direction = selectDirection(candidate, symbolWindow, btcWindow);
      const researchRegime = classifyResearchRegime(btc4hWindow);
      if (candidate.sidewaysPolicy === "no_trade" && researchRegime === "sideways") continue;
      if (candidate.config.regimeMode === "aligned" && ((researchRegime === "bull" && direction !== "LONG") || (researchRegime === "bear" && direction !== "SHORT"))) continue;

      const signal = evaluateSignalCandidate({
        symbol,
        direction,
        signalType: candidate.config.setupMode === "breakout" ? "volume_breakout" : "trend_pullback",
        candles15m: symbolWindow,
        btcCandles15m: btcWindow,
        btcCandles4h: btc4hWindow,
        strategyVersion: candidate.config.version,
        strategyConfig: candidate.config,
        now: current.closeTime + 1,
        fundingRate: null,
        oiChange15m: null,
        circuitBreakerActive: false
      });
      if (signal.level !== "A" && signal.level !== "S") continue;
      const opportunityId = mainOpportunityId(signal, candidate.config.version);
      const existing = latestByOpportunity.get(opportunityId);
      if (!shouldCreateRuntimeSignal(existing, signal)) continue;
      latestByOpportunity.set(opportunityId, {
        level: signal.level,
        lifecycleStatus: signal.lifecycleStatus,
        direction,
        plan: signal.plan,
        createdIndex: index,
        reviewState: createInitialReviewState()
      });
      if (signal.lifecycleStatus !== "planned" || !signal.plan) continue;
      if ((signal.costEdge?.costCoverageRatio ?? 0) < candidate.minimumCostCoverageRatio) continue;

      const outcome = simulateResearchOutcome({
        direction,
        plan: signal.plan,
        candles: series.slice(index + 1, toIndexExclusive),
        feeRate: FEE_RATE,
        slippageRate: SLIPPAGE_RATE,
        exitMode: candidate.exitMode,
        timeStopCandles: candidate.timeStopCandles,
        shouldInvalidate: candidate.exitMode === "early_invalidation"
          ? (candle) => invalidationAt(series, indexByCloseTime, candle.closeTime, direction)
          : undefined
      });
      const relativeStrengthScore = signal.relativeStrengthScore;
      trades.push({
        candidateId: candidate.id,
        symbol,
        direction,
        signalTime: current.closeTime,
        entryTime: outcome.entryTime,
        exitTime: outcome.exitTime,
        finalStatus: outcome.finalStatus,
        entryHit: outcome.entryHit,
        netR: outcome.netR,
        grossR: outcome.grossR,
        netPnlPct: outcome.netPnlPct,
        grossPnlPct: outcome.grossPnlPct,
        mfe: outcome.mfe,
        mae: outcome.mae,
        durationCandles: outcome.durationCandles,
        score: signal.score,
        relativeStrengthScore,
        btcRegime: researchRegime,
        marketRegime: signal.marketRegime,
        trendAlignment: trendAlignmentAt(series, index, direction) ? "aligned" : "mixed",
        volatilityBand: volatilityBand(signal.plan.slAtrRatio),
        costCoverageBand: costCoverageBand(signal.costEdge?.costCoverageRatio ?? 0),
        slAtrRatioBand: slAtrRatioBand(signal.plan.slAtrRatio),
        entryStructure: candidate.config.setupMode === "breakout" ? "confirmed_breakout" : signal.plan.entryMode,
        opportunityKey: opportunityId,
        repeatedOpportunity: "first"
      });
    }
  }
  return assignRepeatedOpportunity(trades).sort((a, b) => a.signalTime - b.signalTime);
}

function invalidationAt(series, indexByCloseTime, closeTime, direction) {
  const index = indexByCloseTime.get(closeTime) ?? -1;
  if (index < 32) return false;
  const assetTrendAligned = trendAlignmentAt(series, index, direction);
  const btcIndex = btc4hIndexByTime[index];
  const regime = btcIndex >= 0 ? classifyResearchRegime(btc4h.slice(Math.max(0, btcIndex - 49), btcIndex + 1)) : "unknown";
  return !assetTrendAligned || (direction === "LONG" ? regime !== "bull" : regime !== "bear");
}

function trendAlignmentAt(series, index, direction) {
  if (index < 32) return false;
  const recent1h = average(series.slice(index - 4, index).map((candle) => candle.close));
  const prior1h = average(series.slice(index - 8, index - 4).map((candle) => candle.close));
  const recent4h = average(series.slice(index - 16, index).map((candle) => candle.close));
  const prior4h = average(series.slice(index - 32, index - 16).map((candle) => candle.close));
  const latest = series[index].close;
  return direction === "LONG"
    ? latest >= recent1h && recent1h >= prior1h && latest >= recent4h && recent4h >= prior4h
    : latest <= recent1h && recent1h <= prior1h && latest <= recent4h && recent4h <= prior4h;
}

function selectDirection(candidate, symbolWindow, btcWindow) {
  if (candidate.directionMode === "relative") {
    const symbolReturn = pct(symbolWindow.at(-16)?.close, symbolWindow.at(-1)?.close);
    const btcReturn = pct(btcWindow.at(-16)?.close, btcWindow.at(-1)?.close);
    return symbolReturn - btcReturn >= 0 ? "LONG" : "SHORT";
  }
  return (symbolWindow.at(-1)?.close ?? 0) >= (symbolWindow.at(-10)?.close ?? 0) ? "LONG" : "SHORT";
}

function buildPurgedFolds(firstIndex, lastIndex) {
  const folds = [];
  const trainBars = Math.round(TRAIN_DAYS * 24 * 60 * 60 * 1000 / FIFTEEN_MINUTES);
  const testBars = Math.round(TEST_DAYS * 24 * 60 * 60 * 1000 / FIFTEEN_MINUTES);
  const purgeBars = Math.round(PURGE_HOURS * 60 * 60 * 1000 / FIFTEEN_MINUTES);
  const usable = lastIndex - firstIndex + 1;
  const required = trainBars + purgeBars + testBars;
  if (usable < required) return folds;
  const firstTestStart = lastIndex - testBars + 1;
  for (let fold = 0; fold < FOLD_COUNT; fold += 1) {
    const testEndIndex = firstTestStart - (FOLD_COUNT - fold - 1) * testBars;
    const testStartIndex = testEndIndex - testBars + 1;
    const trainEndIndex = testStartIndex - purgeBars - 1;
    const trainStartIndex = trainEndIndex - trainBars + 1;
    if (trainStartIndex < firstIndex || testStartIndex <= trainEndIndex || testEndIndex > lastIndex) continue;
    folds.push({ fold: fold + 1, trainStartIndex, trainEndIndex, testStartIndex, testEndIndex });
  }
  return folds;
}

function selectTrainingCandidate(results) {
  const eligible = results.filter((result) => result.summary.settledTrades >= 20);
  return [...eligible].sort((a, b) => b.summary.expectancyR - a.summary.expectancyR || b.summary.profitFactor - a.summary.profitFactor || b.summary.netR - a.summary.netR)[0] ?? null;
}

function trainingLeaderboard(results) {
  return [...results].sort((a, b) => b.summary.expectancyR - a.summary.expectancyR || b.summary.profitFactor - a.summary.profitFactor || b.summary.netR - a.summary.netR)
    .slice(0, 8).map((result) => ({ id: result.candidate.id, summary: result.summary }));
}

function buildLossAttribution(trades) {
  const dimensions = [
    ["symbol", (trade) => trade.symbol],
    ["direction", (trade) => trade.direction],
    ["btcRegime", (trade) => trade.btcRegime],
    ["marketRegime", (trade) => trade.marketRegime],
    ["scoreBand", (trade) => scoreBand(trade.score)],
    ["relativeStrengthBand", (trade) => relativeStrengthBand(trade.relativeStrengthScore)],
    ["trendAlignment", (trade) => trade.trendAlignment],
    ["volatilityBand", (trade) => trade.volatilityBand],
    ["costCoverageBand", (trade) => trade.costCoverageBand],
    ["slAtrRatioBand", (trade) => trade.slAtrRatioBand],
    ["entryStructure", (trade) => trade.entryStructure],
    ["holdingDuration", (trade) => durationBand(trade.durationCandles)],
    ["repeatedOpportunity", (trade) => trade.repeatedOpportunity],
    ["month", (trade) => new Date(trade.signalTime).toISOString().slice(0, 7)]
  ];
  return {
    baseline: summarizeResearchTrades(trades),
    groups: Object.fromEntries(dimensions.map(([name, key]) => [name, summarizeGroups(trades, key)])),
    mfeMae: {
      hitSlMfeThresholds: Object.fromEntries([0.25, 0.5, 0.75, 1].map((threshold) => {
        const hitSl = trades.filter((trade) => trade.finalStatus === "hit_sl");
        return [`mfe_gte_${threshold}R`, hitSl.length ? hitSl.filter((trade) => trade.mfe >= threshold).length / hitSl.length * 100 : 0];
      })),
      winners: distribution(trades.filter((trade) => (trade.netR ?? 0) > 0).map((trade) => ({ mae: trade.mae, mfe: trade.mfe, durationCandles: trade.durationCandles })))
    },
    decision: decideEntryExit(trades)
  };
}

function buildScoreCalibration(trades) {
  const sorted = [...trades].sort((a, b) => a.score - b.score);
  const buckets = [];
  for (let index = 0; index < 10; index += 1) {
    const from = Math.floor(index * sorted.length / 10);
    const to = Math.floor((index + 1) * sorted.length / 10);
    buckets.push({ decile: index + 1, minScore: sorted[from]?.score ?? null, maxScore: sorted[Math.max(from, to - 1)]?.score ?? null, summary: summarizeResearchTrades(sorted.slice(from, to)) });
  }
  const expectancy = buckets.map((bucket) => bucket.summary.expectancyR);
  const monotonic = expectancy.every((value, index) => index === 0 || value >= expectancy[index - 1]);
  return { buckets, status: monotonic ? "CALIBRATED_MONOTONIC" : "SCORE_NOT_CALIBRATED", note: "Deciles are descriptive; no minimum-score optimization was performed." };
}

function buildRepeatedAttribution(trades) {
  const windows = [1, 4].map((hours) => ({ hours, groups: summarizeGroups(assignWindowRepeatLabels(trades, hours), (trade) => trade.repeatedOpportunity) }));
  return { windows, clusterRule: "same symbol + direction + signalType/opportunity family, consecutive signal timestamps within the window; first/second/third+ labels", noHoldoutDecisions: true };
}

function assignRepeatedOpportunity(trades) {
  const byKey = new Map();
  for (const trade of trades.sort((a, b) => a.signalTime - b.signalTime)) {
    const key = `${trade.symbol}:${trade.direction}`;
    const previous = byKey.get(key);
    const gap = previous ? trade.signalTime - previous.signalTime : Number.POSITIVE_INFINITY;
    const ordinal = gap <= FOUR_HOURS ? (previous.ordinal + 1) : 1;
    trade.repeatedOpportunity = ordinal === 1 ? "first" : ordinal === 2 ? "second" : "third_plus";
    byKey.set(key, { ordinal, signalTime: trade.signalTime });
  }
  return trades;
}

function assignWindowRepeatLabels(trades, hours) {
  const window = hours * 60 * 60 * 1000;
  const sorted = [...trades].sort((a, b) => a.signalTime - b.signalTime);
  const byKey = new Map();
  return sorted.map((trade) => {
    const key = `${trade.symbol}:${trade.direction}`;
    const previous = byKey.get(key);
    const ordinal = previous && trade.signalTime - previous.signalTime <= window ? previous.ordinal + 1 : 1;
    byKey.set(key, { ordinal, signalTime: trade.signalTime });
    return { ...trade, repeatedOpportunity: ordinal === 1 ? "first" : ordinal === 2 ? "second" : "third_plus" };
  });
}

function decideEntryExit(trades) {
  const hitSl = trades.filter((trade) => trade.finalStatus === "hit_sl");
  const winners = trades.filter((trade) => (trade.netR ?? 0) > 0);
  const lateInvalidation = hitSl.filter((trade) => trade.mfe >= 0.5).length;
  return {
    conclusion: lateInvalidation > hitSl.length * 0.4 ? "BAD_EXIT_OR_LATE_INVALIDATION_SIGNAL": "BAD_ENTRY_OR_SETUP_SELECTION_MORE_LIKELY",
    evidence: { hitSlTrades: hitSl.length, hitSlWithMfeGte0_5R: lateInvalidation, winnerCount: winners.length },
    caveat: "This is an attribution heuristic, not a causal claim; early-invalidation and time-stop candidates are compared separately."
  };
}

function summarizeGroups(trades, keyFn) {
  const groups = new Map();
  for (const trade of trades) {
    const key = keyFn(trade);
    const group = groups.get(key) ?? [];
    group.push(trade);
    groups.set(key, group);
  }
  return Object.fromEntries([...groups.entries()].sort((a, b) => b[1].reduce((s, t) => s + (t.netR ?? 0), 0) - a[1].reduce((s, t) => s + (t.netR ?? 0), 0)).map(([key, group]) => [key, summarizeResearchTrades(group)]));
}

function distribution(values) {
  const fields = ["mae", "mfe", "durationCandles"];
  return Object.fromEntries(fields.map((field) => {
    const numbers = values.map((item) => item[field]).filter(Number.isFinite).sort((a, b) => a - b);
    return [field, { count: numbers.length, p25: percentile(numbers, 0.25), median: percentile(numbers, 0.5), p75: percentile(numbers, 0.75), mean: average(numbers) }];
  }));
}

function renderLossAttribution(report) {
  const baseline = report.lossAttribution.baseline;
  const lines = [
    "# GPT-PROFIT-002 Loss Attribution",
    "",
    `Discovery cutoff: ${report.data.cutoff}. Holdout is strictly after this timestamp and is excluded from this report's attribution and selection.`,
    "",
    "## Method",
    "",
    "Main V2 is simulated with runtime opportunity-id and level/lifecycle dedupe, previous-closed-candle review ordering, same-symbol concurrent opportunities, closed-candle TP/SL with stop priority, 0.10% fee and 0.05% slippage per side. The baseline is discovery-only.",
    "",
    `Baseline trades=${baseline.trades}, settled=${baseline.settledTrades}, Net R=${round(baseline.netR)}, PF=${round(baseline.profitFactor)}, expectancy=${round(baseline.expectancyR)}R, max DD=${round(baseline.maxDrawdownR)}R.`,
    "",
    "## Five key findings",
    "",
    ...keyFindings(report.lossAttribution).map((item) => `- ${item}`),
    "",
    "## Attribution tables",
    "",
    ...renderGroupTables(report.lossAttribution.groups),
    "",
    "## MFE / MAE",
    "",
    `Hit-SL MFE thresholds: ${JSON.stringify(report.lossAttribution.mfeMae.hitSlMfeThresholds)}.`,
    "",
    `Winner distributions: ${JSON.stringify(report.lossAttribution.mfeMae.winners)}.`,
    "",
    `Decision: ${report.lossAttribution.decision.conclusion}. ${report.lossAttribution.decision.caveat}`,
    "",
    `Score calibration status: ${report.scoreCalibration.status}. ${report.scoreCalibration.note}`,
    "",
    `Repeated signal attribution: ${JSON.stringify(report.repeatedSignalAttribution)}.`,
    ""
  ];
  return lines.join("\n");
}

function renderSummary(report) {
  const winner = report.walkForward.leaderboard[0];
  const selected = report.walkForward.leaderboard.find((item) => item.id === report.internalGate.selectedByTraining);
  return [
    "# GPT-PROFIT-002 — Positive Expectancy Strategy Redesign",
    "",
    `Result: **${report.result}**`,
    `Production enabled: **${report.safety.productionEnabled}**; Main V2=${report.safety.mainV2DeliveryMode}; ALT Basket=${report.safety.altBasketDeliveryMode}.`,
    "",
    `Discovery: ${report.data.discovery.start} → ${report.data.discovery.end}; cutoff=${report.data.cutoff}. Holdout: ${report.data.holdout.start} → ${report.data.holdout.end}.`,
    `Candidates: ${report.candidateFreeze ? report.walkForward.leaderboard.length : 0} (frozen before holdout).`,
    `Best descriptive fold OOS (not used to choose params): ${winner ? `${winner.id}, PF=${round(winner.summary.profitFactor)}, expectancy=${round(winner.summary.expectancyR)}R, Net R=${round(winner.summary.netR)}` : "none"}.`,
    `Training-selected internal OOS: ${selected ? `${selected.id}, PF=${round(selected.summary.profitFactor)}, expectancy=${round(selected.summary.expectancyR)}R, Net R=${round(selected.summary.netR)}` : "none"}.`,
    `Internal gate: ${report.internalGate.selectedByTraining ?? report.internalGate.selectedCandidate ?? "NO_CANDIDATE_FOR_FINAL_HOLDOUT"}.`,
    `Final unseen holdout: ${report.finalHoldout.status}${report.finalHoldout.executed ? `, settled=${report.finalHoldout.summary.settledTrades}, PF=${round(report.finalHoldout.summary.profitFactor)}, expectancy=${round(report.finalHoldout.summary.expectancyR)}R, Net R=${round(report.finalHoldout.summary.netR)}` : " (not executed)"}.`,
    "",
    "All candidates remain `shadow_candidate`; no Production strategy or email is enabled.",
    ""
  ].join("\n");
}

function keyFindings(attribution) {
  const groups = attribution.groups;
  const largestLoss = (name) => Object.entries(groups[name] ?? {}).sort((a, b) => a[1].netR - b[1].netR)[0];
  const entries = ["symbol", "direction", "btcRegime", "scoreBand", "holdingDuration"].map((name) => {
    const item = largestLoss(name);
    return item ? `${name}=${item[0]} is the largest negative Net R slice (${round(item[1].netR)}R, ${item[1].settledTrades} settled).` : `${name} had no settled slice.`;
  });
  return entries;
}

function renderGroupTables(groups) {
  return Object.entries(groups).slice(0, 14).flatMap(([name, values]) => {
    const rows = Object.entries(values).map(([key, summary]) => `| ${key} | ${summary.trades} | ${summary.settledTrades} | ${round(summary.netR)} | ${round(summary.profitFactor)} | ${round(summary.expectancyR)} | ${round(summary.maxDrawdownR)} |`);
    return [`### ${name}`, "", "| Group | Trades | Settled | Net R | PF | Exp R | Max DD R |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |", ...rows, ""];
  });
}

function readCandles(symbol) {
  const filePath = path.join(DATA_DIR, `${symbol}-15m.json`);
  if (!fs.existsSync(filePath)) throw new Error(`Missing frozen data file: ${filePath}`);
  const rows = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return rows
    .filter((candle) => candle.isClosed !== false && (isDiscoveryCandle(candle.openTime) || isHoldoutCandle(candle.openTime)))
    .sort((a, b) => a.openTime - b.openTime);
}

function readManifest() {
  const filePath = path.join(REPORT_DIR, "GPT-PROFIT-002-DATA-MANIFEST.json");
  if (!fs.existsSync(filePath)) throw new Error(`Missing data manifest: ${filePath}. Run fetch-profit-002-data.mjs first.`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function dataQualityReport() {
  return Object.fromEntries(SYMBOLS.map((symbol) => [symbol, { bars: candlesBySymbol[symbol].length, gaps: countGaps(candlesBySymbol[symbol]), duplicates: candlesBySymbol[symbol].length - new Set(candlesBySymbol[symbol].map((candle) => candle.openTime)).size }]));
}

function countGaps(bars) {
  let gaps = 0;
  for (let index = 1; index < bars.length; index += 1) if (bars[index].openTime - bars[index - 1].openTime !== FIFTEEN_MINUTES) gaps += 1;
  return gaps;
}

function intersectTimes(timeLists) {
  let common = new Set(timeLists[0]);
  for (const times of timeLists.slice(1)) common = new Set([...common].filter((time) => times.includes(time)));
  return [...common].sort((a, b) => a - b);
}

function alignBars(bars, times) {
  const map = new Map(bars.map((bar) => [bar.openTime, bar]));
  return times.map((time) => map.get(time));
}

function aggregateFourHour(bars) {
  const groups = new Map();
  for (const bar of bars) {
    const bucket = Math.floor(bar.openTime / FOUR_HOURS) * FOUR_HOURS;
    const current = groups.get(bucket) ?? { openTime: bucket, closeTime: bar.closeTime, close: bar.close };
    current.closeTime = bar.closeTime;
    current.close = bar.close;
    groups.set(bucket, current);
  }
  return [...groups.values()].sort((a, b) => a.openTime - b.openTime).map((bar) => ({ ...bar, isClosed: true }));
}

function buildBtc4hIndexByTime(times, bars) {
  const indexes = [];
  let cursor = -1;
  for (const time of times) {
    while (cursor + 1 < bars.length && bars[cursor + 1].closeTime <= time) cursor += 1;
    indexes.push(cursor);
  }
  return indexes;
}

function lastIndexAtOrBefore(time) {
  let result = -1;
  for (let index = 0; index < commonTimes.length; index += 1) {
    if (commonTimes[index] > time) break;
    result = index;
  }
  return result;
}

function firstIndexAfter(time) {
  const index = commonTimes.findIndex((item) => item > time);
  return index === -1 ? commonTimes.length : index;
}

function durationBand(candles) {
  if (candles <= 16) return "<=4h";
  if (candles <= 96) return "4-24h";
  if (candles <= 192) return "24-48h";
  return ">48h";
}

function pct(from, to) {
  return from && to ? (to - from) / from : 0;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const index = (values.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 10_000) / 10_000 : 0;
}

function iso(value) {
  return new Date(value).toISOString();
}

function resolveCodeVersion() {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    return head;
  } catch {
    return "working-tree";
  }
}
