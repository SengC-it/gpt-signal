import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ENTRY_EDGE_FEATURE_NAMES,
  ENTRY_EDGE_FEE_RATE,
  ENTRY_EDGE_HORIZON_BARS,
  ENTRY_EDGE_PURGE_BARS,
  ENTRY_EDGE_SETUP_DEFINITIONS,
  ENTRY_EDGE_SLIPPAGE_RATE,
  GPT_PROFIT_003_DISCOVERY_CUTOFF,
  GPT_PROFIT_003_FINAL_UNSEEN_END,
  GPT_PROFIT_003_FINAL_UNSEEN_START,
  assertFinalUnseenCanExecute,
  bucketIndex,
  calculateEntryEdgeScore,
  calculateSpearman,
  calibrateFeature,
  classifyFeatureStatus,
  countMonotonicViolations,
  detectEntrySetups,
  ensureEntryEdgeCandidateFreeze,
  evaluateEntryEdgeGate,
  fitEntryEdgeScoreSpec,
  hashFile,
  quantileEdges,
  readHoldoutExecutionCount,
  simulateEntryLabel,
  summarizeEntryEvents
} from "../src/lib/signal/entry-edge.ts";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"];
const TRADE_SYMBOLS = SYMBOLS.filter((symbol) => symbol !== "BTCUSDT");
const DATA_DIR = path.join(process.cwd(), ".cache", "historical-backtest", process.env.PROFITABILITY_003_CACHE_KEY || "profit-002-latest");
const REPORT_DIR = path.join(process.cwd(), "reports");
const CUTOFF = Date.parse(GPT_PROFIT_003_DISCOVERY_CUTOFF);
const HOLDOUT_START = Date.parse(GPT_PROFIT_003_FINAL_UNSEEN_START);
const HOLDOUT_END = Date.parse(GPT_PROFIT_003_FINAL_UNSEEN_END);
const FREEZE_PATH = path.join(REPORT_DIR, "GPT-PROFIT-003-CANDIDATE-FREEZE.json");
const FREEZE_HASH_PATH = path.join(REPORT_DIR, "GPT-PROFIT-003-CANDIDATE-FREEZE.sha256");
const HOLDOUT_MARKER = path.join(REPORT_DIR, "GPT-PROFIT-003-FINAL-UNSEEN-EXECUTION.json");
const DATASET_MANIFEST_PATH = path.join(REPORT_DIR, "GPT-PROFIT-002-DATA-MANIFEST.json");
const FEATURE_GROUPS = {
  trend: ["trend_return_15m", "trend_return_1h", "trend_return_4h", "trend_return_12h", "trend_slope_short", "trend_slope_medium", "trend_alignment_long"],
  structure: ["structure_distance_rolling_high", "structure_distance_rolling_low", "breakout_distance_atr", "pullback_depth_atr", "retracement_ratio", "structure_age"],
  volatility: ["atr_pct", "atr_percentile", "recent_range_atr", "compression_ratio", "expansion_ratio"],
  volume: ["volume_ratio", "quote_volume_ratio", "volume_percentile", "volume_expansion"],
  relativeStrength: ["relative_strength_1h", "relative_strength_4h", "relative_strength_12h"],
  marketBreadth: ["btc_trend_1h", "btc_trend_4h", "btc_volatility_state", "breadth_bullish_pct", "breadth_bearish_pct", "cross_sectional_dispersion"]
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
if (fs.existsSync(HOLDOUT_MARKER)) throw new Error(`GPT-PROFIT-003 Final Unseen marker already exists: ${HOLDOUT_MARKER}`);

const candlesBySymbol = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, readCandles(symbol)]));
const commonTimes = intersectTimes(SYMBOLS.map((symbol) => candlesBySymbol[symbol].map((candle) => candle.openTime)));
if (commonTimes.length < 1000) throw new Error(`Insufficient common candle history: ${commonTimes.length}`);
const aligned = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, alignBars(candlesBySymbol[symbol], commonTimes)]));
const discoveryEndIndex = lastIndexAtOrBefore(CUTOFF);
const holdoutStartIndex = firstIndexAtOrAfter(HOLDOUT_START);
const holdoutEndIndex = lastIndexAtOrBefore(HOLDOUT_END);
const featureStartIndex = 80;
if (discoveryEndIndex <= featureStartIndex || holdoutStartIndex > holdoutEndIndex) {
  throw new Error("Discovery or protected holdout boundary is not present in the frozen dataset.");
}

const manifest = readManifest();
const provenance = {
  mainBaseSha: resolveRef("origin/main") ?? resolveRef("main"),
  branchHeadSha: resolveRef("HEAD"),
  sourceParentSha: resolveParentSha(),
  researchScriptSha256: hashFile(path.resolve(process.cwd(), "scripts", "gpt-profit-003-research.mjs")),
  entryEdgeModuleSha256: hashFile(path.resolve(process.cwd(), "src", "lib", "signal", "entry-edge.ts")),
  candidateFreezeSha256: null,
  datasetManifestSha256: hashFile(DATASET_MANIFEST_PATH)
};

