import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BASE_URL = process.env.BINANCE_FUTURES_BASE_URL || "https://fapi.binance.com";
const SYMBOLS = (process.env.SIGNAL_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,LINKUSDT,AVAXUSDT,DOGEUSDT")
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const INTERVAL_MS = 15 * 60 * 1000;
const END_TIME = Date.now();
const LOOKBACK_DAYS = Number(process.env.BACKTEST_LOOKBACK_DAYS || 365);
const START_TIME = Number(process.env.BACKTEST_START_TIME || END_TIME - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
const HORIZON_CANDLES = Number(process.env.BACKTEST_HORIZON_CANDLES || 96);
const FEE_RATE = Number(process.env.BACKTEST_FEE_RATE || 0.0004);
const SLIPPAGE_RATE = Number(process.env.BACKTEST_SLIPPAGE_RATE || 0.0005);
const CACHE_DIR = path.join(process.cwd(), ".cache", "historical-backtest", `${LOOKBACK_DAYS}d`);
fs.mkdirSync(CACHE_DIR, { recursive: true });

const pollingSteps = [1, 2, 4];

const candlesBySymbol = new Map();
for (const symbol of SYMBOLS) {
  candlesBySymbol.set(symbol, await fetchAllKlines(symbol));
}

const btcCandles = candlesBySymbol.get("BTCUSDT") || [];
const btcIndexByOpenTime = new Map(btcCandles.map((candle, index) => [candle.openTime, index]));
const rows = [];

for (const step of pollingSteps) {
  for (const symbol of SYMBOLS.filter((item) => item !== "BTCUSDT")) {
    const candles = candlesBySymbol.get(symbol) || [];
    const trades = simulateSymbol(symbol, candles, step);
    rows.push(...trades);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  assumptions: {
    baseUrl: BASE_URL,
    symbols: SYMBOLS,
    interval: "15m",
    startTime: new Date(START_TIME).toISOString(),
    endTime: new Date(END_TIME).toISOString(),
    horizonCandles: HORIZON_CANDLES,
    feeRate: FEE_RATE,
    slippageRate: SLIPPAGE_RATE,
    execution: "one active trade per symbol; entry can fill after signal candle; SL wins if TP and SL hit in same candle"
  },
  dataCoverage: Object.fromEntries(
    SYMBOLS.map((symbol) => {
      const candles = candlesBySymbol.get(symbol) || [];
      return [
        symbol,
        {
          candles: candles.length,
          first: candles[0] ? new Date(candles[0].openTime).toISOString() : null,
          last: candles.at(-1) ? new Date(candles.at(-1).openTime).toISOString() : null
        }
      ];
    })
  ),
  summaries: {
    byPolling: summarizeGroup(rows, (row) => `${row.pollingMinutes}m`),
    optimizedByPolling: summarizeGroup(rows.filter(isOptimizedStrongAlert), (row) => `${row.pollingMinutes}m`),
    bySymbol: summarizeGroup(rows.filter((row) => row.pollingMinutes === 15), (row) => row.symbol),
    optimizedBySymbol: summarizeGroup(rows.filter((row) => row.pollingMinutes === 15 && isOptimizedStrongAlert(row)), (row) => row.symbol),
    byLevel: summarizeGroup(rows.filter((row) => row.pollingMinutes === 15), (row) => row.level),
    byDirection: summarizeGroup(rows.filter((row) => row.pollingMinutes === 15), (row) => row.direction),
    bySymbolDirection: summarizeGroup(rows.filter((row) => row.pollingMinutes === 15), (row) => `${row.symbol}:${row.direction}`)
  },
  sampleTrades: rows
    .filter((row) => row.pollingMinutes === 15)
    .slice(0, 20)
    .map((row) => ({
      time: new Date(row.signalTime).toISOString(),
      symbol: row.symbol,
      direction: row.direction,
      level: row.level,
      score: row.score,
      finalStatus: row.finalStatus,
      finalR: row.finalR
    }))
};

console.log(JSON.stringify(report, null, 2));

function isOptimizedStrongAlert(row) {
  return row.level === "S" && row.symbol !== "LINKUSDT" && row.symbol !== "AVAXUSDT";
}

function simulateSymbol(symbol, candles, step) {
  const trades = [];
  let nextAvailableIndex = 40;
  for (let index = 40; index < candles.length - HORIZON_CANDLES; index += step) {
    if (index < nextAvailableIndex) continue;
    const signalWindow = candles.slice(0, index + 1);
    const btcIndex = btcIndexByOpenTime.get(candles[index].openTime);
    if (btcIndex === undefined || btcIndex < 40) continue;
    const btcWindow = btcCandles.slice(0, btcIndex + 1);
    const direction = candles[index].close >= candles[index - 9].close ? "LONG" : "SHORT";
    const signal = evaluateSignalCandidate({
      symbol,
      direction,
      candles15m: signalWindow,
      btcCandles15m: btcWindow,
      now: candles[index].closeTime
    });

    if (!(signal.level === "A" || signal.level === "S") || signal.lifecycleStatus !== "planned" || !signal.plan) {
      continue;
    }

    const outcome = simulateSignalOutcome(direction, signal.plan, candles.slice(index + 1, index + 1 + HORIZON_CANDLES));
    trades.push({
      pollingMinutes: step * 15,
      symbol,
      signalTime: candles[index].closeTime,
      direction,
      level: signal.level,
      score: signal.score,
      finalStatus: outcome.finalStatus,
      finalR: outcome.finalR,
      entryHit: outcome.entryHit,
      mfe: outcome.mfe,
      mae: outcome.mae
    });
    nextAvailableIndex = index + 1 + outcome.durationCandles;
  }
  return trades;
}

async function fetchAllKlines(symbol) {
  const cachePath = path.join(CACHE_DIR, `${symbol}-15m.json`);
  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (Array.isArray(cached) && cached.length > 100 && Number.isFinite(cached[0]?.openTime)) {
      process.stderr.write(`cache ${symbol}\n`);
      return cached;
    }
    process.stderr.write(`ignore invalid cache ${symbol}\n`);
  }

  process.stderr.write(`fetch ${symbol}\n`);
  const candles = [];
  let startTime = START_TIME;
  let emptyResponses = 0;

  while (startTime < END_TIME) {
    const url = new URL("/fapi/v1/klines", BASE_URL);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "15m");
    url.searchParams.set("limit", "1500");
    url.searchParams.set("startTime", String(startTime));
    url.searchParams.set("endTime", String(END_TIME));

    const rawData = await fetchJsonWithRetry(url);
    const data = Array.isArray(rawData) ? rawData : rawData?.value ?? [];
    if (data.length === 0) {
      emptyResponses += 1;
      startTime += INTERVAL_MS * 1500;
      if (emptyResponses > 100) break;
      continue;
    }

    emptyResponses = 0;
    for (const item of data) candles.push(normalizeKline(symbol, item));
    startTime = Number(data.at(-1)[0]) + INTERVAL_MS;
    await sleep(40);
  }

  const result = dedupe(candles);
  fs.writeFileSync(cachePath, JSON.stringify(result));
  process.stderr.write(`done ${symbol}: ${result.length}\n`);
  return result;
}

async function fetchJsonWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      return await requestJson(url);
    } catch (error) {
      lastError = error;
      await sleep(Math.min(30_000, 1_000 * attempt));
    }
  }
  throw lastError;
}

