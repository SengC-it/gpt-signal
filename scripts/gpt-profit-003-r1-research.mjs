import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ENTRY_EDGE_FEATURE_NAMES,
  ENTRY_EDGE_FEE_RATE,
  ENTRY_EDGE_HORIZON_BARS,
  ENTRY_EDGE_SETUP_DEFINITIONS,
  ENTRY_EDGE_SLIPPAGE_RATE,
  GPT_PROFIT_003_DISCOVERY_CUTOFF,
  GPT_PROFIT_003_FINAL_UNSEEN_END,
  GPT_PROFIT_003_FINAL_UNSEEN_START,
  detectEntrySetups,
  simulateEntryLabel
} from "../src/lib/signal/entry-edge.ts";
import {
  ENTRY_EDGE_R1_INNER_PURGE_BARS,
  ENTRY_EDGE_R1_LABEL_HORIZON_BARS,
  ENTRY_EDGE_R1_OUTER_PURGE_BARS,
  ENTRY_EDGE_R1_THRESHOLD_QUANTILE,
  assertR1FinalUnseenCanExecute,
  assertTrainLabelsBeforeTest,
  buildR1TimeFolds,
  calculateR1Score,
  calculateR1Spearman,
  countR1MonotonicViolations,
  deduplicateR1Features,
  ensureR1CandidateFreeze,
  evaluateR1Gate,
  fitR1GrossScoreSpec,
  hashR1File,
  quantileThreshold,
  summarizeR1Outcomes,
  summarizeR1ScoreRows,
} from "../src/lib/signal/entry-edge-r1.ts";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"];
const TRADE_SYMBOLS = SYMBOLS.filter((symbol) => symbol !== "BTCUSDT");
const DATA_DIR = path.join(process.cwd(), ".cache", "historical-backtest", process.env.PROFITABILITY_003_CACHE_KEY || "profit-002-latest");
const REPORT_DIR = path.join(process.cwd(), "reports");
const DATASET_MANIFEST_PATH = path.join(REPORT_DIR, "GPT-PROFIT-002-DATA-MANIFEST.json");
const V1_FREEZE_PATH = path.join(REPORT_DIR, "GPT-PROFIT-003-CANDIDATE-FREEZE.json");
const R1_FREEZE_PATH = path.join(REPORT_DIR, "GPT-PROFIT-003-R1-CANDIDATE-FREEZE.json");
const R1_FREEZE_HASH_PATH = path.join(REPORT_DIR, "GPT-PROFIT-003-R1-CANDIDATE-FREEZE.sha256");
const V1_HOLDOUT_MARKER = path.join(REPORT_DIR, "GPT-PROFIT-003-FINAL-UNSEEN-EXECUTION.json");
const R1_HOLDOUT_MARKER = path.join(REPORT_DIR, "GPT-PROFIT-003-R1-FINAL-UNSEEN-EXECUTION.json");
const CUTOFF = Date.parse(GPT_PROFIT_003_DISCOVERY_CUTOFF);
const HOLDOUT_START = Date.parse(GPT_PROFIT_003_FINAL_UNSEEN_START);
const HOLDOUT_END = Date.parse(GPT_PROFIT_003_FINAL_UNSEEN_END);
const FEATURE_START_INDEX = 80;
const FEATURE_GROUPS = {
  trend: ["trend_return_15m", "trend_return_1h", "trend_return_4h", "trend_return_12h", "trend_slope_short", "trend_slope_medium", "trend_alignment_long"],
  structure: ["structure_distance_rolling_high", "structure_distance_rolling_low", "breakout_distance_atr", "pullback_depth_atr", "retracement_ratio", "structure_age"],
  volatility: ["atr_pct", "atr_percentile", "recent_range_atr", "compression_ratio", "expansion_ratio"],
  volume: ["volume_ratio", "quote_volume_ratio", "volume_percentile", "volume_expansion"],
  relativeStrength: ["relative_strength_1h", "relative_strength_4h", "relative_strength_12h"],
  marketBreadth: ["btc_trend_1h", "btc_trend_4h", "btc_volatility_state", "breadth_bullish_pct", "breadth_bearish_pct", "cross_sectional_dispersion"]
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
if (fs.existsSync(V1_HOLDOUT_MARKER) || fs.existsSync(R1_HOLDOUT_MARKER)) {
  throw new Error("GPT-PROFIT-003 Final Unseen marker exists; R1 refuses a second holdout execution");
}

const candlesBySymbol = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, readCandles(symbol)]));
const commonTimes = intersectTimes(SYMBOLS.map((symbol) => candlesBySymbol[symbol].map((candle) => candle.openTime)));
if (commonTimes.length < 1000) throw new Error(`Insufficient common candle history: ${commonTimes.length}`);
const aligned = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, alignBars(candlesBySymbol[symbol], commonTimes)]));
const discoveryEndIndex = lastIndexAtOrBefore(CUTOFF);
const holdoutStartIndex = firstIndexAtOrAfter(HOLDOUT_START);
const holdoutEndIndex = lastIndexAtOrBefore(HOLDOUT_END);
if (discoveryEndIndex <= FEATURE_START_INDEX || holdoutStartIndex > holdoutEndIndex) {
  throw new Error("Discovery or protected holdout boundary is not present in the frozen dataset");
}

const manifest = readManifest();
const provenance = {
  mainBaseSha: resolveRef("origin/main") ?? resolveRef("main"),
  branchHeadSha: resolveRef("HEAD"),
  sourceParentSha: resolveParentSha(),
  r1ResearchScriptSha256: hashR1File(path.resolve(process.cwd(), "scripts", "gpt-profit-003-r1-research.mjs")),
  r1ModuleSha256: hashR1File(path.resolve(process.cwd(), "src", "lib", "signal", "entry-edge-r1.ts")),
  v1CandidateFreezeSha256: fs.existsSync(V1_FREEZE_PATH) ? hashR1File(V1_FREEZE_PATH) : null,
  r1CandidateFreezeSha256: null,
  datasetManifestSha256: hashR1File(DATASET_MANIFEST_PATH)
};