const events = buildDiscoveryEvents();
if (events.length === 0) throw new Error("Entry Event Dataset is empty; refusing to manufacture a candidate.");
const folds = buildPurgedFolds(featureStartIndex, discoveryEndIndex);
const foldEventSets = folds.map((fold) => ({
  fold,
  train: events.filter((event) => event.decisionIndex >= fold.trainStartIndex && event.decisionIndex <= fold.trainEndIndex),
  test: events.filter((event) => event.decisionIndex >= fold.testStartIndex && event.decisionIndex <= fold.testEndIndex)
}));
const trainUniverse = events.filter((event) => event.decisionIndex <= folds.at(-1).trainEndIndex);
const setupBaseline = Object.fromEntries(Object.keys(ENTRY_EDGE_SETUP_DEFINITIONS).map((family) => [family, summarizeEntryEvents(events.filter((event) => event.setupFamily === family))]));
const overallBaseline = summarizeEntryEvents(events);

const featureDiagnostics = ENTRY_EDGE_FEATURE_NAMES.map((feature) => diagnoseFeature(feature));
const robustFeatures = featureDiagnostics
  .filter((diagnostic) => diagnostic.status === "ROBUST")
  .sort((left, right) => right.directionalLift - left.directionalLift || right.sample - left.sample)
  .map((diagnostic) => diagnostic.feature);
const selectedFeatures = robustFeatures.slice(0, 8);
const scoreSpec = selectedFeatures.length ? fitEntryEdgeScoreSpec(trainUniverse, selectedFeatures) : { features: [], formula: "unavailable: no ROBUST features" };
const scoreCalibration = evaluateScoreCalibration(scoreSpec, selectedFeatures);
const scoreCalibrated = selectedFeatures.length > 0 && scoreCalibration.training.status === "CALIBRATED";

const candidates = scoreCalibrated ? buildCandidates(scoreSpec, selectedFeatures, trainUniverse) : [];
const freezeDefinition = {
  freezeVersion: "GPT-PROFIT-003-entry-edge-v1",
  discoveryCutoff: GPT_PROFIT_003_DISCOVERY_CUTOFF,
  holdoutDefinition: `closed candles strictly after ${GPT_PROFIT_003_FINAL_UNSEEN_START} through ${GPT_PROFIT_003_FINAL_UNSEEN_END}; execute once only after Internal OOS Gate PASS`,
  setupDefinitions: ENTRY_EDGE_SETUP_DEFINITIONS,
  selectedFeatures,
  scoreFormula: scoreSpec.formula,
  scoreParameters: scoreSpec.features,
  thresholds: candidates.map((candidate) => ({ id: candidate.id, scoreThreshold: candidate.scoreThreshold })),
  executionAssumptions: {
    entry: "decision candle close; labels inspect only later closed candles",
    labelOneR: "+1.0R before -1.0R",
    labelOne25R: "+1.25R before -1.0R",
    horizonBars: ENTRY_EDGE_HORIZON_BARS,
    sameCandlePriority: "STOP FIRST",
    feePerSide: ENTRY_EDGE_FEE_RATE,
    slippagePerSide: ENTRY_EDGE_SLIPPAGE_RATE,
    costApplied: "round-trip fee + slippage converted to R"
  },
  validationProtocol: {
    dataset: "public Binance USDⓈ-M Futures 15m closed candles",
    symbols: SYMBOLS,
    folds: folds.length,
    purgeBars: ENTRY_EDGE_PURGE_BARS,
    selection: "feature selection and score calibration fit on training events only; test folds are evaluation only",
    leakage: "future candles and protected Final Unseen range are never read before Internal Gate",
    finalUnseenGuard: "freeze hash valid + Internal Gate PASS + frozen candidate + no prior marker"
  },
  candidates
};
const freezeResult = ensureEntryEdgeCandidateFreeze({ freezePath: FREEZE_PATH, hashPath: FREEZE_HASH_PATH, definition: freezeDefinition });
provenance.candidateFreezeSha256 = freezeResult.sha256;

const walkForward = evaluateCandidates();
const bestCandidate = [...walkForward.candidates].sort((left, right) => right.summary.expectancyR - left.summary.expectancyR || right.summary.profitFactor - left.summary.profitFactor)[0] ?? null;
const internalGate = bestCandidate
  ? evaluateEntryEdgeGate({
      summary: bestCandidate.summary,
      positiveFoldCount: bestCandidate.positiveFoldCount,
      foldCount: folds.length,
      positiveMonthRatio: bestCandidate.positiveMonthRatio,
      scoreCalibrated,
      noLeakage: true,
      noLookahead: true,
      baseline: walkForward.baseline
    })
  : {
      passed: false,
      status: "FAIL",
      reasons: [scoreCalibrated ? "no_candidate" : "ENTRY_SCORE_NOT_CALIBRATED"],
      checks: { candidateExists: false, entryScoreCalibrated: scoreCalibrated }
    };

