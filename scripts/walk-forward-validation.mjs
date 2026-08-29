import fs from "node:fs";
import path from "node:path";
import {
  ALT_BASKET_SHORT_CONFIG_V1,
  ALT_BASKET_SHORT_CONFIG_V2,
  evaluateAltBasketShortStrategy
} from "../src/lib/signal/alt-basket-strategy.ts";
import { applyReviewCandles, DEFAULT_REVIEW_EXECUTION_POLICY } from "../src/lib/signal/review.ts";
import { evaluateSignalCandidate, resolveBtcRegime } from "../src/lib/signal/engine.ts";
import { calculateRelativeStrength } from "../src/lib/signal/indicators.ts";
import { MAIN_ASYMMETRIC_CANDIDATES, MAIN_STRATEGY_V2, MAIN_VALIDATION_CANDIDATES } from "../src/lib/signal/strategy-config.ts";
import { evaluateValidationGate, mergeValidationTrades, summarizeValidationTrades } from "../src/lib/signal/validation.ts";
import { COST_GATE_CANDIDATES } from "../src/lib/signal/profitability-config.ts";
import { passesCostGate } from "../src/lib/signal/cost-edge.ts";
import { evaluatePromotionGate } from "../src/lib/signal/promotion-gate.ts";

const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"];
const lookbackDirs = (process.env.HISTORICAL_SOURCE_DIRS || process.env.LOOKBACK_DIR || "452d")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const sourceDirs = lookbackDirs.map((item) => path.join(process.cwd(), ".cache", "historical-backtest", item));
const fifteenMinutes = 15 * 60 * 1000;
const fourHours = 4 * 60 * 60 * 1000;
const trainDays = Number(process.env.WALK_FORWARD_TRAIN_DAYS || 180);
const testDays = Number(process.env.WALK_FORWARD_TEST_DAYS || 60);
const stepDays = Number(process.env.WALK_FORWARD_STEP_DAYS || 60);
const foldCount = Number(process.env.WALK_FORWARD_FOLDS || 3);
const finalHoldoutDays = Number(process.env.WALK_FORWARD_HOLDOUT_DAYS || 60);
const oneWayFee = Number(process.env.ONE_WAY_FEE || 0.001);
const oneWaySlippage = Number(process.env.ONE_WAY_SLIPPAGE || 0.0005);
const codeVersion = resolveCodeVersion();
const signalCooldownBars = Number(process.env.WALK_FORWARD_SIGNAL_COOLDOWN_BARS || 0);
const altSymbols = ["ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"];
const tradeSymbols = process.env.WALK_FORWARD_ONLY_SYMBOL
  ? symbols.filter((symbol) => symbol === process.env.WALK_FORWARD_ONLY_SYMBOL)
  : process.env.WALK_FORWARD_INCLUDE_BTC === "1"
    ? symbols
    : symbols.filter((symbol) => symbol !== "BTCUSDT");
const ALT_VALIDATION_CANDIDATES = [
  { version: "alt-basket-short-v1", direction: "SHORT", config: ALT_BASKET_SHORT_CONFIG_V1 },
  { version: "alt-basket-short-v2", direction: "SHORT", config: ALT_BASKET_SHORT_CONFIG_V2 }
];
const structureVariant = parseStructureVariant(process.env.WALK_FORWARD_STRUCTURE_VARIANT);
const strengthThresholdVariant = parseStrengthThreshold(process.env.WALK_FORWARD_STRENGTH_THRESHOLD);
const longStrengthThresholdVariant = parseStrengthThreshold(process.env.WALK_FORWARD_LONG_STRENGTH_THRESHOLD);
const shortStrengthThresholdVariant = parseStrengthThreshold(process.env.WALK_FORWARD_SHORT_STRENGTH_THRESHOLD);
const relativeStrengthModeVariant = parseRelativeStrengthMode(process.env.WALK_FORWARD_RELATIVE_STRENGTH_MODE);
const setupModeVariant = parseSetupMode(process.env.WALK_FORWARD_SETUP_MODE);
const allMainCandidates = process.env.WALK_FORWARD_ASYMMETRIC_ONLY === "1"
  ? MAIN_ASYMMETRIC_CANDIDATES
  : [MAIN_STRATEGY_V2, ...MAIN_VALIDATION_CANDIDATES];
