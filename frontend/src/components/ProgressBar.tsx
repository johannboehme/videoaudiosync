interface ProgressBarProps {
  value: number; // 0..100
  size?: "sm" | "md";
}

export function ProgressBar({ value, size = "md" }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  const h = size === "sm" ? "h-1" : "h-2";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={`${h} bg-ink-700 rounded-full overflow-hidden`}
    >
      <div
        className="h-full bg-accent-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}
