// Keeps Apple Health in sync on the iPhone: when the app opens or comes back to the foreground (at most every
// 30 minutes), it re-reads the days since the last sync plus a couple before, since late watch data fills them in.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { connectAppleHealth, healthSupported, readDays } from "./health";

const MIN_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_SYNC_DAYS = 90;

export function useHealthSync() {
  const status = useQuery(api.health.status);
  const sync = useMutation(api.health.sync);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const run = useCallback(
    async (days: number) => {
      if (busy.current) return;
      busy.current = true;
      setSyncing(true);
      setError(null);
      try {
        await sync({ days: await readDays(days) });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        busy.current = false;
        setSyncing(false);
      }
    },
    [sync],
  );

  const connected = status?.connected === true;
  const syncedAt = status?.connected ? status.syncedAt : 0;
  const latestDate = status?.connected ? status.latestDate : null;

  useEffect(() => {
    if (!healthSupported || !connected) return;
    const maybeSync = () => {
      if (Date.now() - syncedAt < MIN_INTERVAL_MS) return;
      const since = latestDate ? Math.ceil((Date.now() - Date.parse(`${latestDate}T00:00:00`)) / 86_400_000) : FIRST_SYNC_DAYS;
      void run(Math.min(FIRST_SYNC_DAYS, Math.max(3, since + 2)));
    };
    maybeSync();
    const sub = AppState.addEventListener("change", (state) => state === "active" && maybeSync());
    return () => sub.remove();
  }, [connected, syncedAt, latestDate, run]);

  const connect = useCallback(async () => {
    try {
      await connectAppleHealth();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    await run(FIRST_SYNC_DAYS);
  }, [run]);

  return { status, supported: healthSupported, syncing, error, connect, syncNow: () => run(14) };
}

export type HealthSync = ReturnType<typeof useHealthSync>;
