import { normalizeKline, type BinanceKline } from "@/lib/binance/normalize";

const DEFAULT_BASE_URL = "https://fapi.binance.com";

export async function fetchFuturesKlines(input: { symbol: string; interval: string; limit?: number }) {
  const baseUrl = process.env.BINANCE_FUTURES_BASE_URL || DEFAULT_BASE_URL;
  const url = new URL("/fapi/v1/klines", baseUrl);
  url.searchParams.set("symbol", input.symbol);
  url.searchParams.set("interval", input.interval);
  url.searchParams.set("limit", String(input.limit ?? 120));

  const response = await fetch(url, {
    next: { revalidate: 0 }
  });

  if (!response.ok) {
    throw new Error(`Binance kline request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as BinanceKline[];
  return data.map((item) => normalizeKline(input.symbol, input.interval, item));
}

export function configuredSymbols() {
  const raw = process.env.SIGNAL_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,LINKUSDT,AVAXUSDT,DOGEUSDT";
  return raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