const mainCandidatePool = process.env.WALK_FORWARD_FIXED_MAIN_VERSION
  ? allMainCandidates.filter((candidate) => candidate.version === process.env.WALK_FORWARD_FIXED_MAIN_VERSION)
  : process.env.WALK_FORWARD_CORE_ONLY === "1"
    ? allMainCandidates.filter((candidate) => candidate.targetR === 1.5 && candidate.regimeMode === "aligned" && candidate.trendMode === "aligned")
    : allMainCandidates;
const mainCandidates = process.env.WALK_FORWARD_SKIP_MAIN === "1"
  ? []
  : structureVariant
    ? mainCandidatePool.map((candidate) => ({
        ...candidate,
        version: `${candidate.version}-sl${structureVariant.lookback}-buf${String(structureVariant.buffer).replace(".", "_")}`,
        structureLookback: structureVariant.lookback,
        stopBufferAtr: structureVariant.buffer
      }))
    : mainCandidatePool;
if (strengthThresholdVariant !== null) {
  for (const candidate of mainCandidates) {
    candidate.version = `${candidate.version}-rs${String(strengthThresholdVariant).replace(".", "_")}`;
    candidate.relativeStrengthThreshold = strengthThresholdVariant;
  }
}
if (longStrengthThresholdVariant !== null) {
  for (const candidate of mainCandidates) {
    candidate.version = `${candidate.version}-lr${String(longStrengthThresholdVariant).replace(".", "_")}`;
    candidate.longRelativeStrengthThreshold = longStrengthThresholdVariant;
  }
}
if (shortStrengthThresholdVariant !== null) {
  for (const candidate of mainCandidates) {
    candidate.version = `${candidate.version}-sr${String(shortStrengthThresholdVariant).replace(".", "_")}`;
    candidate.shortRelativeStrengthThreshold = shortStrengthThresholdVariant;
  }
}
if (relativeStrengthModeVariant !== null) {
  for (const candidate of mainCandidates) {
    candidate.version = `${candidate.version}-rsm-${relativeStrengthModeVariant}`;
    candidate.relativeStrengthMode = relativeStrengthModeVariant;
  }
}
if (setupModeVariant !== null) {
  for (const candidate of mainCandidates) {
    candidate.version = `${candidate.version}-${setupModeVariant}`;
    candidate.setupMode = setupModeVariant;
  }
}
const altCandidates = process.env.WALK_FORWARD_SKIP_ALT === "1"
  ? []
  : process.env.WALK_FORWARD_ALT_DIRECTION
  ? ALT_VALIDATION_CANDIDATES.filter((candidate) => candidate.direction === process.env.WALK_FORWARD_ALT_DIRECTION)
  : ALT_VALIDATION_CANDIDATES;
const outcomeCache = new Map();

const candlesBySymbol = Object.fromEntries(symbols.map((symbol) => [symbol, readCandles(symbol)]));
const commonTimes = intersectTimes(symbols.map((symbol) => candlesBySymbol[symbol].map((candle) => candle.openTime)));
if (commonTimes.length < 2) throw new Error("No common historical candle range was found.");

const aligned = Object.fromEntries(symbols.map((symbol) => [symbol, alignBars(candlesBySymbol[symbol], commonTimes)]));
const btc4h = aggregateFourHour(aligned.BTCUSDT);
const btc4hIndexByTime = buildBtc4hIndexByTime(commonTimes, btc4h);
const startIndex = 40;
const endIndex = commonTimes.length - 1;
const coverageDays = (commonTimes[endIndex] - commonTimes[startIndex]) / (24 * 60 * 60 * 1000);
const finalHoldoutStartIndex = indexAtOrAfter(commonTimes[endIndex] - finalHoldoutDays * 24 * 60 * 60 * 1000);

