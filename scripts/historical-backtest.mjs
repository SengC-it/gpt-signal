import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateSignalCandidate } from "../src/lib/signal/engine.ts";
import { applyReviewCandles, DEFAULT_REVIEW_EXECUTION_POLICY } from "../src/lib/signal/review.ts";

const BASE_URL = process.env.BINANCE_FUTURES_BASE_URL || "https://fapi.binance.com";
const SYMBOLS = (process.env.SIGNAL_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,LINKUSDT,AVAXUSDT,DOGEUSDT")
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const INTERVAL_MS = 15 * 60 * 1000;
const END_TIME = Number(process.env.BACKTEST_END_TIME || Date.now());
const LOOKBACK_DAYS = Number(process.env.BACKTEST_LOOKBACK_DAYS || 452);
const START_TIME = Number(process.env.BACKTEST_START_TIME || END_TIME - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
const FEE_RATE = Number(process.env.BACKTEST_FEE_RATE || 0.001);
const SLIPPAGE_RATE = Number(process.env.BACKTEST_SLIPPAGE_RATE || 0.0005);
const CACHE_KEY = process.env.BACKTEST_CACHE_KEY || `${LOOKBACK_DAYS}d`;
const CACHE_DIR = path.join(process.cwd(), ".cache", "historical-backtest", CACHE_KEY);
fs.mkdirSync(CACHE_DIR, { recursive: true });

const pollingSteps = [1, 2, 4];

const candlesBySymbol = new Map();
for (const symbol of SYMBOLS) {
  candlesBySymbol.set(symbol, await fetchAllKlines(symbol));
}

if (process.env.FETCH_ONLY === "1") {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    startTime: new Date(START_TIME).toISOString(),
    endTime: new Date(END_TIME).toISOString(),
    dataCoverage: Object.fromEntries(SYMBOLS.map((symbol) => {
      const candles = candlesBySymbol.get(symbol) || [];
      return [symbol, {
        candles: candles.length,
        first: candles[0] ? new Date(candles[0].openTime).toISOString() : null,
        last: candles.at(-1) ? new Date(candles.at(-1).openTime).toISOString() : null
      }];
    }))
  }, null, 2));
  process.exit(0);
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
    feeRate: FEE_RATE,
    slippageRate: SLIPPAGE_RATE,
    execution: "one active trade per symbol; entry can fill after signal candle; full position exits at TP1; TP2/TP3 do not change the result; SL wins if TP1 and SL hit in same candle; no time expiry; unhit TP/SL remains open"
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
  for (let index = 40; index < candles.length - 1; index += step) {
    if (index < nextAvailableIndex) continue;
    const signalWindow = candles.slice(0, index + 1);
    const btcIndex = btcIndexByOpenTime.get(candles[index].openTime);
    if (btcIndex === undefined || btcIndex < 40) continue;
    const btcWindow = btcCandles.slice(0, btcIndex + 1);
    const direction = candles[index].close >= candles[index - 9].close ? "LONG" : "SHORT";
    const signal = evaluateSignalCandidate({
      symbol,
      direction,
      signalType: "trend_pullback",
      candles15m: signalWindow,
      btcCandles15m: btcWindow,
      btcCandles4h: [],
      now: candles[index].closeTime,
      fundingRate: null,
      oiChange15m: null,
      circuitBreakerActive: false
    });

    if (!(signal.level === "A" || signal.level === "S") || signal.lifecycleStatus !== "planned" || !signal.plan) {
      continue;
    }

    const outcome = simulateSignalOutcome(direction, signal.plan, candles.slice(index + 1));
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

function simulateSignalOutcome(direction, plan, futureCandles) {
  const state = applyReviewCandles({
    direction,
    plan,
    candles: futureCandles,
    feeRate: FEE_RATE,
    slippageRate: SLIPPAGE_RATE,
    executionPolicy: DEFAULT_REVIEW_EXECUTION_POLICY
  });
  const completedIndex = state.exitTime === null && state.lastCheckedAt === null
    ? -1
    : futureCandles.findIndex((candle) => candle.closeTime === (state.exitTime ?? state.lastCheckedAt));

  return {
    entryHit: state.entryHit,
    finalStatus: state.finalStatus,
    finalR: state.netR,
    grossR: state.grossR,
    netR: state.netR,
    grossPnlPct: state.grossPnlPct,
    netPnlPct: state.netPnlPct,
    mfe: state.mfe,
    mae: state.mae,
    durationCandles: completedIndex >= 0 ? completedIndex + 1 : futureCandles.length
  };
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
  const settled = items.filter((item) => typeof item.finalR === "number");
  const wins = settled.filter((item) => item.finalR > 0);
  const losses = settled.filter((item) => item.finalR < 0);
  const grossProfit = sum(wins.map((item) => item.finalR));
  const grossLoss = Math.abs(sum(losses.map((item) => item.finalR)));
  return {
    trades: items.length,
    settledTrades: settled.length,
    openTrades: items.filter((item) => item.finalStatus === "open").length,
    waitingEntryTrades: items.filter((item) => item.finalStatus === "waiting_entry").length,
    winRate: pct(wins.length, settled.length),
    entryFillRate: pct(items.filter((item) => item.entryHit).length, items.length),
    avgR: round(avg(settled.map((item) => item.finalR))),
    medianR: round(median(settled.map((item) => item.finalR))),
    totalR: round(sum(settled.map((item) => item.finalR))),
    profitFactor: round(grossLoss === 0 ? grossProfit : grossProfit / grossLoss),
    maxDrawdownR: round(maxDrawdown(settled.map((item) => item.finalR))),
    maxLosingStreak: maxLosingStreak(settled.map((item) => item.finalR)),
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

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