const events = buildDiscoveryEvents();
if (!events.length) throw new Error("Entry Event Dataset is empty; refusing to manufacture R1 candidates");
const outerFolds = buildR1TimeFolds({
  startIndex: FEATURE_START_INDEX,
  endIndex: discoveryEndIndex,
  foldCount: 3,
  purgeBars: ENTRY_EDGE_R1_OUTER_PURGE_BARS
});
if (outerFolds.length !== 3) throw new Error(`Expected 3 outer folds, received ${outerFolds.length}`);

const outerSets = outerFolds.map((fold) => makeFoldSet(fold));
const rawFeaturePanel = [...ENTRY_EDGE_FEATURE_NAMES];
const freezeDefinition = {
  freezeVersion: "GPT-PROFIT-003-entry-edge-r1-v1",
  discoveryCutoff: GPT_PROFIT_003_DISCOVERY_CUTOFF,
  holdoutDefinition: `closed candles strictly after ${GPT_PROFIT_003_FINAL_UNSEEN_START} through ${GPT_PROFIT_003_FINAL_UNSEEN_END}; execute once only after R1 Internal OOS Gate PASS`,
  setupDefinitions: ENTRY_EDGE_SETUP_DEFINITIONS,
  rawFeaturePanel,
  nestedValidationProtocol: {
    outerFolds: outerFolds.length,
    innerFoldsPerOuter: 3,
    outerPurgeBars: ENTRY_EDGE_R1_OUTER_PURGE_BARS,
    innerPurgeBars: ENTRY_EDGE_R1_INNER_PURGE_BARS,
    labelHorizonBars: ENTRY_EDGE_R1_LABEL_HORIZON_BARS,
    trainLabelRule: "every train event must satisfy decisionIndex + labelHorizonBars < testStartIndex",
    selection: "inner time-series folds only; outer test is evaluation only",
    thresholdCalibration: "top 30% entry_edge_score within setup family, fitted separately inside each outer train",
    testIsolation: "outer-test outcomes cannot affect features, orientation, weights, or thresholds"
  },
  featureDeduplication: {
    exactAlias: true,
    correlationThreshold: 0.98,
    groupRule: "at most one representative per highly correlated feature group; representative selected from training effect size"
  },
  candidateTemplates: Object.keys(ENTRY_EDGE_SETUP_DEFINITIONS).map((family, index) => ({
    id: `p003-r1-${String(index + 1).padStart(2, "0")}-${family}`,
    setupFamily: family,
    thresholdRule: "top 30% of entry_edge_score within this family in each outer training window",
    deliveryMode: "shadow_candidate"
  })),
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
    rawFeatureCount: rawFeaturePanel.length,
    finalUnseenGuard: "R1 freeze hash valid + Internal OOS Gate PASS + frozen candidate + no prior marker"
  }
};
const freezeResult = ensureR1CandidateFreeze({ freezePath: R1_FREEZE_PATH, hashPath: R1_FREEZE_HASH_PATH, definition: freezeDefinition });
provenance.r1CandidateFreezeSha256 = freezeResult.sha256;

const foldReports = outerSets.map((set) => analyzeOuterFold(set));
const trainScoreRows = foldReports.flatMap((report) => report.trainScoreRows);
const outerTestScoreRows = foldReports.flatMap((report) => report.testScoreRows);
const scoreCalibration = {
  gross: summarizeR1ScoreRows(outerTestScoreRows, "grossR", 10),
  net: summarizeR1ScoreRows(outerTestScoreRows, "netR", 10),
  trainingGross: summarizeR1ScoreRows(trainScoreRows, "grossR", 10),
  trainingNet: summarizeR1ScoreRows(trainScoreRows, "netR", 10)
};
const candidateLeaderboard = buildCandidateLeaderboard();
const bestCandidate = [...candidateLeaderboard].sort((left, right) => right.netSummary.expectancyR - left.netSummary.expectancyR || right.netSummary.profitFactor - left.netSummary.profitFactor)[0] ?? null;
const outerBaseline = summarizeR1Outcomes(outerTestScoreRows.map((row) => row.event), "netR");
const leakageAssertion = foldReports.every((report) => report.leakageAssertion && report.innerFolds.every((inner) => inner.leakageAssertion));
const internalGate = bestCandidate
  ? evaluateR1Gate({
      summary: bestCandidate.netSummary,
      positiveFoldCount: bestCandidate.positiveFoldCount,
      foldCount: outerFolds.length,
      positiveMonthRatio: bestCandidate.positiveMonthRatio,
      trainingScoreStatus: scoreCalibration.trainingGross.status,
      oosScoreStatus: scoreCalibration.gross.status,
      oosGrossSpearman: scoreCalibration.gross.spearman,
      oosNetSpearman: scoreCalibration.net.spearman,
      oosMonotonicViolations: scoreCalibration.gross.monotonicViolations,
      highestGrossBucketExpectancyR: scoreCalibration.gross.highestBucketExpectancyR,
      grossBaselineExpectancyR: scoreCalibration.gross.baselineExpectancyR,
      noLeakage: leakageAssertion,
      noLookahead: true,
      baseline: outerBaseline
    })
  : { passed: false, status: "FAIL", reasons: ["no_candidate"], checks: { candidateExists: false } };