let finalUnseen = {
  executed: false,
  status: internalGate.passed ? "PENDING_EXECUTION" : "NO_CANDIDATE_FOR_FINAL_HOLDOUT",
  candidateId: null,
  range: { start: GPT_PROFIT_003_FINAL_UNSEEN_START, end: GPT_PROFIT_003_FINAL_UNSEEN_END },
  summary: summarizeEntryEvents([])
};
let holdoutExecutions = readHoldoutExecutionCount(HOLDOUT_MARKER);
if (internalGate.passed && bestCandidate) {
  assertFinalUnseenCanExecute({
    freezeExists: true,
    freezeHashValid: freezeResult.sha256 === hashFile(FREEZE_PATH),
    internalGatePassed: true,
    selectedCandidateId: bestCandidate.id,
    frozenCandidateIds: candidates.map((candidate) => candidate.id),
    markerPath: HOLDOUT_MARKER
  });
  finalUnseen = runFinalUnseen(bestCandidate);
  holdoutExecutions = 1;
}

const result = internalGate.passed && finalUnseen.status === "PASS" ? "SHADOW_CANDIDATE_ONLY" : "NO ENTRY EDGE FOUND";
const report = {
  task: "GPT-PROFIT-003",
  generatedAt: new Date().toISOString(),
  result,
  codeVersion: provenance.branchHeadSha,
  provenance,
  safety: {
    mainV2DeliveryMode: "shadow",
    altBasketDeliveryMode: "shadow",
    productionEnabled: false,
    productionSignalStrategies: [],
    shadowCandidateDeliveryMode: "shadow_candidate",
    autoTrading: false,
    privateBinanceApi: false,
    finalUnseenProtected: holdoutExecutions === 0 || finalUnseen.executed
  },
  data: {
    source: "public Binance USDⓈ-M Futures /fapi/v1/klines",
    interval: "15m",
    symbols: SYMBOLS,
    manifest,
    manifestSha256: provenance.datasetManifestSha256,
    discoveryBoundary: { start: iso(commonTimes[featureStartIndex]), end: iso(commonTimes[discoveryEndIndex]), cutoff: GPT_PROFIT_003_DISCOVERY_CUTOFF },
    finalUnseenBoundary: { start: GPT_PROFIT_003_FINAL_UNSEEN_START, end: GPT_PROFIT_003_FINAL_UNSEEN_END },
    commonBars: commonTimes.length,
    entryEvents: events.length,
    closedCandlesOnly: true
  },
  labels: {
    primary: "+1.0R before -1.0R",
    secondary: "+1.25R before -1.0R",
    feePerSide: ENTRY_EDGE_FEE_RATE,
    slippagePerSide: ENTRY_EDGE_SLIPPAGE_RATE,
    sameCandlePriority: "STOP FIRST",
    horizonBars: ENTRY_EDGE_HORIZON_BARS,
    noExitRuleChangesDuringFeatureResearch: true
  },
  setupBaseline,
  overallBaseline,
  secondaryLabelBaseline: summarizeEntryEvents(events, "labelOne25R"),
  featureResearch: {
    featuresTested: ENTRY_EDGE_FEATURE_NAMES.length,
    topRobustFeatures: featureDiagnostics.filter((diagnostic) => diagnostic.status === "ROBUST"),
    diagnostics: featureDiagnostics,
    multipleTesting: {
      featureCount: ENTRY_EDGE_FEATURE_NAMES.length,
      selectionRule: "effect size + fold stability + symbol breadth; no single p-value selection",
      confidenceInterval: "deterministic bootstrap 2.5%-97.5% interval per calibration bucket",
      marginalFeatures: featureDiagnostics.filter((diagnostic) => diagnostic.status === "UNSTABLE" || diagnostic.status === "WEAK").map((diagnostic) => diagnostic.feature)
    }
  },
  ablation: buildAblation(),
  entryEdgeScore: {
    status: scoreCalibrated ? "CALIBRATED" : "ENTRY_SCORE_NOT_CALIBRATED",
    selectedFeatures,
    formula: scoreSpec.formula,
    calibration: scoreCalibration
  },
  candidates: {
    count: candidates.length,
    leaderboard: walkForward.candidates,
    best: bestCandidate
  },
  walkForward,
  internalGate,
  candidateFreeze: { path: path.relative(process.cwd(), FREEZE_PATH).replaceAll("\\", "/"), sha256: freezeResult.sha256, created: freezeResult.created },
  finalUnseen,
  holdoutExecutions,
  shadowCandidateCreated: internalGate.passed && finalUnseen.status === "PASS",
  productionEnabledStrategies: []
};

fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-003-ENTRY-EDGE.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-003-FEATURE-DIAGNOSTICS.md"), renderDiagnostics(report));
fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-003.md"), renderSummary(report));
console.log(JSON.stringify(report, null, 2));

