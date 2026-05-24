import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus, WsSnapshotFrame, WsTickFrame } from "@/contracts/types/snapshot";
import { WSClient, type WsKind } from "./WSClient";

interface UseWsOptions {
  symbol: string;
  kind?: WsKind;
  enabled?: boolean;
}

/**
 * React hook around WSClient. One instance per (symbol, kind) pair.
 * The hook owns the lifecycle so an unmounted component can't leak a
 * live socket — it always closes on cleanup.
 *
 * Snapshot / tick frames are pushed into refs, not state, to avoid a
 * 60Hz re-render storm during volatile sessions. Consumers select
 * specific slices via subscribe().
 */
export function useWsStream({ symbol, kind = "snapshot", enabled = true }: UseWsOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("closed");
  const lastSnapshotRef = useRef<WsSnapshotFrame | null>(null);
  const lastTickRef = useRef<WsTickFrame | null>(null);
  const clientRef = useRef<WSClient | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const client = new WSClient({ symbol, kind });
    clientRef.current = client;

    const offStatus = client.on({ type: "status", handler: setStatus });
    const offSnap = client.on({
      type: "snapshot",
      handler: (frame) => {
        lastSnapshotRef.current = frame;
      },
    });
    const offTick = client.on({
      type: "tick",
      handler: (frame) => {
        lastTickRef.current = frame;
      },
    });

    client.connect();

    return () => {
      offStatus();
      offSnap();
      offTick();
      client.close();
      clientRef.current = null;
    };
  }, [symbol, kind, enabled]);

  return {
    status,
    client: clientRef,
    getLastSnapshot: () => lastSnapshotRef.current,
    getLastTick: () => lastTickRef.current,
  };
}