let finalUnseen = {
  executed: false,
  status: internalGate.passed ? "PENDING_EXECUTION" : "NO_CANDIDATE_FOR_FINAL_HOLDOUT",
  candidateId: null,
  range: { start: GPT_PROFIT_003_FINAL_UNSEEN_START, end: GPT_PROFIT_003_FINAL_UNSEEN_END },
  grossSummary: null,
  netSummary: null
};
const holdoutExecutions = readHoldoutExecutions();
if (internalGate.passed && bestCandidate) {
  assertR1FinalUnseenCanExecute({
    freezeExists: true,
    freezeHashValid: freezeResult.sha256 === hashR1File(R1_FREEZE_PATH),
    internalGatePassed: true,
    selectedCandidateId: bestCandidate.id,
    frozenCandidateIds: freezeDefinition.candidateTemplates.map((candidate) => candidate.id),
    markerPath: R1_HOLDOUT_MARKER
  });
  finalUnseen = runFinalUnseen(bestCandidate);
}

const report = {
  task: "GPT-PROFIT-003-R1",
  generatedAt: new Date().toISOString(),
  result: internalGate.passed && finalUnseen.status === "PASS" ? "SHADOW_CANDIDATE_ONLY" : "NO ENTRY EDGE FOUND",
  provenance,
  safety: {
    mainV2DeliveryMode: "shadow",
    altBasketDeliveryMode: "shadow",
    productionSignalStrategies: [],
    productionEnabled: false,
    autoTrading: false,
    privateBinanceApi: false,
    accountAccess: false,
    positionControl: false,
    automaticOrders: false,
    automaticLeverage: false
  },
  data: {
    source: "public Binance USDⓈ-M Futures /fapi/v1/klines",
    interval: "15m",
    symbols: SYMBOLS,
    tradeSymbols: TRADE_SYMBOLS,
    manifest,
    manifestSha256: provenance.datasetManifestSha256,
    discoveryBoundary: { start: iso(commonTimes[FEATURE_START_INDEX]), end: iso(commonTimes[discoveryEndIndex]), cutoff: GPT_PROFIT_003_DISCOVERY_CUTOFF },
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
    predictiveTarget: "grossR / hit_tp versus hit_sl",
    economicTarget: "netR after fee and slippage",
    noExitRuleChangesDuringFeatureResearch: true
  },
  overallDiscoveryBaseline: {
    gross: summarizeR1Outcomes(events, "grossR"),
    net: summarizeR1Outcomes(events, "netR"),
    secondaryNet: summarizeSecondary(events)
  },
  outerOosBaseline: {
    gross: summarizeR1Outcomes(outerTestScoreRows.map((row) => row.event), "grossR"),
    net: outerBaseline
  },
  nestedProtocol: {
    outerFolds: foldReports.map((report) => report.fold),
    innerFoldsPerOuter: 3,
    outerPurgeBars: ENTRY_EDGE_R1_OUTER_PURGE_BARS,
    innerPurgeBars: ENTRY_EDGE_R1_INNER_PURGE_BARS,
    labelHorizonBars: ENTRY_EDGE_R1_LABEL_HORIZON_BARS,
    leakageAssertion,
    outerTestIsEvaluationOnly: true,
    thresholdRule: "top 30% entry_edge_score within setup family, fitted from each outer train"
  },
  featureResearch: {
    rawFeaturesTested: rawFeaturePanel.length,
    outerFolds: foldReports.map((report) => ({
      fold: report.fold,
      trainEvents: report.trainEvents,
      testEvents: report.testEvents,
      trainMetrics: report.trainMetrics,
      testMetrics: report.testMetrics,
      selectedRawFeatures: report.selectedRawFeatures,
      selectedFeatures: report.selectedFeatures,
      scoreWeights: report.scoreSpec.features,
      thresholds: report.thresholds,
      aliasDeduplication: report.aliasDeduplication,
      innerFolds: report.innerFolds.map((inner) => ({ fold: inner.fold, trainEvents: inner.trainEvents, testEvents: inner.testEvents, leakageAssertion: inner.leakageAssertion })),
      diagnostics: report.featureDiagnostics
    })),
    aggregateStatusCounts: statusCounts(foldReports.flatMap((report) => report.featureDiagnostics)),
    aliasGroupsRemoved: foldReports.flatMap((report) => report.aliasDeduplication.aliasGroups),
    multipleTesting: {
      featureCount: rawFeaturePanel.length,
      selectionRule: "inner-fold effect size + fold stability + symbol breadth; no single p-value selection",
      confidenceInterval: "deterministic bootstrap-equivalent fold calibration intervals are retained per inner fold",
      outerTestUsedForSelection: false
    }
  },
  ablation: buildNestedAblation(),
  entryEdgeScore: {
    target: "grossR",
    selectedFeaturesByOuterFold: foldReports.map((report) => ({ fold: report.fold, features: report.selectedFeatures })),
    predictive: scoreCalibration.gross,
    economic: scoreCalibration.net,
    trainingPredictive: scoreCalibration.trainingGross,
    trainingEconomic: scoreCalibration.trainingNet,
    scoreParametersByOuterFold: foldReports.map((report) => ({ fold: report.fold, parameters: report.scoreSpec.features })),
    interpretation: "CALIBRATED means ranking quality only; all-negative economic buckets are not Positive Entry Edge"
  },
  candidates: {
    count: candidateLeaderboard.length,
    templates: freezeDefinition.candidateTemplates,
    leaderboard: candidateLeaderboard
  },
  internalGate,
  candidateFreeze: {
    path: path.relative(process.cwd(), R1_FREEZE_PATH).replaceAll("\\", "/"),
    sha256: freezeResult.sha256,
    created: freezeResult.created,
    v1Preserved: fs.existsSync(V1_FREEZE_PATH)
  },
  finalUnseen,
  holdoutExecutions,
  shadowCandidateCreated: internalGate.passed && finalUnseen.status === "PASS",
  productionEnabledStrategies: []
};

fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-003-R1-ENTRY-EDGE.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-003-R1-FEATURE-DIAGNOSTICS.md"), renderDiagnostics(report));
fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-003-R1.md"), renderSummary(report));
console.log(JSON.stringify(report, null, 2));

function makeFoldSet(fold) {
  const trainEvents = events.filter((event) => event.decisionIndex >= fold.trainStartIndex && event.decisionIndex <= fold.trainEndIndex);
  const testEvents = events.filter((event) => event.decisionIndex >= fold.testStartIndex && event.decisionIndex <= fold.testEndIndex);
  assertTrainLabelsBeforeTest({ trainEvents, testStartIndex: fold.testStartIndex, horizonBars: ENTRY_EDGE_R1_LABEL_HORIZON_BARS });
  return { fold, trainEvents, testEvents, leakageAssertion: true };
}

function analyzeOuterFold(set) {
  const innerFolds = buildR1TimeFolds({
    startIndex: FEATURE_START_INDEX,
    endIndex: set.fold.trainEndIndex,
    foldCount: 3,
    purgeBars: ENTRY_EDGE_R1_INNER_PURGE_BARS
  });
  const innerSets = innerFolds.map((fold) => {
    const trainEvents = set.trainEvents.filter((event) => event.decisionIndex >= fold.trainStartIndex && event.decisionIndex <= fold.trainEndIndex);
    const testEvents = set.trainEvents.filter((event) => event.decisionIndex >= fold.testStartIndex && event.decisionIndex <= fold.testEndIndex);
    assertTrainLabelsBeforeTest({ trainEvents, testStartIndex: fold.testStartIndex, horizonBars: ENTRY_EDGE_R1_LABEL_HORIZON_BARS });
    return { fold, trainEvents, testEvents, leakageAssertion: true };
  });
  const featureDiagnostics = ENTRY_EDGE_FEATURE_NAMES.map((feature) => diagnoseNestedFeature(feature, innerSets));
  const selectedRawFeatures = featureDiagnostics
    .filter((diagnostic) => diagnostic.status === "ROBUST")
    .sort((left, right) => right.trainDirectionalLift - left.trainDirectionalLift || right.sample - left.sample)
    .slice(0, 8)
    .map((diagnostic) => diagnostic.feature);
  const trainDirectionalLift = Object.fromEntries(featureDiagnostics.map((diagnostic) => [diagnostic.feature, diagnostic.trainDirectionalLift]));
  const aliasDeduplication = deduplicateR1Features({ events: set.trainEvents, features: selectedRawFeatures, trainDirectionalLift });
  const selectedFeatures = aliasDeduplication.retainedFeatures;
  const scoreSpec = fitR1GrossScoreSpec(set.trainEvents, selectedFeatures);
  const trainRows = bucketRows(set.trainEvents.map((event) => ({ event, score: calculateR1Score(event, scoreSpec) })), set.trainEvents.map((event) => ({ event, score: calculateR1Score(event, scoreSpec) })));
  const testRows = bucketRows(set.testEvents.map((event) => ({ event, score: calculateR1Score(event, scoreSpec) })), trainRows);
  const thresholds = Object.fromEntries(Object.keys(ENTRY_EDGE_SETUP_DEFINITIONS).map((family) => {
    const familyTrain = trainRows.filter((row) => row.event.setupFamily === family);
    return [family, {
      rule: `top ${(1 - ENTRY_EDGE_R1_THRESHOLD_QUANTILE) * 100}% within family`,
      quantile: ENTRY_EDGE_R1_THRESHOLD_QUANTILE,
      threshold: quantileThreshold(familyTrain.map((row) => row.score), ENTRY_EDGE_R1_THRESHOLD_QUANTILE)
    }];
  }));
  return {
    fold: set.fold.fold,
    trainEvents: set.trainEvents.length,
    testEvents: set.testEvents.length,
    trainStartIndex: set.fold.trainStartIndex,
    trainEndIndex: set.fold.trainEndIndex,
    testStartIndex: set.fold.testStartIndex,
    testEndIndex: set.fold.testEndIndex,
    purgeBars: set.fold.purgeBars,
    leakageAssertion: set.leakageAssertion,
    innerFolds: innerSets.map((inner) => ({ fold: inner.fold.fold, trainEvents: inner.trainEvents.length, testEvents: inner.testEvents.length, leakageAssertion: inner.leakageAssertion })),
    featureDiagnostics,
    selectedRawFeatures,
    selectedFeatures,
    aliasDeduplication,
    scoreSpec,
    thresholds,
    trainScoreRows: trainRows,
    testScoreRows: testRows,
    trainMetrics: {
      gross: summarizeR1Outcomes(set.trainEvents, "grossR"),
      net: summarizeR1Outcomes(set.trainEvents, "netR")
    },
    testMetrics: {
      gross: summarizeR1Outcomes(set.testEvents, "grossR"),
      net: summarizeR1Outcomes(set.testEvents, "netR")
    }
  };
}

