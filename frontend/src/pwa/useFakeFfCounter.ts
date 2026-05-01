import { useEffect, useState } from "react";

const TICK_MS = 100;

export function formatVcrTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00";
  const total = Math.floor(seconds);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

export function useFakeFfCounter(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const id = setInterval(() => setSeconds((s) => s + 1), TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  return seconds;
}