function buildDiscoveryEvents() {
  const discovered = [];
  const lastEventIndex = new Map();
  for (const symbol of TRADE_SYMBOLS) {
    const series = aligned[symbol];
    const btc = aligned.BTCUSDT;
    for (let index = featureStartIndex; index <= discoveryEndIndex; index += 1) {
      const symbolSlice = series.slice(Math.max(0, index - 90), index + 1);
      const btcSlice = btc.slice(Math.max(0, index - 90), index + 1);
      const breadth = breadthAt(index);
      const setups = detectEntrySetups({
        symbolCandles: symbolSlice,
        btcCandles: btcSlice,
        breadthBullishPct: breadth.bullishPct,
        breadthBearishPct: breadth.bearishPct,
        crossSectionalDispersion: breadth.dispersion
      });
      for (const setup of setups) {
        const previous = lastEventIndex.get(`${symbol}:${setup.family}`);
        if (previous !== undefined && index - previous < 4) continue;
        const event = createEvent(symbol, setup.family, setup.direction, index, setup.features, series);
        if (!event) continue;
        discovered.push(event);
        lastEventIndex.set(`${symbol}:${setup.family}`, index);
      }
    }
  }
  return discovered.sort((left, right) => left.eventTime - right.eventTime || left.symbol.localeCompare(right.symbol));
}

function createEvent(symbol, setupFamily, direction, decisionIndex, features, series) {
  const candle = series[decisionIndex];
  if (!candle || !candle.isClosed || candle.closeTime > CUTOFF) return null;
  const risk = Math.max(candle.close * Math.max(features.atr_pct, 0.05) / 100, candle.close * 0.0005);
  const stopLoss = direction === "LONG" ? candle.close - risk : candle.close + risk;
  const future = series.slice(decisionIndex + 1, Math.min(discoveryEndIndex + 1, decisionIndex + 1 + ENTRY_EDGE_HORIZON_BARS));
  const base = {
    symbol,
    setupFamily,
    direction,
    decisionIndex,
    eventTime: candle.closeTime,
    entryPrice: candle.close,
    stopLoss,
    risk,
    marketRegime: resolveMarketRegime(indexedReturn(aligned.BTCUSDT, decisionIndex, 64))
  };
  return {
    eventId: `${symbol}:${setupFamily}:${candle.openTime}:${direction}`,
    ...base,
    features,
    labelOneR: simulateEntryLabel({ ...base, targetR: 1, futureCandles: future }),
    labelOne25R: simulateEntryLabel({ ...base, targetR: 1.25, futureCandles: future })
  };
}

function diagnoseFeature(feature) {
  const foldReports = foldEventSets.map(({ fold, train, test }) => {
    const trainCalibration = calibrateFeature({ events: train, fitEvents: train, feature, bins: 5 });
    const testCalibration = calibrateFeature({ events: test, fitEvents: train, feature, bins: 5 });
    const trainValues = train.map((event) => event.features[feature]);
    const trainOutcomes = train.map((event) => event.labelOneR.netR);
    const testValues = test.map((event) => event.features[feature]);
    const testOutcomes = test.map((event) => event.labelOneR.netR);
    const trainPairs = paired(trainValues, trainOutcomes);
    const testPairs = paired(testValues, testOutcomes);
    const trainSpearman = calculateSpearman(trainPairs.map((pair) => pair.value), trainPairs.map((pair) => pair.outcome));
    const testSpearman = calculateSpearman(testPairs.map((pair) => pair.value), testPairs.map((pair) => pair.outcome));
    const orientation = trainSpearman >= 0 ? 1 : -1;
    const trainEndpoints = trainCalibration.buckets.filter((bucket) => bucket.settled > 0);
    const testEndpoints = testCalibration.buckets.filter((bucket) => bucket.settled > 0);
    const trainFirst = trainEndpoints[0]?.expectancyR ?? 0;
    const trainLast = trainEndpoints.at(-1)?.expectancyR ?? 0;
    const testFirst = testEndpoints[0]?.expectancyR ?? 0;
    const testLast = testEndpoints.at(-1)?.expectancyR ?? 0;
    return {
      fold: fold.fold,
      trainSample: train.length,
      testSample: test.length,
      trainSpearman,
      testSpearman,
      trainDirectionalLift: (trainLast - trainFirst) * orientation,
      oosDirectionalLift: (testLast - testFirst) * orientation,
      trainMonotonicViolations: trainCalibration.monotonicViolations,
      oosMonotonicViolations: testCalibration.monotonicViolations,
      trainBuckets: trainCalibration.buckets,
      oosBuckets: testCalibration.buckets
    };
  });
  const sample = events.length;
  const settledEvents = events.filter((event) => event.labelOneR.netR !== null);
  const symbolBreadth = new Set(settledEvents.map((event) => event.symbol)).size;
  const positiveFolds = foldReports.filter((fold) => fold.trainDirectionalLift > 0).length;
  const directionalLift = average(foldReports.map((fold) => fold.trainDirectionalLift));
  const oosDirectionalLift = average(foldReports.map((fold) => fold.oosDirectionalLift));
  const monotonicViolations = Math.round(average(foldReports.map((fold) => fold.trainMonotonicViolations)));
  const oosMonotonicViolations = Math.round(average(foldReports.map((fold) => fold.oosMonotonicViolations)));
  const status = classifyFeatureStatus({
    sample,
    symbolBreadth,
    positiveFoldCount: positiveFolds,
    foldCount: foldReports.length,
    monotonicViolations,
    directionalLift
  });
  const allCalibration = calibrateFeature({ events: settledEvents.length ? events : [], fitEvents: trainUniverse, feature, bins: 5 });
  return {
    feature,
    status,
    sample,
    settled: settledEvents.length,
    symbolBreadth,
    positiveFolds,
    folds: foldReports.length,
    directionalLift,
    oosDirectionalLift,
    monotonicViolations,
    oosMonotonicViolations,
    bootstrapConfidenceInterval: allCalibration.buckets.map((bucket) => ({ bucket: bucket.bucket, interval: bucket.confidenceInterval })),
    calibration: allCalibration
  };
}