const folds = [];
for (let fold = 0; fold < foldCount; fold += 1) {
  const testEndTime = commonTimes[finalHoldoutStartIndex] - (foldCount - fold - 1) * stepDays * 24 * 60 * 60 * 1000;
  const testEndIndex = indexAtOrBefore(testEndTime);
  const testStartIndex = indexAtOrAfter(commonTimes[testEndIndex] - testDays * 24 * 60 * 60 * 1000 + fifteenMinutes);
  const trainStartIndex = indexAtOrAfter(commonTimes[testStartIndex] - trainDays * 24 * 60 * 60 * 1000);
  const trainEndIndex = testStartIndex - 1;
  if (trainStartIndex < startIndex || trainEndIndex <= trainStartIndex || testEndIndex <= testStartIndex) continue;
  folds.push({ fold: fold + 1, trainStartIndex, trainEndIndex, testStartIndex, testEndIndex });
}

const foldReports = [];
const oosTrades = [];
const altOosTrades = [];
for (const fold of folds) {
  const training = mainCandidates.map((candidate) => {
    const trades = simulateCandidate(candidate, fold.trainStartIndex, fold.trainEndIndex);
    return { candidate, trades, summary: summarizeValidationTrades(trades) };
  });
  const selected = selectCandidate(training);
  const testTrades = selected ? simulateCandidate(selected.candidate, fold.testStartIndex, fold.testEndIndex) : [];
  oosTrades.push(...testTrades);

  const altTraining = altCandidates.map((candidate) => {
    const trades = simulateAltBasket(candidate, fold.trainStartIndex, fold.trainEndIndex);
    return { candidate, trades, summary: summarizeValidationTrades(trades) };
  });
  const altSelected = selectCandidate(altTraining, 10);
  const altTestTrades = altSelected
    ? simulateAltBasket(altSelected.candidate, fold.testStartIndex, fold.testEndIndex)
    : [];
  altOosTrades.push(...altTestTrades);

  foldReports.push({
    fold: fold.fold,
    train: {
      start: iso(commonTimes[fold.trainStartIndex]),
      end: iso(commonTimes[fold.trainEndIndex]),
      main: {
        selected: selected?.candidate.version ?? null,
        selectedSummary: selected?.summary ?? summarizeValidationTrades([]),
        leaderboard: trainingLeaderboard(training)
      },
      altBasket: {
        selected: altSelected?.candidate.version ?? null,
        selectedSummary: altSelected?.summary ?? summarizeValidationTrades([]),
        leaderboard: trainingLeaderboard(altTraining)
      }
    },
    test: {
      start: iso(commonTimes[fold.testStartIndex]),
      end: iso(commonTimes[fold.testEndIndex]),
      main: {
        trades: testTrades.length,
        summary: summarizeValidationTrades(testTrades)
      },
      altBasket: {
        trades: altTestTrades.length,
        summary: summarizeValidationTrades(altTestTrades)
      },
      trades: mergeValidationTrades(testTrades, altTestTrades).length,
      summary: summarizeValidationTrades(mergeValidationTrades(testTrades, altTestTrades))
    }
  });
}

const finalTraining = mainCandidates.map((candidate) => {
  const trades = simulateCandidate(candidate, startIndex, finalHoldoutStartIndex - 1);
  return { candidate, trades, summary: summarizeValidationTrades(trades) };
});
const finalSelected = selectCandidate(finalTraining);
const holdoutTrades = finalSelected
  ? simulateCandidate(finalSelected.candidate, finalHoldoutStartIndex, endIndex)
  : [];