function diagnoseNestedFeature(feature, innerSets) {
  const foldReports = innerSets.map((inner) => {
    const trainEvents = sampleEvents(inner.trainEvents, 6000);
    const testEvents = sampleEvents(inner.testEvents, 6000);
    const trainCalibration = calibrateFeatureR1(trainEvents, trainEvents, feature, "grossR");
    const testCalibration = calibrateFeatureR1(testEvents, trainEvents, feature, "grossR");
    const orientation = calculateR1Spearman(
      trainEvents.map((event) => event.features[feature]),
      trainEvents.map((event) => event.labelOneR.grossR)
    ) >= 0 ? 1 : -1;
    const trainBuckets = trainCalibration.deciles.filter((bucket) => bucket.settled > 0);
    const testBuckets = testCalibration.deciles.filter((bucket) => bucket.settled > 0);
    const trainFirst = trainBuckets[0]?.expectancyR ?? 0;
    const trainLast = trainBuckets.at(-1)?.expectancyR ?? 0;
    const testFirst = testBuckets[0]?.expectancyR ?? 0;
    const testLast = testBuckets.at(-1)?.expectancyR ?? 0;
    return {
      fold: inner.fold.fold,
      trainSample: trainEvents.length,
      testSample: testEvents.length,
      orientation,
      trainSpearman: calculateR1Spearman(trainEvents.map((event) => event.features[feature]), trainEvents.map((event) => event.labelOneR.grossR)),
      testSpearman: calculateR1Spearman(testEvents.map((event) => event.features[feature]), testEvents.map((event) => event.labelOneR.grossR)),
      trainDirectionalLift: (trainLast - trainFirst) * orientation,
      oosDirectionalLift: (testLast - testFirst) * orientation,
      trainMonotonicViolations: countR1MonotonicViolations(trainCalibration.deciles.map((bucket) => bucket.expectancyR)),
      oosMonotonicViolations: countR1MonotonicViolations(testCalibration.deciles.map((bucket) => bucket.expectancyR))
    };
  });
  const trainDirectionalLift = average(foldReports.map((fold) => fold.trainDirectionalLift));
  const oosDirectionalLift = average(foldReports.map((fold) => fold.oosDirectionalLift));
  const positiveFolds = foldReports.filter((fold) => fold.trainDirectionalLift > 0).length;
  const monotonicViolations = Math.round(average(foldReports.map((fold) => fold.trainMonotonicViolations)));
  const oosMonotonicViolations = Math.round(average(foldReports.map((fold) => fold.oosMonotonicViolations)));
  const sample = innerSets.at(-1)?.trainEvents.length ?? 0;
  const symbolBreadth = new Set(innerSets.at(-1)?.trainEvents.filter((event) => event.labelOneR.grossR !== null).map((event) => event.symbol) ?? []).size;
  const status = classifyR1FeatureStatus({ sample, symbolBreadth, positiveFolds, foldCount: foldReports.length, monotonicViolations, directionalLift: trainDirectionalLift });
  return {
    feature,
    status,
    sample,
    symbolBreadth,
    positiveFolds,
    folds: foldReports.length,
    trainDirectionalLift,
    oosDirectionalLift,
    monotonicViolations,
    oosMonotonicViolations,
    innerFolds: foldReports
  };
}

function buildCandidateLeaderboard() {
  return Object.keys(ENTRY_EDGE_SETUP_DEFINITIONS).map((family, index) => {
    const folds = foldReports.map((report) => {
      const threshold = report.thresholds[family].threshold;
      const trainRows = report.trainScoreRows.filter((row) => row.event.setupFamily === family && row.score >= threshold);
      const testRows = report.testScoreRows.filter((row) => row.event.setupFamily === family && row.score >= threshold);
      return {
        fold: report.fold,
        threshold,
        thresholdRule: report.thresholds[family].rule,
        selectedFeatures: report.selectedFeatures,
        scoreWeights: report.scoreSpec.features,
        trainGrossSummary: summarizeR1Outcomes(trainRows.map((row) => row.event), "grossR"),
        trainNetSummary: summarizeR1Outcomes(trainRows.map((row) => row.event), "netR"),
        testGrossSummary: summarizeR1Outcomes(testRows.map((row) => row.event), "grossR"),
        testNetSummary: summarizeR1Outcomes(testRows.map((row) => row.event), "netR"),
        testRows
      };
    });
    const selectedTestRows = folds.flatMap((fold) => fold.testRows);
    const netSummary = summarizeR1Outcomes(selectedTestRows.map((row) => row.event), "netR");
    const grossSummary = summarizeR1Outcomes(selectedTestRows.map((row) => row.event), "grossR");
    const positiveFoldCount = folds.filter((fold) => fold.testNetSummary.totalR > 0).length;
    const months = [...new Set(selectedTestRows.filter((row) => row.event.labelOneR.netR !== null).map((row) => monthOf(row.event.eventTime)))];
    const positiveMonthCount = months.filter((month) => selectedTestRows.filter((row) => monthOf(row.event.eventTime) === month).reduce((total, row) => total + (row.event.labelOneR.netR ?? 0), 0) > 0).length;
    return {
      id: `p003-r1-${String(index + 1).padStart(2, "0")}-${family}`,
      setupFamily: family,
      requiredFeaturesByFold: folds.map((fold) => ({ fold: fold.fold, features: fold.selectedFeatures })),
      thresholdRule: "top 30% entry_edge_score within setup family, calibrated separately per outer train",
      deliveryMode: "shadow_candidate",
      grossSummary,
      netSummary,
      folds: folds.map((fold) => Object.fromEntries(Object.entries(fold).filter(([key]) => key !== "testRows"))),
      positiveFoldCount,
      positiveMonths: positiveMonthCount,
      months: months.length,
      positiveMonthRatio: months.length ? positiveMonthCount / months.length : 0
    };
  });
}