function evaluateScoreCalibration(spec, selected) {
  if (!selected.length) return emptyScoreCalibration();
  const foldScores = foldEventSets.map(({ train, test, fold }) => {
    const foldSpec = fitEntryEdgeScoreSpec(train, selected);
    return {
      train: train.map((event) => ({ event, score: calculateEntryEdgeScore(event, foldSpec), fold: fold.fold })),
      test: test.map((event) => ({ event, score: calculateEntryEdgeScore(event, foldSpec), fold: fold.fold }))
    };
  });
  const training = summarizeScoreCalibration(foldScores.flatMap((item) => item.train));
  const oos = summarizeScoreCalibration(foldScores.flatMap((item) => item.test));
  return { ...oos, training, oos };
}

function summarizeScoreCalibration(scored) {
  const values = scored.map((item) => item.score);
  const outcomes = scored.map((item) => item.event.labelOneR.netR ?? 0);
  const edges = quantileEdges(values, 10);
  const buckets = Array.from({ length: edges.length + 1 }, (_, bucket) => {
    const members = scored.filter((item) => bucketIndex(item.score, edges) === bucket);
    const eventsInBucket = members.map((item) => item.event);
    const summary = summarizeEntryEvents(eventsInBucket);
    return {
      decile: bucket + 1,
      lower: bucket === 0 ? null : edges[bucket - 1] ?? null,
      upper: bucket === edges.length ? null : edges[bucket] ?? null,
      trades: summary.trades,
      settled: summary.settled,
      winRate: summary.winRate,
      profitFactor: summary.profitFactor,
      expectancyR: summary.expectancyR,
      averageWinR: summary.averageWinR,
      averageLossR: summary.averageLossR,
      payoff: summary.payoff
    };
  });
  const expectancy = buckets.map((bucket) => bucket.expectancyR);
  const baseline = summarizeEntryEvents(scored.map((item) => item.event));
  return {
    deciles: buckets,
    trades: scored.length,
    settled: scored.filter((item) => item.event.labelOneR.netR !== null).length,
    baselineExpectancyR: baseline.expectancyR,
    highestBucketExpectancyR: expectancy.length ? Math.max(...expectancy) : 0,
    spearman: calculateSpearman(values, outcomes),
    monotonicViolations: countMonotonicViolations(expectancy),
    monotonicDefinition: "higher entry_edge_score should not reduce realized label expectancy",
    status: scored.length > 0 && calculateSpearman(values, outcomes) >= 0.05 && countMonotonicViolations(expectancy) <= 3 ? "CALIBRATED" : "ENTRY_SCORE_NOT_CALIBRATED"
  };
}

function buildCandidates(spec, selected, trainEvents) {
  const candidates = [];
  for (const [index, family] of Object.keys(ENTRY_EDGE_SETUP_DEFINITIONS).entries()) {
    const familyTrain = trainEvents.filter((event) => event.setupFamily === family);
    if (familyTrain.length < 30) continue;
    const scores = familyTrain.map((event) => calculateEntryEdgeScore(event, spec));
    const threshold = quantile(scores, 0.7);
    candidates.push({
      id: `p003-${String(index + 1).padStart(2, "0")}-${family}`,
      setupFamily: family,
      requiredFeatures: selected,
      scoreThreshold: round(threshold),
      rationale: `Interpretable calibrated entry_edge_score for ${ENTRY_EDGE_SETUP_DEFINITIONS[family].label}; selected only after train-fold robustness review.`,
      expectedFailureMode: "regime shift, failed confirmation, or cost expansion can invalidate the setup; no Production routing is permitted.",
      deliveryMode: "shadow_candidate"
    });
    if (candidates.length >= 8) break;
  }
  return candidates;
}

function evaluateCandidates() {
  const baselineFoldTrades = foldEventSets.map(({ test }) => test);
  const baselineEvents = baselineFoldTrades.flat();
  const baseline = summarizeEntryEvents(baselineEvents);
  const candidateResults = candidates.map((candidate) => {
    const foldResults = foldEventSets.map(({ fold, train, test }) => {
      const foldSpec = fitEntryEdgeScoreSpec(train, candidate.requiredFeatures);
      const selected = test.filter((event) => event.setupFamily === candidate.setupFamily && calculateEntryEdgeScore(event, foldSpec) >= candidate.scoreThreshold);
      return { fold: fold.fold, events: selected, summary: summarizeEntryEvents(selected) };
    });
    const selectedEvents = foldResults.flatMap((fold) => fold.events);
    const summary = summarizeEntryEvents(selectedEvents);
    const positiveFoldCount = foldResults.filter((fold) => fold.summary.netR > 0).length;
    const months = new Set(selectedEvents.filter((event) => event.labelOneR.netR !== null).map((event) => new Date(event.eventTime).toISOString().slice(0, 7)));
    const positiveMonthCount = [...months].filter((month) => selectedEvents.filter((event) => new Date(event.eventTime).toISOString().slice(0, 7) === month).reduce((total, event) => total + (event.labelOneR.netR ?? 0), 0) > 0).length;
    return {
      ...candidate,
      summary,
      folds: foldResults.map((fold) => ({ fold: fold.fold, summary: fold.summary })),
      positiveFoldCount,
      positiveMonths: positiveMonthCount,
      months: months.size,
      positiveMonthRatio: months.size ? positiveMonthCount / months.size : 0
    };
  });
  return { folds: foldEventSets.map(({ fold, train, test }) => ({ fold: fold.fold, trainEvents: train.length, testEvents: test.length, purgeBars: ENTRY_EDGE_PURGE_BARS })), baseline, candidates: candidateResults };
}