const finalAltTraining = altCandidates.map((candidate) => {
  const trades = simulateAltBasket(candidate, startIndex, finalHoldoutStartIndex - 1);
  return { candidate, trades, summary: summarizeValidationTrades(trades) };
});
const finalAltSelected = selectCandidate(finalAltTraining, 10);
const altHoldoutTrades = finalAltSelected
  ? simulateAltBasket(finalAltSelected.candidate, finalHoldoutStartIndex, endIndex)
  : [];
const mainOosSummary = summarizeValidationTrades(oosTrades);
const altOosSummary = summarizeValidationTrades(altOosTrades);
const oosSummary = summarizeValidationTrades(mergeValidationTrades(oosTrades, altOosTrades));
const mainHoldoutSummary = summarizeValidationTrades(holdoutTrades);
const altHoldoutSummary = summarizeValidationTrades(altHoldoutTrades);
const holdoutSummary = summarizeValidationTrades(mergeValidationTrades(holdoutTrades, altHoldoutTrades));
const dataQuality = dataQualityReport();
const gate = evaluateValidationGate({
  coverageDays,
  dataQualityPassed: dataQuality.clean,
  oos: oosSummary,
  holdout: holdoutSummary
});
const candidateComparisons = buildCandidateComparisons(oosTrades, mainOosSummary);

const report = {
  generatedAt: new Date().toISOString(),
  codeVersion,
  validation: {
    selectionMode: process.env.WALK_FORWARD_FIXED_MAIN_VERSION ? "fixed_candidate" : "walk_forward_training_selection",
    mainCandidatePool: mainCandidates.map((candidate) => candidate.version),
    altCandidatePool: altCandidates.map((candidate) => candidate.version),
    selectedMain: finalSelected?.candidate.version ?? null,
    selectedAltBasket: finalAltSelected?.candidate.version ?? null
  },
  sourceDirs: lookbackDirs,
  coverage: {
    start: iso(commonTimes[startIndex]),
    end: iso(commonTimes[endIndex]),
    common15mBars: commonTimes.length - startIndex,
    coverageDays: round(coverageDays),
    symbols,
    dataQuality
  },
  execution: {
    exitMode: DEFAULT_REVIEW_EXECUTION_POLICY.exitMode,
    expiry: DEFAULT_REVIEW_EXECUTION_POLICY.expiry,
    sameCandlePriority: DEFAULT_REVIEW_EXECUTION_POLICY.sameCandlePriority,
    feeRatePerSide: oneWayFee,
    slippageRatePerSide: oneWaySlippage
  },
  walkForward: {
    trainDays,
    testDays,
    stepDays,
    folds: foldReports,
    finalHoldout: {
      start: iso(commonTimes[finalHoldoutStartIndex]),
      end: iso(commonTimes[endIndex]),
      selected: {
        main: finalSelected?.candidate.version ?? null,
        altBasket: finalAltSelected?.candidate.version ?? null
      },
      main: mainHoldoutSummary,
      altBasket: altHoldoutSummary,
      summary: holdoutSummary
    },
    finalTrainingLeaderboard: trainingLeaderboard(finalTraining)
  },
  strategies: {
    main: {
      oos: mainOosSummary,
      holdout: mainHoldoutSummary
    },
    altBasket: {
      oos: altOosSummary,
      holdout: altHoldoutSummary
    },
    combined: {
      oos: oosSummary,
      holdout: holdoutSummary
    }
  },
  oos: oosSummary,
  candidateComparisons,
  gate,
  deploymentAllowed: gate.passed
};

console.log(JSON.stringify(report, null, 2));
if (process.env.OUTPUT_JSON) fs.writeFileSync(path.resolve(process.env.OUTPUT_JSON), JSON.stringify(report, null, 2));
if (process.env.VALIDATION_PERSIST_URL) {
  const response = await globalThis.fetch(process.env.VALIDATION_PERSIST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.BACKTEST_VALIDATION_SECRET
        ? { "x-backtest-validation-secret": process.env.BACKTEST_VALIDATION_SECRET }
        : {})
    },
    body: JSON.stringify({ report })
  });
  if (!response.ok) throw new Error(`Validation persistence failed: ${response.status} ${await response.text()}`);
}
if (!gate.passed) process.exitCode = 2;

