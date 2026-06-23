import type { Candle } from "@/lib/signal/types";

export type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

export function normalizeKline(symbol: string, interval: string, item: BinanceKline, now = Date.now()): Candle {
  return {
    symbol,
    interval,
    openTime: item[0],
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[5]),
    closeTime: item[6],
    quoteVolume: Number(item[7]),
    trades: item[8],
    takerBuyVolume: Number(item[9]),
    takerBuyQuoteVolume: Number(item[10]),
    isClosed: item[6] < now
  };
}