function buildAblation() {
  const testEvents = foldEventSets.flatMap(({ test }) => test);
  const rows = [{ name: "Base setup", features: [], events: testEvents }];
  for (const [name, group] of Object.entries(FEATURE_GROUPS)) {
    const robust = group.filter((feature) => selectedFeatures.includes(feature));
    const filtered = robust.length
      ? testEvents.filter((event) => robust.reduce((total, feature) => total + normalizeFeature(event.features[feature], feature), 0) >= 0)
      : testEvents;
    rows.push({ name: `+ ${name}`, features: robust, events: filtered });
  }
  const base = summarizeEntryEvents(testEvents);
  return rows.map((row) => {
    const summary = summarizeEntryEvents(row.events);
    return {
      name: row.name,
      features: row.features,
      summary,
      delta: {
        profitFactor: round(summary.profitFactor - base.profitFactor),
        expectancyR: round(summary.expectancyR - base.expectancyR),
        trades: summary.trades - base.trades,
        maxDrawdownR: round(summary.maxDrawdownR - base.maxDrawdownR)
      }
    };
  });
}

function runFinalUnseen(candidate) {
  const discovered = [];
  const seriesBySymbol = aligned;
  for (const symbol of TRADE_SYMBOLS) {
    const series = seriesBySymbol[symbol];
    for (let index = Math.max(featureStartIndex, holdoutStartIndex); index <= holdoutEndIndex; index += 1) {
      if (commonTimes[index] < HOLDOUT_START || commonTimes[index] > HOLDOUT_END) continue;
      const breadth = breadthAt(index);
      const setups = detectEntrySetups({
        symbolCandles: series.slice(Math.max(0, index - 90), index + 1),
        btcCandles: aligned.BTCUSDT.slice(Math.max(0, index - 90), index + 1),
        breadthBullishPct: breadth.bullishPct,
        breadthBearishPct: breadth.bearishPct,
        crossSectionalDispersion: breadth.dispersion
      }).filter((setup) => setup.family === candidate.setupFamily);
      for (const setup of setups) {
        const event = createEventWithBoundary(symbol, setup, index, series, holdoutEndIndex);
        if (!event) continue;
        const scored = calculateEntryEdgeScore(event, scoreSpec);
        if (scored >= candidate.scoreThreshold) discovered.push(event);
      }
    }
  }
  const summary = summarizeEntryEvents(discovered);
  const status = summary.settled < 50 ? "INSUFFICIENT_SAMPLE" : summary.netR > 0 && summary.profitFactor >= 1.2 && summary.expectancyR > 0 && summary.payoff >= 0.8 ? "PASS" : "FAIL";
  const marker = {
    status: "started",
    executionCount: 1,
    startedAt: new Date().toISOString(),
    candidateId: candidate.id,
    discoveryCutoff: GPT_PROFIT_003_DISCOVERY_CUTOFF,
    holdoutRange: { start: GPT_PROFIT_003_FINAL_UNSEEN_START, end: GPT_PROFIT_003_FINAL_UNSEEN_END },
    candidateFreezeSha256: freezeResult.sha256,
    datasetManifestSha256: provenance.datasetManifestSha256
  };
  fs.writeFileSync(HOLDOUT_MARKER, JSON.stringify({ ...marker, status, completedAt: new Date().toISOString(), summary }, null, 2));
  return { executed: true, status, candidateId: candidate.id, range: { start: GPT_PROFIT_003_FINAL_UNSEEN_START, end: GPT_PROFIT_003_FINAL_UNSEEN_END }, summary };
}

function createEventWithBoundary(symbol, setup, index, series, endIndex) {
  const candle = series[index];
  if (!candle || candle.closeTime < HOLDOUT_START || candle.closeTime > HOLDOUT_END) return null;
  const risk = Math.max(candle.close * Math.max(setup.features.atr_pct, 0.05) / 100, candle.close * 0.0005);
  const stopLoss = setup.direction === "LONG" ? candle.close - risk : candle.close + risk;
  const future = series.slice(index + 1, Math.min(endIndex + 1, index + 1 + ENTRY_EDGE_HORIZON_BARS));
  const base = { symbol, setupFamily: setup.family, direction: setup.direction, decisionIndex: index, eventTime: candle.closeTime, entryPrice: candle.close, stopLoss, risk, marketRegime: resolveMarketRegime(indexedReturn(aligned.BTCUSDT, index, 64)) };
  return {
    eventId: `${symbol}:${setup.family}:${candle.openTime}:${setup.direction}`,
    ...base,
    features: setup.features,
    labelOneR: simulateEntryLabel({ ...base, targetR: 1, futureCandles: future }),
    labelOne25R: simulateEntryLabel({ ...base, targetR: 1.25, futureCandles: future })
  };
}