function simulateCandidate(candidate, fromIndex, toIndex) {
  const trades = [];
  const nextAvailable = Object.fromEntries(tradeSymbols.map((symbol) => [symbol, fromIndex]));
  const lastSignalKeys = Object.fromEntries(tradeSymbols.map((symbol) => [symbol, null]));
  for (const symbol of tradeSymbols) {
    const series = aligned[symbol];
    for (let index = Math.max(startIndex, fromIndex); index < toIndex; index += 1) {
      if (index < nextAvailable[symbol]) continue;
      const current = series[index];
      const momentumDirection = current.close >= series[index - 10].close ? "LONG" : "SHORT";
      const indicatorStart = Math.max(0, index - 60);
      const btc4hIndex = btc4hIndexByTime[index] ?? -1;
      const btcRegime = btc4hIndex >= 0
        ? resolveBtcRegime(btc4h.slice(Math.max(0, btc4hIndex - 49), btc4hIndex + 1))
        : "unknown";
      const relativeDirection = calculateRelativeStrength(
        series.slice(Math.max(0, index - 15), index + 1),
        aligned.BTCUSDT.slice(Math.max(0, index - 15), index + 1)
      ) >= 0 ? "LONG" : "SHORT";
      const direction = process.env.WALK_FORWARD_DIRECTION === "contrarian"
        ? (momentumDirection === "LONG" ? "SHORT" : "LONG")
        : process.env.WALK_FORWARD_DIRECTION === "btc_regime" && btcRegime !== "unknown"
          ? (btcRegime === "bull" ? "LONG" : "SHORT")
          : process.env.WALK_FORWARD_DIRECTION === "relative"
            ? relativeDirection
          : momentumDirection;
      if (process.env.WALK_FORWARD_DIRECTION_ONLY && direction !== process.env.WALK_FORWARD_DIRECTION_ONLY) continue;
      const signal = evaluateSignalCandidate({
        symbol,
        direction,
        signalType: "trend_pullback",
        candles15m: series.slice(indicatorStart, index + 1),
        btcCandles15m: aligned.BTCUSDT.slice(indicatorStart, index + 1),
        btcCandles4h: btc4hIndex >= 0 ? btc4h.slice(Math.max(0, btc4hIndex - 49), btc4hIndex + 1) : [],
        strategyVersion: candidate.version,
        strategyConfig: candidate,
        now: current.closeTime + 1,
        fundingRate: null,
        oiChange15m: null,
        circuitBreakerActive: false
      });
      if (process.env.WALK_FORWARD_LIVE_DEDUPE !== "0" && (signal.level === "A" || signal.level === "S")) {
        const signalKey = [signal.direction, signal.signalType, signal.marketRegime, signal.level, signal.lifecycleStatus].join(":");
        if (lastSignalKeys[symbol] === signalKey) continue;
        lastSignalKeys[symbol] = signalKey;
      }
      if (signal.lifecycleStatus !== "planned" || !signal.plan) continue;

      const state = cachedReviewState({
        symbol,
        index,
        toIndex,
        direction,
        targetR: candidate.targetR,
        plan: signal.plan,
        candles: series.slice(index + 1, toIndex + 1)
      });
      trades.push({
        direction,
        signalTime: current.closeTime,
        finalStatus: state.finalStatus,
        entryHit: state.entryHit,
        netR: state.netR,
        grossR: state.grossR,
        netPnlPct: state.netPnlPct,
        symbol,
        marketRegime: signal.marketRegime,
        signalType: signal.signalType,
        strategyVersion: candidate.version,
        signalScore: signal.score,
        dataQualityScore: signal.dataQualityScore,
        costCoverageRatio: signal.costEdge?.costCoverageRatio ?? 0
      });
      const exitIndex = state.exitTime === null ? toIndex : indexAtOrAfter(state.exitTime);
      nextAvailable[symbol] = Math.max(index + 1, exitIndex + 1 + signalCooldownBars);
    }
  }
  return trades.sort((a, b) => a.signalTime - b.signalTime);
}

