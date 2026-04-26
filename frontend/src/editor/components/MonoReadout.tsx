// LCD-style numerical display: dark sunken panel, tabular monospace digits.
import { ReactNode } from "react";

type Tone = "default" | "hot" | "cobalt" | "muted";

interface Props {
  value: ReactNode;
  label?: string;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  align?: "left" | "right" | "center";
  className?: string;
}

const TONE_FG: Record<Tone, string> = {
  default: "text-paper-hi",
  hot: "text-hot",
  cobalt: "text-cobalt-soft",
  muted: "text-ink-3",
};

const SIZE: Record<NonNullable<Props["size"]>, string> = {
  sm: "text-xs px-2 py-1 rounded-sm",
  md: "text-base px-3 py-1.5 rounded-md",
  lg: "text-2xl px-4 py-2 rounded-md",
};

export function MonoReadout({
  value,
  label,
  tone = "default",
  size = "md",
  align = "left",
  className = "",
}: Props) {
  const alignCls =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <div className={`inline-flex flex-col gap-1 ${className}`}>
      {label && <span className="label">{label}</span>}
      <div
        className={[
          "bg-sunken text-paper-hi shadow-lcd font-mono tabular tracking-tight",
          TONE_FG[tone],
          SIZE[size],
          alignCls,
        ].join(" ")}
        style={{ minHeight: 28 }}
      >
        {value}
      </div>
    </div>
  );
}

export function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m.toString().padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
}

export function formatMs(ms: number, withSign = true): string {
  const sign = ms > 0 ? "+" : ms < 0 ? "−" : " ";
  const abs = Math.abs(ms);
  const fixed = abs >= 100 ? abs.toFixed(0) : abs.toFixed(1);
  return `${withSign ? sign : ""}${fixed} ms`;
}