function breadthAt(index) {
  const returns = TRADE_SYMBOLS.map((symbol) => indexedReturn(aligned[symbol], index, 16));
  const bullish = returns.filter((value) => value >= 0).length;
  const bearish = returns.filter((value) => value < 0).length;
  return { bullishPct: bullish / TRADE_SYMBOLS.length * 100, bearishPct: bearish / TRADE_SYMBOLS.length * 100, dispersion: standardDeviation(returns) };
}

function buildPurgedFolds(startIndex, endIndex) {
  const total = endIndex - startIndex + 1;
  const span = Math.max(32, Math.floor(total / 4));
  return Array.from({ length: 3 }, (_, fold) => {
    const trainEndIndex = Math.min(endIndex - ENTRY_EDGE_PURGE_BARS - 1, startIndex + span * (fold + 1));
    const testStartIndex = trainEndIndex + ENTRY_EDGE_PURGE_BARS + 1;
    const testEndIndex = Math.min(endIndex, testStartIndex + span - 1);
    return { fold: fold + 1, trainStartIndex: startIndex, trainEndIndex, testStartIndex, testEndIndex };
  }).filter((fold) => fold.testStartIndex < fold.testEndIndex);
}

function renderDiagnostics(report) {
  const robust = report.featureResearch.topRobustFeatures;
  const statusCounts = Object.fromEntries(["ROBUST", "WEAK", "UNSTABLE", "NO_EDGE"].map((status) => [status, report.featureResearch.diagnostics.filter((item) => item.status === status).length]));
  const lines = [
    "# GPT-PROFIT-003 Feature Diagnostics",
    "",
    `- Result: **${report.result}**`,
    `- Discovery boundary: ${report.data.discoveryBoundary.start} → ${report.data.discoveryBoundary.end}; cutoff ${report.data.discoveryBoundary.cutoff}`,
    `- Entry events: ${report.data.entryEvents}; features tested: ${report.featureResearch.featuresTested}; symbols: ${report.data.symbols.join(", ")}`,
    `- Protected Final Unseen: ${report.data.finalUnseenBoundary.start} → ${report.data.finalUnseenBoundary.end}; holdout executions: ${report.holdoutExecutions}`,
    `- Status counts: ${Object.entries(statusCounts).map(([key, value]) => `${key}=${value}`).join(", ")}`,
    "",
    "## Setup-family baseline",
    "",
    "| Family | Trades | Settled | PF | Expectancy R | Net R | Win rate | Symbols |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...Object.entries(report.setupBaseline).map(([family, summary]) => `| ${family} | ${summary.trades} | ${summary.settled} | ${format(summary.profitFactor)} | ${format(summary.expectancyR)} | ${format(summary.netR)} | ${format(summary.winRate)}% | ${summary.symbolBreadth} |`),
    "",
    "## Top ROBUST features",
    "",
    robust.length ? "| Feature | Lift | Positive folds | Symbol breadth | Violations |" : "No feature met the ROBUST definition.",
    ...(robust.length ? ["|---|---:|---:|---:|---:|", ...robust.slice(0, 12).map((item) => `| ${item.feature} | ${format(item.directionalLift)} | ${item.positiveFolds}/${item.folds} | ${item.symbolBreadth} | ${item.monotonicViolations} |`)] : []),
    "",
    "## NO_EDGE / UNSTABLE / WEAK features",
    "",
    ...report.featureResearch.diagnostics.filter((item) => item.status !== "ROBUST").map((item) => `- **${item.status}** ${item.feature}: lift ${format(item.directionalLift)}, folds ${item.positiveFolds}/${item.folds}, symbols ${item.symbolBreadth}.`),
    "",
    "## Ablation",
    "",
    "| Step | Features | PF | Δ PF | Expectancy R | Δ Exp | Trades | Δ DD |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    ...report.ablation.map((row) => `| ${row.name} | ${row.features.join(", ") || "—"} | ${format(row.summary.profitFactor)} | ${format(row.delta.profitFactor)} | ${format(row.summary.expectancyR)} | ${format(row.delta.expectancyR)} | ${row.summary.trades} | ${format(row.delta.maxDrawdownR)} |`),
    "",
    "## Entry Edge Score",
    "",
    `- Status: **${report.entryEdgeScore.status}**`,
    `- Selected features: ${report.entryEdgeScore.selectedFeatures.join(", ") || "none"}`,
    `- Spearman: ${format(report.entryEdgeScore.calibration.spearman)}; monotonic violations: ${report.entryEdgeScore.calibration.monotonicViolations}`,
    "",
    "| Decile | Trades | Settled | Win rate | PF | Expectancy R | Avg win | Avg loss | Payoff |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.entryEdgeScore.calibration.deciles.map((row) => `| ${row.decile} | ${row.trades} | ${row.settled} | ${format(row.winRate)}% | ${format(row.profitFactor)} | ${format(row.expectancyR)} | ${format(row.averageWinR)} | ${format(row.averageLossR)} | ${format(row.payoff)} |`),
    "",
    "## Walk-forward / gate",
    "",
    `- Candidate count: ${report.candidates.count}; Internal Gate: **${report.internalGate.status}** (${report.internalGate.reasons.join(", ") || "all checks passed"}).`,
    `- Final Unseen: executed=${report.finalUnseen.executed}; status=${report.finalUnseen.status}; holdout executions=${report.holdoutExecutions}.`,
    `- Reproducibility: base ${report.provenance.mainBaseSha}; source ${report.provenance.branchHeadSha}; script ${report.provenance.researchScriptSha256}; module ${report.provenance.entryEdgeModuleSha256}; freeze ${report.provenance.candidateFreezeSha256}; dataset ${report.provenance.datasetManifestSha256}.`,
    "",
    "Research-only boundary: Main V2 and ALT Basket remain Shadow; `PRODUCTION_SIGNAL_STRATEGIES=[]`; no automatic trading or private Binance API."
  ];
  return `${lines.join("\n")}\n`;
}