function cachedReviewState(input) {
  const key = [input.symbol, input.index, input.toIndex, input.direction, input.targetR].join(":");
  const cached = outcomeCache.get(key);
  if (cached) return cached;
  const state = applyReviewCandles({
    direction: input.direction,
    plan: input.plan,
    candles: input.candles,
    feeRate: oneWayFee,
    slippageRate: oneWaySlippage,
    executionPolicy: DEFAULT_REVIEW_EXECUTION_POLICY,
    candlesAreSorted: true
  });
  outcomeCache.set(key, state);
  return state;
}

function simulateAltBasket(candidate, fromIndex, toIndex) {
  const trades = [];
  let nextAvailableIndex = fromIndex;
  let lastBtc4hIndex = -1;

  for (let index = Math.max(startIndex, fromIndex); index < toIndex; index += 1) {
    const btc4hIndex = btc4hIndexByTime[index] ?? -1;
    if (btc4hIndex < 0 || btc4hIndex === lastBtc4hIndex) continue;
    lastBtc4hIndex = btc4hIndex;
    if (index < nextAvailableIndex) continue;

    const signal = evaluateAltBasketShortStrategy({
      btcCandles4h: btc4h.slice(Math.max(0, btc4hIndex - 49), btc4hIndex + 1),
      basketCandles15m: Object.fromEntries(altSymbols.map((symbol) => [
        symbol,
        aligned[symbol].slice(Math.max(0, index - 60), index + 1)
      ])),
      fundingRates: Object.fromEntries(altSymbols.map((symbol) => [symbol, null])),
      config: candidate.config
    });
    if (!signal?.plan || index + 1 > toIndex) continue;

    const entryPrices = Object.fromEntries(altSymbols.map((symbol) => [symbol, aligned[symbol][index].close]));
    const futureCandles = buildSyntheticBasketCandles(index + 1, toIndex, entryPrices);
    const firstFutureCandle = futureCandles[0];
    const state = applyReviewCandles({
      direction: candidate.direction,
      plan: signal.plan,
      candles: futureCandles,
      feeRate: oneWayFee,
      slippageRate: oneWaySlippage,
      executionPolicy: DEFAULT_REVIEW_EXECUTION_POLICY,
      candlesAreSorted: true,
      state: firstFutureCandle
        ? { entryHit: true, entryTime: firstFutureCandle.openTime, entryPrice: 100 }
        : undefined
    });
    trades.push({
      direction: candidate.direction,
      signalTime: commonTimes[index],
      finalStatus: state.finalStatus,
      entryHit: state.entryHit,
      netR: state.netR,
      grossR: state.grossR,
      netPnlPct: state.netPnlPct,
      symbol: "ALT_SHORT_BASKET",
      marketRegime: signal.marketRegime,
      signalType: signal.signalType,
      strategyVersion: candidate.version,
      signalScore: signal.score,
      dataQualityScore: signal.dataQualityScore,
      costCoverageRatio: signal.costEdge?.costCoverageRatio ?? 0
    });

    const exitIndex = state.exitTime === null ? toIndex : indexAtOrAfter(state.exitTime);
    nextAvailableIndex = Math.max(index + 1, exitIndex + 1);
  }

  return trades.sort((a, b) => a.signalTime - b.signalTime);
}

