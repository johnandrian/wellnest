// The current time, refreshed every `stepMs` (a minute by default) and rounded down to it, so screens that show "now"
// (the greeting, the next dose, what's overdue) keep up while they stay open, without re-rendering every second.
import { useEffect, useState } from "react";

export function useNow(stepMs = 60_000) {
  const round = () => Math.floor(Date.now() / stepMs) * stepMs;
  const [now, setNow] = useState(round);
  useEffect(() => {
    const id = setInterval(() => setNow(round()), Math.min(stepMs, 60_000));
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}
