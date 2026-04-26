import { MouseEvent, TouchEvent } from "react";
import { Segment } from "../api";

interface Props {
  peaks: [number, number][];
  duration: number;
  currentTime?: number;
  segments?: Segment[];
  onSeek?: (t: number) => void;
  height?: number;
}

const VBOX_W = 1000;

export function Waveform({
  peaks,
  duration,
  currentTime = 0,
  segments,
  onSeek,
  height = 60,
}: Props) {
  const bucketW = peaks.length > 0 ? VBOX_W / peaks.length : VBOX_W;
  const cy = height / 2;

  function locate(clientX: number, target: SVGElement): number {
    const rect = target.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(duration, (x / rect.width) * duration));
  }

  function handleClick(e: MouseEvent<SVGSVGElement>) {
    if (!onSeek) return;
    onSeek(locate(e.clientX, e.currentTarget));
  }

  function handleTouchStart(e: TouchEvent<SVGSVGElement>) {
    if (!onSeek || e.touches.length !== 1) return;
    onSeek(locate(e.touches[0].clientX, e.currentTarget));
  }

  return (
    <svg
      viewBox={`0 0 ${VBOX_W} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      className="block touch-none select-none"
    >
      {/* segments shading */}
      {segments?.map((s, i) => {
        const x1 = (s.in / duration) * VBOX_W;
        const x2 = (s.out / duration) * VBOX_W;
        return (
          <rect
            key={i}
            data-testid={`segment-${i}`}
            x={x1}
            y={0}
            width={Math.max(0, x2 - x1)}
            height={height}
            fill="rgba(56,189,248,0.15)"
          />
        );
      })}
      {/* peaks: render as min..max bar per bucket */}
      {peaks.map(([min, max], i) => {
        const x = i * bucketW;
        const top = cy - (Math.abs(max) * height) / 2;
        const bot = cy + (Math.abs(min) * height) / 2;
        return (
          <rect
            key={i}
            x={x + bucketW * 0.1}
            y={top}
            width={bucketW * 0.8}
            height={Math.max(1, bot - top)}
            fill="#9aa0b4"
          />
        );
      })}
      {/* playhead */}
      <rect
        data-testid="playhead"
        x={(currentTime / Math.max(0.001, duration)) * VBOX_W - 1}
        y={0}
        width={2}
        height={height}
        fill="#38bdf8"
      />
    </svg>
  );
}