function buildSyntheticBasketCandles(fromIndex, toIndex, entryPrices) {
  const candles = [];
  for (let index = fromIndex; index <= toIndex; index += 1) {
    const componentBars = altSymbols.map((symbol) => aligned[symbol][index]);
    if (componentBars.some((bar) => !bar)) continue;
    const ratios = (field) => componentBars.reduce((sum, bar, componentIndex) => {
      const symbol = altSymbols[componentIndex];
      return sum + Number(bar[field]) / entryPrices[symbol];
    }, 0) / componentBars.length * 100;
    candles.push({
      symbol: "ALT_SHORT_BASKET",
      interval: "15m",
      openTime: commonTimes[index],
      closeTime: componentBars.at(-1).closeTime,
      open: ratios("open"),
      high: ratios("high"),
      low: ratios("low"),
      close: ratios("close"),
      volume: 0,
      quoteVolume: 0,
      trades: null,
      takerBuyVolume: null,
      takerBuyQuoteVolume: null,
      isClosed: true
    });
  }
  return candles;
}

function buildCandidateComparisons(trades, baselineSummary) {
  const baselineMaxDrawdownR = baselineSummary.maxDrawdownR;
  const describe = (id, label, candidateTrades, rationale) => {
    const summary = summarizeValidationTrades(candidateTrades);
    return {
      id,
      label,
      rationale,
      summary,
      promotion: evaluatePromotionGate({
        candidate: summary,
        baselineMaxDrawdownR,
        noLookAheadBias: true,
        noDataLeakage: true
      })
    };
  };

  return {
    evidenceBoundary: "OOS only; signal inputs end at the evaluation candle and review candles begin strictly after it.",
    currentBaseline: describe(
      "main-v2-current",
      "Main V2 current baseline",
      trades,
      "Unchanged production parameters; comparison reference only."
    ),
    costGateCandidates: COST_GATE_CANDIDATES.map((candidate) => describe(
      candidate.id,
      candidate.label,
      trades.filter((trade) => passesCostGate({ costCoverageRatio: trade.costCoverageRatio ?? 0 }, candidate.minimumCoverageRatio)),
      "Finite candidate threshold using the exact review fee/slippage model."
    )),
    concentrationCandidates: [1, 2, 3].map((maximum) => describe(
      `concentration-top-${maximum}`,
      `Same-window same-direction top ${maximum}`,
      applyHistoricalConcentration(trades, maximum),
      "Ranks signal score, net cost coverage, then data quality; shadow comparison only."
    ))
  };
}

function applyHistoricalConcentration(trades, maximum) {
  const groups = new Map();
  for (const trade of trades) {
    const window = Math.floor(trade.signalTime / fifteenMinutes);
    const key = `${window}:${trade.direction}`;
    const group = groups.get(key) ?? [];
    group.push(trade);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => [...group]
    .sort((a, b) => (b.signalScore ?? 0) - (a.signalScore ?? 0)
      || (b.costCoverageRatio ?? 0) - (a.costCoverageRatio ?? 0)
      || (b.dataQualityScore ?? 0) - (a.dataQualityScore ?? 0)
      || String(a.symbol ?? "").localeCompare(String(b.symbol ?? "")))
    .slice(0, maximum))
    .sort((a, b) => a.signalTime - b.signalTime);
}

function selectCandidate(results, minimumSettledTrades = 20) {
  const eligible = results.filter((result) => result.summary.settledTrades >= minimumSettledTrades);
  return [...eligible].sort((a, b) =>
    b.summary.netPnlPct - a.summary.netPnlPct
    || b.summary.profitFactor - a.summary.profitFactor
    || b.summary.netR - a.summary.netR
  )[0] ?? null;
}

function trainingLeaderboard(results) {
  return [...results]
    .sort((a, b) =>
      b.summary.netPnlPct - a.summary.netPnlPct
      || b.summary.profitFactor - a.summary.profitFactor
      || b.summary.netR - a.summary.netR
    )
    .slice(0, 8)
    .map((result) => ({ version: result.candidate.version, summary: result.summary }));
}

function readCandles(symbol) {
  const byOpenTime = new Map();
  for (const sourceDir of sourceDirs) {
    const filePath = path.join(sourceDir, `${symbol}-15m.json`);
    if (!fs.existsSync(filePath)) continue;
    const rows = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const row of rows) byOpenTime.set(Number(row.openTime), row);
  }
  return [...byOpenTime.values()]
    .filter((candle) => candle.isClosed !== false)
    .sort((a, b) => a.openTime - b.openTime);
}

