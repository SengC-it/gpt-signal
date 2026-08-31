/**
 * Public USD-M force-order stream adapter. Historical liquidation REST data is
 * not used; callers may feed forward WebSocket payloads into this parser.
 */
export const BINANCE_LIQUIDATION_STREAM = "wss://fstream.binance.com/ws/!forceOrder@arr";
export const LIQUIDATION_SOURCE_VERSION = "binance-usdm-force-order-stream-v1";

export type ForwardLiquidationEvent = {
  symbol: string;
  side: string | null;
  orderType: string | null;
  price: number;
  quantity: number;
  notional: number;
  eventTime: number;
  sourceTimestamp: number;
  receivedAt: number;
  sourceEndpoint: string;
  sourceVersion: string;
  dataQualityFlags: {
    forwardOnly: true;
    historicalBackfill: false;
    pointInTime: true;
  };
};

export function parseForwardLiquidationEvent(payload: unknown, receivedAt = Date.now()): ForwardLiquidationEvent | null {
  const envelope = asRecord(payload);
  const data = asRecord(envelope.data ?? envelope);
  const order = asRecord(data.o ?? data);
  const symbol = stringValue(order.s ?? order.symbol);
  const price = numberValue(order.ap ?? order.p ?? order.price);
  const quantity = numberValue(order.z ?? order.q ?? order.quantity);
  const eventTime = numberValue(order.T ?? order.updateTime ?? data.E ?? data.eventTime ?? envelope.E ?? envelope.eventTime);
  if (!symbol || price === null || quantity === null || eventTime === null || price < 0 || quantity < 0) return null;
  return {
    symbol,
    side: stringValue(order.S ?? order.side),
    orderType: stringValue(order.o ?? order.orderType),
    price,
    quantity,
    notional: price * quantity,
    eventTime,
    sourceTimestamp: eventTime,
    receivedAt,
    sourceEndpoint: BINANCE_LIQUIDATION_STREAM,
    sourceVersion: LIQUIDATION_SOURCE_VERSION,
    dataQualityFlags: { forwardOnly: true, historicalBackfill: false, pointInTime: true }
  };
}

export function forwardLiquidationCollectorStatus() {
  return {
    adapterImplemented: true,
    runtimeCollectorEnabled: false,
    enabled: false,
    mode: "forward_only" as const,
    stream: BINANCE_LIQUIDATION_STREAM,
    historicalBackfill: false,
    backtestSafe: false,
    status: "FORWARD_COLLECTOR_NOT_DEPLOYED" as const
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringValue(value: unknown) { return typeof value === "string" && value.length ? value : null; }
function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
