import { useRegisterSW } from "virtual:pwa-register/react";
import { formatVcrTime, useFakeFfCounter } from "./useFakeFfCounter";
import { useInstallProgress } from "./useInstallProgress";

const APPROX_BUNDLE_SIZE = "~62 MB";

export function InstallProgressOverlay() {
  const {
    offlineReady: [offlineReady],
  } = useRegisterSW({});

  // Dev mode never registers a SW (vite.config.ts: devOptions.enabled =
  // false), so `offlineReady` would never flip — without disabling here
  // the overlay would gate the UI forever on every dev visit. Prod also
  // gets a hard timeout inside the hook so a stuck install can't trap
  // users either.
  const { visible, slowMode } = useInstallProgress(offlineReady, {
    disabled: import.meta.env.DEV,
  });
  const counter = useFakeFfCounter(visible);
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Installing TK-1 for offline use"
      className="fixed inset-0 z-[1000] paper-bg flex items-center justify-center px-6"
    >
      <div className="w-full max-w-md bg-paper-hi rounded-2xl shadow-panel border border-rule overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-rule">
          <span className="label block">First Install</span>
          <span className="font-display text-[15px] font-semibold text-ink leading-tight block">
            Installing TK-1
          </span>
        </div>

        <VcrPanel counter={counter} />

        <div className="px-6 py-4 space-y-2">
          <p className="text-[13px] leading-snug text-ink-2">
            Spooling {APPROX_BUNDLE_SIZE} of render engine ahead — once done,
            the app opens instantly on next launch, even offline.
          </p>
          {slowMode && (
            <p className="text-[12px] leading-snug text-ink-2 border-l-2 border-warn pl-3">
              If this hangs: reload the page — the app also works without an
              offline cache.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function VcrPanel({ counter }: { counter: number }) {
  return (
    <div className="mx-6 my-4 p-4 bg-sunken rounded-md shadow-lcd">
      <div className="flex items-center gap-3">
        <TapeWindow />
        <VfdReadout counter={counter} />
      </div>
      <LedRow />
    </div>
  );
}

function TapeWindow() {
  return (
    <div className="relative shrink-0 w-[120px] h-[44px] rounded-sm bg-[#0A0908] border border-[#3A352E] shadow-[inset_0_1px_2px_rgba(0,0,0,0.7)] overflow-hidden">
      {/* Magnetic tape strip running between the reels */}
      <div
        aria-hidden
        className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-[6px] rounded-[1px]"
        style={{
          background:
            "linear-gradient(180deg, #3A2F22 0%, #5C4836 50%, #3A2F22 100%)",
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 6px, rgba(255,255,255,0.18) 6px 7px), linear-gradient(180deg, #3A2F22 0%, #5C4836 50%, #3A2F22 100%)",
          backgroundBlendMode: "screen, normal",
          animation: "vcr-tape-scroll 0.6s linear infinite",
        }}
      />
      <Reel className="absolute left-1.5 top-1/2 -translate-y-1/2" direction="ccw" />
      <Reel className="absolute right-1.5 top-1/2 -translate-y-1/2" direction="cw" />
    </div>
  );
}

function Reel({
  className,
  direction,
}: {
  className?: string;
  direction: "cw" | "ccw";
}) {
  const animation =
    direction === "cw"
      ? "vcr-reel-spin-cw 0.4s linear infinite"
      : "vcr-reel-spin-ccw 0.4s linear infinite";
  return (
    <svg
      aria-hidden
      width="32"
      height="32"
      viewBox="0 0 24 24"
      className={className}
    >
      <defs>
        <radialGradient id={`reel-gradient-${direction}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2A2722" />
          <stop offset="60%" stopColor="#1A1816" />
          <stop offset="100%" stopColor="#0A0908" />
        </radialGradient>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="11"
        fill={`url(#reel-gradient-${direction})`}
        stroke="#3A352E"
        strokeWidth="0.5"
      />
      <g
        style={{
          transformOrigin: "12px 12px",
          animation,
        }}
      >
        {/* 6 spokes via 3 lines × 60° rotations */}
        <line x1="12" y1="3" x2="12" y2="21" stroke="#5C544A" strokeWidth="0.7" />
        <line
          x1="12"
          y1="3"
          x2="12"
          y2="21"
          stroke="#5C544A"
          strokeWidth="0.7"
          transform="rotate(60 12 12)"
        />
        <line
          x1="12"
          y1="3"
          x2="12"
          y2="21"
          stroke="#5C544A"
          strokeWidth="0.7"
          transform="rotate(120 12 12)"
        />
        <circle cx="12" cy="12" r="2.5" fill="#0A0908" stroke="#3A352E" strokeWidth="0.5" />
        <circle cx="12" cy="12" r="0.8" fill="#5C544A" />
      </g>
    </svg>
  );
}

function VfdReadout({ counter }: { counter: number }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-2">
        <span
          className="font-mono text-hot text-[13px] leading-none"
          style={{
            textShadow:
              "0 0 4px rgba(255,87,34,0.6), 0 0 10px rgba(255,87,34,0.35)",
            animation: "vas-fx-live-pulse 1.0s ease-in-out infinite",
          }}
          aria-hidden
        >
          ▶▶
        </span>
        <span
          className="font-mono text-hot text-[18px] leading-none tabular tracking-wide"
          style={{
            textShadow:
              "0 0 4px rgba(255,87,34,0.6), 0 0 10px rgba(255,87,34,0.35)",
          }}
        >
          {formatVcrTime(counter)}
        </span>
      </div>
      <div className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-hot/70">
        FF · Offline
      </div>
    </div>
  );
}

function LedRow() {
  const leds: { label: string; lit: boolean }[] = [
    { label: "Rec", lit: false },
    { label: "Play", lit: false },
    { label: "FF", lit: true },
    { label: "Rew", lit: false },
  ];
  return (
    <div className="mt-3 flex items-center justify-around">
      {leds.map(({ label, lit }) => (
        <div key={label} className="flex flex-col items-center gap-1">
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full"
            style={
              lit
                ? {
                    backgroundColor: "#FF5722",
                    animation: "vcr-ff-led 1.0s ease-in-out infinite",
                  }
                : {
                    backgroundColor: "#3A352E",
                    boxShadow: "inset 0 1px 1px rgba(0,0,0,0.6)",
                  }
            }
          />
          <span
            className={`font-mono text-[8px] tracking-[0.25em] uppercase ${
              lit ? "text-hot" : "text-ink-2/40"
            }`}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
