import { useRegisterSW } from "virtual:pwa-register/react";
import { useInstallProgress } from "./useInstallProgress";

const APPROX_BUNDLE_SIZE = "~62 MB";

export function InstallProgressOverlay() {
  const {
    offlineReady: [offlineReady],
  } = useRegisterSW({});

  const { visible, slowMode } = useInstallProgress(offlineReady);
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Installing TK-1 for offline use"
      className="fixed inset-0 z-[1000] paper-bg flex items-center justify-center px-6"
    >
      <div className="w-full max-w-md bg-paper-hi rounded-2xl shadow-panel border border-rule overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-rule flex items-center gap-3">
          <RotatingCrosshair />
          <div className="flex-1 min-w-0">
            <span className="label block">First Install</span>
            <span className="font-display text-[15px] font-semibold text-ink leading-tight block truncate">
              Installiere TK-1
            </span>
          </div>
        </div>

        <LcdReadout />

        <div className="px-6 py-4 space-y-2">
          <p className="text-[13px] leading-snug text-ink-2">
            Lädt {APPROX_BUNDLE_SIZE} Render-Engine herunter, damit die App
            beim nächsten Start sofort öffnet — auch ohne Internet.
          </p>
          {slowMode && (
            <p className="text-[12px] leading-snug text-ink-2 border-l-2 border-warn pl-3">
              Falls das hängt: Seite neu laden — die App funktioniert auch
              ohne Offline-Cache.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LcdReadout() {
  return (
    <div className="mx-6 my-4 px-4 py-3 bg-sunken rounded-md shadow-lcd font-mono text-[11px] leading-relaxed text-hot tabular tracking-wide">
      <div className="flex items-center gap-2">
        <BlinkingDot />
        <span>TK-1 — TAKE ONE</span>
      </div>
      <div className="text-hot/70">OFFLINE-READY VERSION</div>
      <div className="flex justify-between">
        <span>{APPROX_BUNDLE_SIZE}</span>
        <span>FIRST INSTALL ONLY</span>
      </div>
    </div>
  );
}

function BlinkingDot() {
  return (
    <span
      aria-hidden
      className="inline-block w-2 h-2 rounded-full bg-hot"
      style={{ animation: "vas-fx-live-pulse 1.2s ease-in-out infinite" }}
    />
  );
}

function RotatingCrosshair() {
  // Recycles the favicon's geometry: outer ring + crosshair + hot dot.
  // The crosshair group rotates slowly so the user sees motion even
  // though Workbox can't report real precache progress.
  return (
    <svg
      aria-hidden
      width="36"
      height="36"
      viewBox="0 0 16 16"
      className="shrink-0"
    >
      <rect width="16" height="16" rx="4" fill="#FAF6EC" />
      <g
        fill="none"
        stroke="#1A1816"
        strokeWidth="1"
        style={{
          transformOrigin: "8px 8px",
          animation: "vas-install-spin 2.4s linear infinite",
        }}
      >
        <line x1="0.5" y1="8" x2="15.5" y2="8" />
        <line x1="8" y1="0.5" x2="8" y2="15.5" />
      </g>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="#1A1816" strokeWidth="1" />
      <circle
        cx="8"
        cy="8"
        r="3"
        fill="#FF5722"
        style={{ animation: "vas-fx-live-pulse 1.6s ease-in-out infinite" }}
      />
    </svg>
  );
}