function intersectTimes(timeLists) {
  let common = new Set(timeLists[0]);
  for (const times of timeLists.slice(1)) {
    const next = new Set(times);
    common = new Set([...common].filter((time) => next.has(time)));
  }
  return [...common].sort((a, b) => a - b);
}

function alignBars(bars, times) {
  const map = new Map(bars.map((bar) => [Number(bar.openTime), bar]));
  return times.map((time) => map.get(time));
}

function aggregateFourHour(bars) {
  const groups = new Map();
  for (const bar of bars) {
    const bucket = Math.floor(bar.openTime / fourHours) * fourHours;
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

function dataQualityReport() {
  const commonGaps = countGaps(commonTimes);
  const perSymbol = Object.fromEntries(symbols.map((symbol) => {
    const bars = candlesBySymbol[symbol];
    return [symbol, {
      bars: bars.length,
      commonBars: aligned[symbol].length,
      gaps: countGaps(bars),
      duplicatesRemoved: bars.length !== new Set(bars.map((bar) => bar.openTime)).size
    }];
  }));
  return {
    clean: commonGaps === 0 && Object.values(perSymbol).every((item) => item.gaps === 0 && !item.duplicatesRemoved),
    common: { bars: commonTimes.length, gaps: commonGaps },
    symbols: perSymbol
  };
}

function countGaps(bars) {
  let gaps = 0;
  for (let index = 1; index < bars.length; index += 1) {
    const previous = typeof bars[index - 1] === "number" ? bars[index - 1] : bars[index - 1].openTime;
    const current = typeof bars[index] === "number" ? bars[index] : bars[index].openTime;
    if (current - previous > fifteenMinutes * 1.5) gaps += 1;
  }
  return gaps;
}

function indexAtOrAfter(time) {
  const index = commonTimes.findIndex((item) => item >= time);
  return index === -1 ? commonTimes.length - 1 : index;
}

function indexAtOrBefore(time) {
  let index = 0;
  for (let candidate = 0; candidate < commonTimes.length; candidate += 1) {
    if (commonTimes[candidate] > time) break;
    index = candidate;
  }
  return index;
}

function iso(value) {
  return new Date(value).toISOString();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function resolveCodeVersion() {
  const configured = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA;
  if (configured) return configured;

  try {
    const gitDir = path.join(process.cwd(), ".git");
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return `${head}+working-tree`;
    const refPath = path.join(gitDir, head.slice(5));
    const commit = fs.readFileSync(refPath, "utf8").trim();
    return `${commit}+working-tree`;
  } catch {
    return "working-tree-unknown";
  }
}

function parseStructureVariant(value) {
  if (!value) return null;
  const [lookbackText, bufferText] = value.split(":");
  const lookback = Number(lookbackText);
  const buffer = Number(bufferText);
  if (!Number.isInteger(lookback) || lookback < 4 || !Number.isFinite(buffer) || buffer <= 0) {
    throw new Error(`Invalid WALK_FORWARD_STRUCTURE_VARIANT: ${value}`);
  }
  return { lookback, buffer };
}

function parseStrengthThreshold(value) {
  if (!value) return null;
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`Invalid WALK_FORWARD_STRENGTH_THRESHOLD: ${value}`);
  return threshold;
}

function parseSetupMode(value) {
  if (!value) return null;
  if (value !== "pullback" && value !== "breakout") throw new Error(`Invalid WALK_FORWARD_SETUP_MODE: ${value}`);
  return value;
}

function parseRelativeStrengthMode(value) {
  if (!value) return null;
  if (value !== "trend" && value !== "reversal") throw new Error(`Invalid WALK_FORWARD_RELATIVE_STRENGTH_MODE: ${value}`);
  return value;
}
