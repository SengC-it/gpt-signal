import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"];
const INTERVAL_MS = 15 * 60 * 1000;
const LOOKBACK_DAYS = Number(process.env.PROFITABILITY_002_LOOKBACK_DAYS || 478);
const END_TIME = Number(process.env.PROFITABILITY_002_END_TIME || Date.now());
const START_TIME = Number(process.env.PROFITABILITY_002_START_TIME || END_TIME - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
const BASE_URL = process.env.BINANCE_FUTURES_BASE_URL || "https://fapi.binance.com";
const CACHE_KEY = process.env.PROFITABILITY_002_CACHE_KEY || "profit-002-latest";
const CACHE_DIR = path.join(process.cwd(), ".cache", "historical-backtest", CACHE_KEY);
const SOURCE_DIR = path.join(process.cwd(), ".cache", "historical-backtest", "450d");
const REPORT_DIR = path.join(process.cwd(), "reports");
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(REPORT_DIR, { recursive: true });

for (const symbol of SYMBOLS) {
  const candles = await loadAndUpdate(symbol);
  const cachePath = path.join(CACHE_DIR, `${symbol}-15m.json`);
  fs.writeFileSync(cachePath, JSON.stringify(candles));
  process.stderr.write(`${symbol}: ${candles.length} closed candles through ${new Date(candles.at(-1)?.closeTime ?? 0).toISOString()}\n`);
}

const manifest = buildManifest();
fs.writeFileSync(path.join(REPORT_DIR, "GPT-PROFIT-002-DATA-MANIFEST.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));

async function loadAndUpdate(symbol) {
  const targetPath = path.join(CACHE_DIR, `${symbol}-15m.json`);
  const sourcePath = path.join(SOURCE_DIR, `${symbol}-15m.json`);
  const existing = readCandles(targetPath) || readCandles(sourcePath) || [];
  const start = Math.max(
    START_TIME,
    existing.length ? existing.at(-1).openTime + INTERVAL_MS : START_TIME
  );
  const fetched = start < END_TIME ? await fetchKlines(symbol, start, END_TIME) : [];
  const merged = dedupe([...existing, ...fetched])
    .filter((candle) => candle.openTime >= START_TIME && candle.closeTime <= END_TIME && candle.closeTime <= Date.now());
  if (merged.length < 100) throw new Error(`Insufficient ${symbol} candles: ${merged.length}`);
  return merged;
}

function readCandles(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(value) ? value.map((item) => normalizeStored(item)).filter(Boolean) : null;
  } catch {
    return null;
  }
}

async function fetchKlines(symbol, startTime, endTime) {
  const candles = [];
  let cursor = startTime;
  let emptyResponses = 0;
  while (cursor < endTime) {
    const url = new URL("/fapi/v1/klines", BASE_URL);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "15m");
    url.searchParams.set("limit", "1500");
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endTime));
    const data = await requestJson(url.toString());
    if (!Array.isArray(data) || data.length === 0) {
      emptyResponses += 1;
      if (emptyResponses > 3) break;
      cursor += INTERVAL_MS * 1500;
      continue;
    }
    emptyResponses = 0;
    candles.push(...data.map((item) => normalizeKline(symbol, item)));
    const lastOpen = Number(data.at(-1)[0]);
    if (!Number.isFinite(lastOpen) || lastOpen < cursor) throw new Error(`Non-advancing Binance response for ${symbol}`);
    cursor = lastOpen + INTERVAL_MS;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return candles;
}

async function requestJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const result = spawnSync("curl.exe", [
      "-L", "--fail", "--silent", "--show-error", "--max-time", "30", url
    ], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    if (result.status === 0) {
      try {
        return JSON.parse(result.stdout);
      } catch (error) {
        lastError = error;
      }
    } else {
      lastError = new Error(result.stderr || `curl exited ${result.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  throw lastError;
}

function normalizeKline(symbol, item) {
  return {
    symbol,
    interval: "15m",
    openTime: Number(item[0]),
    closeTime: Number(item[6]),
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[5]),
    quoteVolume: Number(item[7]),
    trades: Number(item[8]),
    takerBuyVolume: Number(item[9]),
    takerBuyQuoteVolume: Number(item[10]),
    isClosed: Number(item[6]) <= Date.now()
  };
}

function normalizeStored(item) {
  if (!Number.isFinite(Number(item?.openTime)) || !Number.isFinite(Number(item?.closeTime))) return null;
  return {
    ...item,
    openTime: Number(item.openTime),
    closeTime: Number(item.closeTime),
    open: Number(item.open),
    high: Number(item.high),
    low: Number(item.low),
    close: Number(item.close),
    volume: Number(item.volume),
    quoteVolume: Number(item.quoteVolume),
    isClosed: Number(item.closeTime) <= Date.now()
  };
}

function dedupe(candles) {
  return [...new Map(candles.map((item) => [item.openTime, item])).values()]
    .sort((a, b) => a.openTime - b.openTime);
}

function buildManifest() {
  const symbols = Object.fromEntries(SYMBOLS.map((symbol) => {
    const filePath = path.join(CACHE_DIR, `${symbol}-15m.json`);
    const candles = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const times = candles.map((candle) => candle.openTime);
    const uniqueTimes = new Set(times);
    const gaps = [];
    for (let index = 1; index < times.length; index += 1) {
      if (times[index] - times[index - 1] !== INTERVAL_MS) gaps.push({ from: times[index - 1], to: times[index] });
    }
    return [symbol, {
      file: path.relative(process.cwd(), filePath).replaceAll("\\", "/"),
      contentSha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
      barCount: candles.length,
      duplicateCount: times.length - uniqueTimes.size,
      gapCount: gaps.length,
      gaps: gaps.slice(0, 20),
      firstOpenTime: new Date(candles[0].openTime).toISOString(),
      lastOpenTime: new Date(candles.at(-1).openTime).toISOString(),
      lastCloseTime: new Date(candles.at(-1).closeTime).toISOString()
    }];
  }));
  return {
    generatedAt: new Date().toISOString(),
    source: "public Binance USDⓈ-M Futures /fapi/v1/klines",
    interval: "15m",
    startTime: new Date(START_TIME).toISOString(),
    requestedEndTime: new Date(END_TIME).toISOString(),
    latestClosedCandleAt: new Date(Math.min(...SYMBOLS.map((symbol) => Date.parse(symbols[symbol].lastCloseTime)))).toISOString(),
    discoveryCutoff: "2026-08-02T03:15:00.000Z",
    holdoutDefinition: "closed candles strictly after discoveryCutoff; never used for candidate selection",
    symbols
  };
}
