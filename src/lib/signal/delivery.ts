import type { DeliveryMode } from "./types.ts";
import { PRODUCTION_SIGNAL_STRATEGIES } from "./profitability-config.ts";

export function canSendNotifications(deliveryMode: DeliveryMode) {
  return deliveryMode === "production";
}

/**
 * Runtime send permission is stricter than the historical delivery_mode field.
 * An old production row is auditable data, not an enabled current strategy.
 */
export function canSendRuntimeNotification(input: {
  deliveryMode: DeliveryMode;
  strategyVersion?: string | null;
}) {
  return canSendNotifications(input.deliveryMode)
    && Boolean(input.strategyVersion)
    && PRODUCTION_SIGNAL_STRATEGIES.includes(input.strategyVersion!);
}
