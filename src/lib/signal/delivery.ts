import type { DeliveryMode } from "./types.ts";

export function canSendNotifications(deliveryMode: DeliveryMode) {
  return deliveryMode === "production";
}
