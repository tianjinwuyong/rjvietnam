/**
 * useShelfStream — React hook for real-time shelf SSE stream
 *
 * Connects to GET /api/shelf/stream and calls onUpdate(snapshot) each time
 * SQL Server data changes (polled every 5 s by the server).
 *
 * Returns { snapshot, connected, error }
 * snapshot = { cells[], labels[], shelves[], ts } | null
 */
import { useEffect, useRef, useState } from "react";
import { SHELF_API_BASE } from "./shelf-api";

export interface ShelfSnapshot {
  cells: Array<{
    binCode: string;
    area: number | null;
    colu: number;       // 1-20
    layer: number;      // 1-35
    used: number;       // 3=occupied, 0=empty
    occupied: boolean;
    serialNumber: string | null;
    materialCode: string | null;
    isLock: number;
    sideCode: string;   // "L001A".."L002B"
  }>;
  labels: Array<{
    ShelfCode: string; SerialNumber: string; Status: number;
  }>;
  shelves: Array<{
    code: string;
    totalCells: number;
    occupiedCells: number;
    labelCount: number;
  }>;
  ts: string;
}

export function useShelfStream(pollMs = 5000) {
  const [snapshot, setSnapshot] = useState<ShelfSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `${SHELF_API_BASE}/api/shelf/stream?poll=${pollMs}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => { setConnected(true); setError(null); };
    es.onerror = () => { setConnected(false); setError("SSE connection lost"); };

    es.onmessage = (e: MessageEvent) => {
      try {
        const data: ShelfSnapshot = JSON.parse(e.data);
        setSnapshot(data);
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [pollMs]);

  return { snapshot, connected, error };
}
