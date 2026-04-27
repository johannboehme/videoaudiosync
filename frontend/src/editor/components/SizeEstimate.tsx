// One-line summary of what the user is about to export: estimated size,
// duration, and the codec/format combo. Lives directly under the Quality
// slider so the slider's effect is visible immediately.
import { MonoReadout } from "./MonoReadout";

function formatDuration(s: number): string {
  if (!isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

interface Props {
  bytes: number;
  durationS: number;
  format: string;
  videoCodec: string;
  audioCodec: string;
}

export function SizeEstimate({ bytes, durationS, format, videoCodec, audioCodec }: Props) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <MonoReadout
        label="≈ SIZE"
        value={formatBytes(bytes)}
        tone="hot"
        size="sm"
        align="center"
      />
      <MonoReadout
        label="DURATION"
        value={formatDuration(durationS)}
        size="sm"
        align="center"
      />
      <MonoReadout
        label="STACK"
        value={`${format.toUpperCase()} / ${videoCodec.toUpperCase()} / ${audioCodec.toUpperCase()}`}
        size="sm"
        align="center"
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
