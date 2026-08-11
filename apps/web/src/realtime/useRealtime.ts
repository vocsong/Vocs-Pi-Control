import { RealtimeClient } from "./client";
import { usePiControl } from "../store";

/**
 * Module-level singleton realtime client wired to the zustand store.
 * Components access it via useRealtime() so commands and event flow share
 * one connection (plan §25: one browser WebSocket).
 */

let client: RealtimeClient | null = null;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function getRealtime(): RealtimeClient {
  if (!client) {
    client = new RealtimeClient(wsUrl(), {
      onStatus: (status) => usePiControl.getState().setConnection(status),
      onEvent: (envelope) => usePiControl.getState().apply(envelope),
    });
  }
  return client;
}

export function useRealtime(): RealtimeClient {
  return getRealtime();
}
