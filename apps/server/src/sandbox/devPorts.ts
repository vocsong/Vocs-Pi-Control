/**
 * Dev-port range math shared by the sandbox manager and routes.
 *
 * Containers always listen on DEV_PORT_RANGE.containerStart..+count (the
 * documented listener range); the HOST side shifts by a per-sandbox slot
 * so concurrent sandboxes never collide on loopback (issue #10).
 */

export const DEV_PORT_RANGE = { hostStart: 43100, containerStart: 43100, count: 20 };
export const DEV_PORT_SLOTS = 10;

export interface DevPortRange {
  hostStart: number;
  containerStart: number;
  count: number;
}

export function devRangeForSlot(slot: number): DevPortRange {
  return {
    hostStart: DEV_PORT_RANGE.hostStart + slot * DEV_PORT_RANGE.count,
    containerStart: DEV_PORT_RANGE.containerStart,
    count: DEV_PORT_RANGE.count,
  };
}

/** Slot for a host-side start port; legacy/missing values fall back to 0. */
export function slotForDevHostStart(hostStart: number | undefined): number {
  if (typeof hostStart !== "number" || !Number.isFinite(hostStart)) return 0;
  const slot = Math.round((hostStart - DEV_PORT_RANGE.hostStart) / DEV_PORT_RANGE.count);
  return slot >= 0 && slot < DEV_PORT_SLOTS ? slot : 0;
}