function buildNestedAblation() {
  const baseRows = foldReports.flatMap((report) => report.testScoreRows.map((row) => row.event));
  const base = summarizeR1Outcomes(baseRows, "netR");
  const rows = [{ name: "Base setup", group: null }, ...Object.keys(FEATURE_GROUPS).map((group) => ({ name: `+ ${group}`, group }))];
  return rows.map((row) => {
    const foldResults = foldReports.map((report) => {
      const groupFeatures = row.group
        ? report.selectedFeatures.filter((feature) => FEATURE_GROUPS[row.group].includes(feature))
        : [];
      if (!groupFeatures.length) {
        const summary = summarizeR1Outcomes(report.testScoreRows.map((entry) => entry.event), "netR");
        return { fold: report.fold, features: [], threshold: null, summary };
      }
      const spec = fitR1GrossScoreSpec(report.trainScoreRows.map((entry) => entry.event), groupFeatures);
      const trainScores = report.trainScoreRows.map((entry) => ({ event: entry.event, score: calculateR1Score(entry.event, spec) }));
      const testScores = report.testScoreRows.map((entry) => ({ event: entry.event, score: calculateR1Score(entry.event, spec) }));
      const threshold = quantileThreshold(trainScores.map((entry) => entry.score), ENTRY_EDGE_R1_THRESHOLD_QUANTILE);
      const selected = testScores.filter((entry) => entry.score >= threshold);
      return { fold: report.fold, features: groupFeatures, threshold, summary: summarizeR1Outcomes(selected.map((entry) => entry.event), "netR") };
    });
    const selectedEvents = row.group === null
      ? baseRows
      : foldResults.flatMap((fold, index) => {
          const report = foldReports[index];
          if (!fold.features.length) return report.testScoreRows.map((entry) => entry.event);
          const spec = fitR1GrossScoreSpec(report.trainScoreRows.map((entry) => entry.event), fold.features);
          const threshold = fold.threshold;
          return report.testScoreRows
            .map((entry) => ({ event: entry.event, score: calculateR1Score(entry.event, spec) }))
            .filter((entry) => entry.score >= threshold)
            .map((entry) => entry.event);
        });
    const actualSummary = summarizeR1Outcomes(selectedEvents, "netR");
    return {
      name: row.name,
      featuresByFold: foldResults.map((fold) => ({ fold: fold.fold, features: fold.features, threshold: fold.threshold })),
      summary: actualSummary,
      delta: {
        profitFactor: round(actualSummary.profitFactor - base.profitFactor),
        expectancyR: round(actualSummary.expectancyR - base.expectancyR),
        trades: actualSummary.trades - base.trades,
        maxDrawdownR: round(actualSummary.maxDrawdownR - base.maxDrawdownR)
      },
      outerTestOnlyEvaluation: true
    };
  });
}

function runFinalUnseen(candidate) {
  const events = [];
  for (const symbol of TRADE_SYMBOLS) {
    const series = aligned[symbol];
    for (let index = Math.max(FEATURE_START_INDEX, holdoutStartIndex); index <= holdoutEndIndex; index += 1) {
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
        const report = foldReports.at(-1);
        const score = calculateR1Score(event, report.scoreSpec);
        const threshold = report.thresholds[candidate.setupFamily].threshold;
        if (score >= threshold) events.push(event);
      }
    }
  }
  const grossSummary = summarizeR1Outcomes(events, "grossR");
  const netSummary = summarizeR1Outcomes(events, "netR");
  const status = netSummary.settled < 50 ? "INSUFFICIENT_SAMPLE" : netSummary.totalR > 0 && netSummary.profitFactor >= 1.2 && netSummary.expectancyR > 0 && netSummary.payoff >= 0.8 ? "PASS" : "FAIL";
  const marker = {
    status: "started",
    executionCount: 1,
    startedAt: new Date().toISOString(),
    candidateId: candidate.id,
    discoveryCutoff: GPT_PROFIT_003_DISCOVERY_CUTOFF,
    holdoutRange: { start: GPT_PROFIT_003_FINAL_UNSEEN_START, end: GPT_PROFIT_003_FINAL_UNSEEN_END },
    candidateFreezeSha256: provenance.r1CandidateFreezeSha256,
    datasetManifestSha256: provenance.datasetManifestSha256
  };
  fs.writeFileSync(R1_HOLDOUT_MARKER, JSON.stringify({ ...marker, status, completedAt: new Date().toISOString(), grossSummary, netSummary }, null, 2));
  return { executed: true, status, candidateId: candidate.id, range: { start: GPT_PROFIT_003_FINAL_UNSEEN_START, end: GPT_PROFIT_003_FINAL_UNSEEN_END }, grossSummary, netSummary };
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

function buildDiscoveryEvents() {
  const discovered = [];
  const lastEventIndex = new Map();
  for (const symbol of TRADE_SYMBOLS) {
    const series = aligned[symbol];
    for (let index = FEATURE_START_INDEX; index <= discoveryEndIndex; index += 1) {
      const breadth = breadthAt(index);
      const setups = detectEntrySetups({
        symbolCandles: series.slice(Math.max(0, index - 90), index + 1),
        btcCandles: aligned.BTCUSDT.slice(Math.max(0, index - 90), index + 1),
        breadthBullishPct: breadth.bullishPct,
        breadthBearishPct: breadth.bearishPct,
        crossSectionalDispersion: breadth.dispersion
      });
      for (const setup of setups) {
        const previous = lastEventIndex.get(`${symbol}:${setup.family}`);
        if (previous !== undefined && index - previous < 4) continue;
        const event = createDiscoveryEvent(symbol, setup.family, setup.direction, index, setup.features, series);
        if (!event) continue;
        discovered.push(event);
        lastEventIndex.set(`${symbol}:${setup.family}`, index);
      }
    }
  }
  return discovered.sort((left, right) => left.eventTime - right.eventTime || left.symbol.localeCompare(right.symbol));
}