function requestJson(url) {
  if (process.platform === "win32") return requestJsonViaPowerShell(url);
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        family: 4,
        timeout: 30_000,
        headers: {
          "user-agent": "gpt-signal-backtest"
        }
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("timeout", () => {
      request.destroy(new Error("request timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}

function requestJsonViaPowerShell(url) {
  const command = [
    "$ProgressPreference = 'SilentlyContinue';",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
    `$r = Invoke-RestMethod -Uri '${String(url).replaceAll("'", "''")}' -TimeoutSec 30;`,
    "ConvertTo-Json -InputObject $r -Compress -Depth 20"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `PowerShell exited ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function evaluateSignalCandidate(input) {
  const latest = input.candles15m.at(-1);
  const atr = calculateAtr(input.candles15m, 14);
  const dataQualityScore = calculateDataQualityScore(input.candles15m, input.now, INTERVAL_MS);
  const relativeStrengthScore = calculateRelativeStrength(input.candles15m.slice(-16), input.btcCandles15m.slice(-16));
  const volumeRatio = calculateVolumeRatio(input.candles15m, 20);
  const structure = findStructure(input.candles15m, 20);
  const currentPrice = latest?.close ?? 0;
  const plan = latest
    ? buildTradingPlan({
        direction: input.direction,
        currentPrice,
        atr,
        structureLow: structure.low,
        structureHigh: structure.high
      })
    : null;

  const btcAligned = input.direction === "LONG" ? relativeStrengthScore >= -2 : relativeStrengthScore <= 2;
  const score = scoreSignal({
    dataQualityScore,
    btcAligned,
    marketRegimeMatched: true,
    trend4hAligned: true,
    trend1hAligned: true,
    entryStructureConfirmed: true,
    volumeRatio,
    oiChange15m: null,
    fundingRate: null,
    relativeStrengthScore,
    liquidityScore: 5,
    weightedRr: plan?.weightedRr ?? 0
  });
  const level = levelFromScore(score);
  const noChase = plan
    ? shouldMarkNoChase({
        direction: input.direction,
        currentPrice,
        entryLow: plan.entryLow,
        entryHigh: plan.entryHigh,
        stopLoss: plan.stopLoss
      })
    : true;
  const eligibleForPlan =
    (level === "A" || level === "S") && dataQualityScore >= 90 && (plan?.weightedRr ?? 0) >= 1.3 && !noChase;

  return {
    symbol: input.symbol,
    direction: input.direction,
    lifecycleStatus: eligibleForPlan ? "planned" : score >= 65 ? "watching" : "detected",
    level,
    score,
    plan: eligibleForPlan ? plan : null
  };
}

function buildTradingPlan(input) {
  const buffer = input.atr * 0.3;
  if (input.direction === "LONG") {
    const stopLoss = input.structureLow - buffer;
    const risk = input.currentPrice - stopLoss;
    const entryLow = input.currentPrice - input.atr * 0.15;
    const entryHigh = input.currentPrice + input.atr * 0.35;
    return createPlan("pullback_limit", entryLow, entryHigh, stopLoss, input.currentPrice, risk, input.atr, "LONG");
  }

  const stopLoss = input.structureHigh + buffer;
  const risk = stopLoss - input.currentPrice;
  const entryLow = input.currentPrice - input.atr * 0.35;
  const entryHigh = input.currentPrice + input.atr * 0.15;
  return createPlan("pullback_limit", entryLow, entryHigh, stopLoss, input.currentPrice, risk, input.atr, "SHORT");
}

function simulateSignalOutcome(direction, plan, futureCandles) {
  const risk = Math.abs(plan.entryHigh - plan.stopLoss);
  let entryHit = false;
  let mfe = 0;
  let mae = 0;

  for (let i = 0; i < futureCandles.length; i++) {
    const candle = futureCandles[i];
    if (!entryHit) {
      entryHit =
        direction === "LONG"
          ? candle.low <= plan.entryHigh && candle.high >= plan.entryLow
          : candle.high >= plan.entryLow && candle.low <= plan.entryHigh;
    }
    if (!entryHit) continue;

    const favorable = direction === "LONG" ? candle.high - plan.entryHigh : plan.entryLow - candle.low;
    const adverse = direction === "LONG" ? plan.entryHigh - candle.low : candle.high - plan.entryLow;
    mfe = Math.max(mfe, favorable / risk);
    mae = Math.max(mae, adverse / risk);

    const hitSl = direction === "LONG" ? candle.low <= plan.stopLoss : candle.high >= plan.stopLoss;
    const hitTp1 = direction === "LONG" ? candle.high >= plan.tp1 : candle.low <= plan.tp1;
    const hitTp2 = direction === "LONG" ? candle.high >= plan.tp2 : candle.low <= plan.tp2;
    const hitTp3 = direction === "LONG" ? candle.high >= plan.tp3 : candle.low <= plan.tp3;
    if (hitSl) return withCosts({ entryHit, finalStatus: "hit_sl", finalR: -1, mfe, mae, durationCandles: i + 1 });
    if (hitTp3) return withCosts({ entryHit, finalStatus: "hit_tp3", finalR: 3, mfe, mae, durationCandles: i + 1 });
    if (hitTp2) return withCosts({ entryHit, finalStatus: "hit_tp2", finalR: 2, mfe, mae, durationCandles: i + 1 });
    if (hitTp1) return withCosts({ entryHit, finalStatus: "hit_tp1", finalR: 1, mfe, mae, durationCandles: i + 1 });
  }

  return withCosts({ entryHit, finalStatus: "expired", finalR: 0, mfe, mae, durationCandles: futureCandles.length });
}

function scoreSignal(input) {
  let score = 0;
  score += clamp(input.dataQualityScore / 10, 0, 10);
  score += input.btcAligned ? 10 : 4;
  score += input.marketRegimeMatched ? 10 : 5;
  score += input.trend4hAligned ? 8 : 3;
  score += input.trend1hAligned ? 8 : 3;
  score += input.entryStructureConfirmed ? 14 : 5;
  score += clamp(input.volumeRatio / 2, 0, 1) * 8;
  score += input.oiChange15m === null ? 5 : input.oiChange15m > 0 ? 8 : 3;
  score += fundingHealthScore(input.fundingRate);
  score += clamp(Math.abs(input.relativeStrengthScore), 0, 6);
  score += clamp(input.liquidityScore, 0, 5);
  score += input.weightedRr >= 1.3 ? 5 : 1;
  return Math.round(clamp(score, 0, 100));
}

function summarizeGroup(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .map(([key, group]) => [key, summarize(group)])
      .sort((a, b) => b[1].totalR - a[1].totalR)
  );
}

function summarize(items) {
  const wins = items.filter((item) => item.finalR > 0);
  const losses = items.filter((item) => item.finalR < 0);
  const grossProfit = sum(wins.map((item) => item.finalR));
  const grossLoss = Math.abs(sum(losses.map((item) => item.finalR)));
  return {
    trades: items.length,
    winRate: pct(wins.length, items.length),
    entryFillRate: pct(items.filter((item) => item.entryHit).length, items.length),
    avgR: round(avg(items.map((item) => item.finalR))),
    medianR: round(median(items.map((item) => item.finalR))),
    totalR: round(sum(items.map((item) => item.finalR))),
    profitFactor: round(grossLoss === 0 ? grossProfit : grossProfit / grossLoss),
    maxDrawdownR: round(maxDrawdown(items.map((item) => item.finalR))),
    maxLosingStreak: maxLosingStreak(items.map((item) => item.finalR)),
    avgMfe: round(avg(items.map((item) => item.mfe))),
    avgMae: round(avg(items.map((item) => item.mae))),
    avgScore: round(avg(items.map((item) => item.score))),
    statusCounts: countBy(items, (item) => item.finalStatus)
  };
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function createPlan(entryMode, entryLow, entryHigh, stopLoss, currentPrice, risk, atr, direction) {
  const sign = direction === "LONG" ? 1 : -1;
  const tp1 = currentPrice + sign * risk;
  const tp2 = currentPrice + sign * risk * 2;
  const tp3 = currentPrice + sign * risk * 3;
  const weightedRr = 0.4 * 1 + 0.4 * 2 + 0.2 * 3;
  const costAdjustedRr = weightedRr - 0.12;
  const slDistancePct = Math.abs((currentPrice - stopLoss) / currentPrice) * 100;
  const slAtrRatio = atr === 0 ? 0 : Math.abs(currentPrice - stopLoss) / atr;
  const noChasePrice = direction === "LONG" ? entryHigh + risk : entryLow - risk;
  return {
    entryMode,
    entryLow: round(entryLow),
    entryHigh: round(entryHigh),
    stopLoss: round(stopLoss),
    tp1: round(tp1),
    tp2: round(tp2),
    tp3: round(tp3),
    theoreticalRr: 3,
    weightedRr,
    costAdjustedRr,
    slDistancePct: round(slDistancePct),
    slAtrRatio: round(slAtrRatio),
    noChasePrice: round(noChasePrice)
  };
}

function shouldMarkNoChase(input) {
  const risk = input.direction === "LONG" ? input.entryHigh - input.stopLoss : input.stopLoss - input.entryLow;
  if (risk <= 0) return true;
  return input.direction === "LONG" ? input.currentPrice > input.entryHigh + risk : input.currentPrice < input.entryLow - risk;
}

function calculateAtr(candles, period) {
  const recent = candles.slice(-period - 1);
  if (recent.length < 2) return 0;
  const trueRanges = [];
  for (let i = 1; i < recent.length; i++) {
    const current = recent[i];
    const previous = recent[i - 1];
    trueRanges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  return avg(trueRanges);
}

function calculateDataQualityScore(candles, now, expectedIntervalMs) {
  if (candles.length === 0) return 0;
  let score = 100;
  const openCount = candles.filter((item) => !item.isClosed).length;
  score -= openCount * 20;
  const uniqueOpenTimes = new Set(candles.map((item) => item.openTime));
  if (uniqueOpenTimes.size !== candles.length) score -= 25;
  for (let i = 1; i < candles.length; i++) {
    const gap = candles[i].openTime - candles[i - 1].openTime;
    if (gap > expectedIntervalMs * 1.5) score -= 10;
  }
  const latest = candles.at(-1);
  if (latest && now - latest.closeTime > expectedIntervalMs * 2) score -= 25;
  return clamp(score, 0, 100);
}

function calculateRelativeStrength(symbolCandles, btcCandles) {
  if (symbolCandles.length < 2 || btcCandles.length < 2) return 0;
  const symbolReturn = percentChange(symbolCandles[0].close, symbolCandles.at(-1).close);
  const btcReturn = percentChange(btcCandles[0].close, btcCandles.at(-1).close);
  return symbolReturn - btcReturn;
}

function calculateVolumeRatio(candles, period) {
  const recent = candles.slice(-period);
  if (recent.length === 0) return 0;
  const latest = recent.at(-1).quoteVolume;
  const baseline = avg(recent.slice(0, -1).map((item) => item.quoteVolume));
  if (!baseline) return 0;
  return latest / baseline;
}

function findStructure(candles, lookback) {
  const recent = candles.slice(-lookback);
  return {
    high: Math.max(...recent.map((item) => item.high)),
    low: Math.min(...recent.map((item) => item.low))
  };
}

function fundingHealthScore(rate) {
  if (rate === null || rate === undefined) return 5;
  const abs = Math.abs(rate);
  if (abs < 0.0002) return 8;
  if (abs < 0.0005) return 5;
  return 2;
}

function normalizeKline(symbol, item) {
  const openTime = Number(item[0]);
  const closeTime = Number(item[6]);
  return {
    symbol,
    interval: "15m",
    openTime,
    closeTime,
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[5]),
    quoteVolume: Number(item[7]),
    trades: Number(item[8]),
    takerBuyVolume: Number(item[9]),
    takerBuyQuoteVolume: Number(item[10]),
    isClosed: closeTime <= Date.now()
  };
}

function dedupe(candles) {
  return [...new Map(candles.map((item) => [item.openTime, item])).values()].sort((a, b) => a.openTime - b.openTime);
}

function withCosts(outcome) {
  const costInR = (FEE_RATE + SLIPPAGE_RATE) * 2;
  return {
    ...outcome,
    finalR: round(outcome.finalR - Math.sign(outcome.finalR) * costInR)
  };
}

function levelFromScore(score) {
  if (score >= 88) return "S";
  if (score >= 78) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "NONE";
}

function pct(numerator, denominator) {
  return denominator ? round((numerator / denominator) * 100) : 0;
}

function maxDrawdown(results) {
  let equity = 0;
  let peak = 0;
  let max = 0;
  for (const result of results) {
    equity += result;
    peak = Math.max(peak, equity);
    max = Math.max(max, peak - equity);
  }
  return max;
}

function maxLosingStreak(results) {
  let current = 0;
  let max = 0;
  for (const result of results) {
    if (result < 0) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

function sum(values) {
  return values.reduce((acc, item) => acc + item, 0);
}

function avg(values) {
  return values.length ? sum(values) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentChange(start, end) {
  if (!start) return 0;
  return ((end - start) / start) * 100;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