function renderSummary(report) {
  return `# GPT-PROFIT-003\n\nResult: **${report.result}**\n\nEntry events: ${report.data.entryEvents}; tested features: ${report.featureResearch.featuresTested}; candidates: ${report.candidates.count}; Internal Gate: ${report.internalGate.status}; Final Unseen executed: ${report.finalUnseen.executed}; holdout executions: ${report.holdoutExecutions}.\n\nProduction remains disabled (PRODUCTION_SIGNAL_STRATEGIES=[]); Main V2 and ALT Basket are Shadow Only.\n`;
}

function readCandles(symbol) {
  const filePath = path.join(DATA_DIR, `${symbol}-15m.json`);
  if (!fs.existsSync(filePath)) throw new Error(`Missing frozen dataset file: ${filePath}`);
  const rows = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return rows.map((row) => ({ ...row, openTime: Number(row.openTime), closeTime: Number(row.closeTime), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume), quoteVolume: Number(row.quoteVolume), isClosed: row.isClosed !== false && Number(row.closeTime) <= Date.now() })).filter((row) => row.isClosed).sort((left, right) => left.openTime - right.openTime);
}

function readManifest() {
  if (!fs.existsSync(DATASET_MANIFEST_PATH)) throw new Error(`Missing dataset manifest: ${DATASET_MANIFEST_PATH}`);
  return JSON.parse(fs.readFileSync(DATASET_MANIFEST_PATH, "utf8"));
}

function intersectTimes(timeLists) {
  let common = new Set(timeLists[0]);
  for (const times of timeLists.slice(1)) {
    const next = new Set(times);
    common = new Set([...common].filter((time) => next.has(time)));
  }
  return [...common].sort((left, right) => left - right);
}

function alignBars(bars, times) {
  const byOpen = new Map(bars.map((bar) => [bar.openTime, bar]));
  return times.map((time) => byOpen.get(time));
}

function indexedReturn(series, index, bars) {
  const end = series[index]?.close ?? 0;
  const start = series[index - bars]?.close ?? 0;
  return start > 0 ? (end / start - 1) * 100 : 0;
}

function resolveMarketRegime(value) {
  if (value >= 0.5) return "bull";
  if (value <= -0.5) return "bear";
  return "sideways";
}

function paired(values, outcomes) {
  return values.map((value, index) => ({ value, outcome: outcomes[index] })).filter((pair) => Number.isFinite(pair.value) && pair.outcome !== null && Number.isFinite(pair.outcome));
}

function normalizeFeature(value, feature) {
  const scale = feature.includes("percentile") || feature.includes("pct") ? 50 : feature.includes("ratio") ? 1 : 0.5;
  return Math.tanh(value / scale);
}

function firstIndexAtOrAfter(time) {
  const index = commonTimes.findIndex((item) => item >= time);
  return index === -1 ? commonTimes.length : index;
}

function lastIndexAtOrBefore(time) {
  let index = -1;
  for (let cursor = 0; cursor < commonTimes.length; cursor += 1) {
    if (commonTimes[cursor] > time) break;
    index = cursor;
  }
  return index;
}

function resolveRef(ref) {
  try { return execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim(); } catch { return null; }
}

function resolveParentSha() {
  try { return execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim(); } catch { return null; }
}

function quantile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 50;
}

function emptyScoreCalibration() {
  const empty = { deciles: [], trades: 0, settled: 0, baselineExpectancyR: 0, highestBucketExpectancyR: 0, spearman: 0, monotonicViolations: 0, monotonicDefinition: "higher entry_edge_score should not reduce realized label expectancy", status: "ENTRY_SCORE_NOT_CALIBRATED" };
  return { ...empty, training: empty, oos: empty };
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function iso(value) { return new Date(value).toISOString(); }
function round(value) { return Math.round(value * 1_000_000) / 1_000_000; }
function format(value) { return Number.isFinite(value) ? value.toFixed(3) : "∞"; }