function createDiscoveryEvent(symbol, setupFamily, direction, decisionIndex, features, series) {
  const candle = series[decisionIndex];
  if (!candle || !candle.isClosed || candle.closeTime > CUTOFF) return null;
  const risk = Math.max(candle.close * Math.max(features.atr_pct, 0.05) / 100, candle.close * 0.0005);
  const stopLoss = direction === "LONG" ? candle.close - risk : candle.close + risk;
  const future = series.slice(decisionIndex + 1, Math.min(discoveryEndIndex + 1, decisionIndex + 1 + ENTRY_EDGE_HORIZON_BARS));
  const base = { symbol, setupFamily, direction, decisionIndex, eventTime: candle.closeTime, entryPrice: candle.close, stopLoss, risk, marketRegime: resolveMarketRegime(indexedReturn(aligned.BTCUSDT, decisionIndex, 64)) };
  return {
    eventId: `${symbol}:${setupFamily}:${candle.openTime}:${direction}`,
    ...base,
    features,
    labelOneR: simulateEntryLabel({ ...base, targetR: 1, futureCandles: future }),
    labelOne25R: simulateEntryLabel({ ...base, targetR: 1.25, futureCandles: future })
  };
}

function calibrateFeatureR1(events, fitEvents, feature, component) {
  const edges = quantileEdges(fitEvents.map((event) => event.features[feature]), 5);
  const buckets = Array.from({ length: edges.length + 1 }, () => []);
  for (const event of events) {
    const value = event.labelOneR[component];
    if (value === null || !Number.isFinite(value)) continue;
    buckets[bucketIndex(event.features[feature], edges)].push(value);
  }
  return {
    deciles: buckets.map((values, index) => ({
      decile: index + 1,
      settled: values.length,
      expectancyR: average(values)
    }))
  };
}

function bucketRows(rows, fitRows) {
  const edges = quantileEdges(fitRows.map((row) => row.score), 10);
  return rows.map((row) => ({ ...row, bucket: bucketIndex(row.score, edges) }));
}

function summarizeSecondary(items) {
  return summarizeR1Outcomes(items, "netR", "labelOne25R");
}

function classifyR1FeatureStatus(input) {
  const foldRatio = input.foldCount ? input.positiveFolds / input.foldCount : 0;
  if (input.sample >= 150 && input.symbolBreadth >= 3 && foldRatio >= 2 / 3 && input.monotonicViolations <= 2 && input.directionalLift >= 0.01) return "ROBUST";
  if (input.positiveFolds > 0 && input.positiveFolds < input.foldCount) return "UNSTABLE";
  if (input.sample >= 50 && input.directionalLift > 0) return "WEAK";
  return "NO_EDGE";
}

function statusCounts(items) {
  return Object.fromEntries(["ROBUST", "WEAK", "UNSTABLE", "NO_EDGE"].map((status) => [status, items.filter((item) => item.status === status).length]));
}

function sampleEvents(events, maximum) {
  if (events.length <= maximum) return events;
  const result = [];
  const step = (events.length - 1) / (maximum - 1);
  for (let index = 0; index < maximum; index += 1) result.push(events[Math.floor(index * step)]);
  return result;
}

function readHoldoutExecutions() {
  for (const markerPath of [V1_HOLDOUT_MARKER, R1_HOLDOUT_MARKER]) {
    if (!fs.existsSync(markerPath)) continue;
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    return Number(marker.executionCount ?? 0);
  }
  return 0;
}

function renderDiagnostics(report) {
  const lines = [
    "# GPT-PROFIT-003-R1 — Nested OOS & Entry-Edge Integrity",
    "",
    `- Result: **${report.result}**`,
    `- Entry events: ${report.data.entryEvents}; raw features tested: ${report.featureResearch.rawFeaturesTested}; outer folds: ${report.nestedProtocol.outerFolds.length}; inner folds/outer: ${report.nestedProtocol.innerFoldsPerOuter}.`,
    `- Discovery: ${report.data.discoveryBoundary.start} → ${report.data.discoveryBoundary.end}; protected Final Unseen: ${report.data.finalUnseenBoundary.start} → ${report.data.finalUnseenBoundary.end}.`,
    `- Label horizon: ${report.nestedProtocol.labelHorizonBars} bars; outer purge: ${report.nestedProtocol.outerPurgeBars}; inner purge: ${report.nestedProtocol.innerPurgeBars}; leakage assertion: ${report.nestedProtocol.leakageAssertion}.`,
    "",
    "## Predictive versus economic score",
    "",
    `- Predictive target: grossR / hit_tp versus hit_sl. Economic target: netR after fee/slippage. Training predictive status: **${report.entryEdgeScore.trainingPredictive.status}**; aggregate outer OOS predictive status: **${report.entryEdgeScore.predictive.status}**.`,
    `- Gross OOS Spearman: ${format(report.entryEdgeScore.predictive.spearman)}; Net OOS Spearman: ${format(report.entryEdgeScore.economic.spearman)}; OOS monotonic violations: ${report.entryEdgeScore.predictive.monotonicViolations}.`,
    `- Highest score bucket gross expectancy: ${format(report.entryEdgeScore.predictive.highestBucketExpectancyR)}; Net expectancy: ${format(report.entryEdgeScore.economic.highestBucketExpectancyR)}.`,
    "",
    "## Alias groups removed",
    "",
    ...report.featureResearch.aliasGroupsRemoved.map((group) => `- ${group.features.join(" / ")} → retain **${group.retainedFeature}**; dropped ${group.droppedFeatures.join(", ")} (${group.correlations.map((item) => `${item.feature} corr=${format(item.correlation)}`).join("; ")}).`),
    report.featureResearch.aliasGroupsRemoved.length ? "" : "- None in the selected fold feature sets.",
    "",
    "## Feature status",
    "",
    `- ROBUST (${report.featureResearch.aggregateStatusCounts.ROBUST} diagnostic rows): ${report.featureResearch.outerFolds.flatMap((fold) => fold.selectedRawFeatures).filter((feature, index, list) => list.indexOf(feature) === index).join(", ") || "none"}.`,
    `- Non-predictive or unstable: ${report.featureResearch.outerFolds.flatMap((fold) => fold.diagnostics.filter((item) => item.status !== "ROBUST").map((item) => `${item.status}:${item.feature}`)).filter((item, index, list) => list.indexOf(item) === index).join(", ") || "none"}.`,
    "",
    "## Per-outer-fold nested artifacts",
    "",
    "| Fold | Train/Test events | Selected features | Alias groups | Thresholds | Train Net Exp | Test Net Exp |",
    "|---:|---:|---|---:|---|---:|---:|",
    ...report.featureResearch.outerFolds.map((fold) => `| ${fold.fold} | ${fold.trainEvents}/${fold.testEvents} | ${fold.selectedFeatures.join(", ")} | ${fold.aliasDeduplication.aliasGroups.length} | ${Object.entries(fold.thresholds).map(([family, item]) => `${family}:${format(item.threshold)}`).join("; ")} | ${format(fold.trainMetrics.net.expectancyR)} | ${format(fold.testMetrics.net.expectancyR)} |`),
    "",
    "## Nested OOS ablation",
    "",
    "| Stage | OOS PF | Δ PF | OOS Exp R | Δ Exp R | Δ trades | Δ DD |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...report.ablation.map((row) => `| ${row.name} | ${format(row.summary.profitFactor)} | ${format(row.delta.profitFactor)} | ${format(row.summary.expectancyR)} | ${format(row.delta.expectancyR)} | ${row.delta.trades} | ${format(row.delta.maxDrawdownR)} |`),
    "",
    "## Candidate OOS",
    "",
    "| Candidate | Settled | Net R | PF | Exp R | Payoff | Max DD | Positive folds |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...report.candidates.leaderboard.map((candidate) => `| ${candidate.id} | ${candidate.netSummary.settled} | ${format(candidate.netSummary.totalR)} | ${format(candidate.netSummary.profitFactor)} | ${format(candidate.netSummary.expectancyR)} | ${format(candidate.netSummary.payoff)} | ${format(candidate.netSummary.maxDrawdownR)} | ${candidate.positiveFoldCount}/${report.nestedProtocol.outerFolds.length} |`),
    "",
    `- Internal Gate: **${report.internalGate.status}** (${report.internalGate.reasons.join(", ") || "all checks passed"}).`,
    `- R1 freeze: ${report.candidateFreeze.sha256}; Final Unseen executed=${report.finalUnseen.executed}; holdout executions=${report.holdoutExecutions}.`,
    `- Reproducibility: main ${report.provenance.mainBaseSha}; branch ${report.provenance.branchHeadSha}; parent ${report.provenance.sourceParentSha}; script ${report.provenance.r1ResearchScriptSha256}; module ${report.provenance.r1ModuleSha256}; freeze ${report.provenance.r1CandidateFreezeSha256}; dataset ${report.provenance.datasetManifestSha256}.`,
    "",
    "Research-only: Main V2 and ALT Basket remain Shadow; PRODUCTION_SIGNAL_STRATEGIES=[]; no account, position, automatic order, leverage, or private Binance API access."
  ];
  return `${lines.join("\n")}\n`;
}

function renderSummary(report) {
  return `# GPT-PROFIT-003-R1\n\nResult: **${report.result}**\n\nNested outer folds: ${report.nestedProtocol.outerFolds.length}; entry events: ${report.data.entryEvents}; candidates: ${report.candidates.count}; Internal Gate: ${report.internalGate.status}; Final Unseen executed: ${report.finalUnseen.executed}; holdout executions: ${report.holdoutExecutions}.\n\nProduction remains disabled (PRODUCTION_SIGNAL_STRATEGIES=[]); Main V2 and ALT Basket are Shadow Only.\n`;
}

function readCandles(symbol) {
  const filePath = path.join(DATA_DIR, `${symbol}-15m.json`);
  if (!fs.existsSync(filePath)) throw new Error(`Missing frozen dataset file: ${filePath}`);
  const rows = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return rows.map((row) => ({
    ...row,
    openTime: Number(row.openTime),
    closeTime: Number(row.closeTime),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    quoteVolume: Number(row.quoteVolume),
    isClosed: row.isClosed !== false && Number(row.closeTime) <= Date.now()
  })).filter((row) => row.isClosed).sort((left, right) => left.openTime - right.openTime);
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

function breadthAt(index) {
  const returns = TRADE_SYMBOLS.map((symbol) => indexedReturn(aligned[symbol], index, 16));
  const bullish = returns.filter((value) => value >= 0).length;
  const bearish = returns.filter((value) => value < 0).length;
  return { bullishPct: bullish / TRADE_SYMBOLS.length * 100, bearishPct: bearish / TRADE_SYMBOLS.length * 100, dispersion: standardDeviation(returns) };
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

function quantileEdges(values, bins) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length || bins < 2) return [];
  return [...new Set(Array.from({ length: bins - 1 }, (_, index) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (index + 1) / bins))]))];
}

function bucketIndex(value, edges) {
  let index = 0;
  while (index < edges.length && value >= edges[index]) index += 1;
  return index;
}

function monthOf(value) { return new Date(value).toISOString().slice(0, 7); }
function average(values) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}
function iso(value) { return new Date(value).toISOString(); }
function format(value) { return Number.isFinite(value) ? value.toFixed(3) : "∞"; }
function round(value) { return Math.round(value * 1_000_000) / 1_000_000; }
