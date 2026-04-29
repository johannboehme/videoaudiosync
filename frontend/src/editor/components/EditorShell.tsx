// Top-level editor layout. Desktop = grid; tablet/mobile = video + bottom sheet.
import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChunkyButton } from "./ChunkyButton";
import { ChevronLeftIcon, DownloadIcon } from "./icons";
import { BottomSheet } from "./BottomSheet";

const SIDE_PANEL_COLLAPSE_KEY = "editor.sidepanel.collapsed";
const EXPANDED_W = 380;

function readCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SIDE_PANEL_COLLAPSE_KEY) === "1";
}

interface Props {
  jobTitle: string;
  jobId: string;
  videoArea: ReactNode;
  /** Optional FX hardware-pad panel between video and transport. Slides
   *  out on click on desktop; always-open on mobile. Caller (`Editor.tsx`)
   *  is the source of truth for what to mount. */
  fxPanel?: ReactNode;
  transport: ReactNode;
  timeline: ReactNode;
  sidePanel: ReactNode;
  onSubmit: () => void;
  submitting: boolean;
}

export function EditorShell({
  jobTitle,
  jobId,
  videoArea,
  fxPanel,
  transport,
  timeline,
  sidePanel,
  onSubmit,
  submitting,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(readCollapsed);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SIDE_PANEL_COLLAPSE_KEY, sideCollapsed ? "1" : "0");
  }, [sideCollapsed]);

  return (
    <div className="flex flex-col h-screen overflow-hidden paper-bg">
      <TopBar
        title={jobTitle}
        jobId={jobId}
        onSubmit={onSubmit}
        submitting={submitting}
      />

      {/* Desktop layout (lg+). When collapsed the side column is 0 px so
       *  the timeline and preview claim every available pixel; the
       *  expand-handle floats over the right edge as a small grab tab.
       *  No overflow-hidden here — the handle uses negative `right`
       *  to escape the px-3 padding and sit flush against the screen
       *  edge when collapsed. */}
      <div
        className="relative flex-1 hidden lg:grid gap-3 px-3 pb-3 min-h-0 transition-[grid-template-columns] duration-200 ease-out"
        style={{
          gridTemplateColumns: sideCollapsed
            ? `1fr 0px`
            : `1fr ${EXPANDED_W}px`,
        }}
      >
        <div className="flex flex-col gap-3 min-w-0 min-h-0">
          <div className="relative flex-1 min-h-0 rounded-lg border border-rule shadow-panel bg-sunken overflow-hidden">
            <div className="absolute inset-0">{videoArea}</div>
          </div>
          {fxPanel && (
            <div className="shrink-0 rounded-lg overflow-hidden border border-rule shadow-panel">
              {fxPanel}
            </div>
          )}
          <div className="shrink-0 bg-paper-hi rounded-lg border border-rule shadow-panel p-3">
            {transport}
          </div>
          <div className="shrink-0 bg-paper-hi rounded-lg border border-rule shadow-panel p-3">
            {timeline}
          </div>
        </div>
        <div
          className={[
            "relative min-h-0 overflow-hidden",
            sideCollapsed ? "pointer-events-none" : "",
          ].join(" ")}
          aria-hidden={sideCollapsed}
        >
          <div
            className="h-full overflow-hidden transition-opacity duration-150"
            style={{ opacity: sideCollapsed ? 0 : 1 }}
          >
            {sidePanel}
          </div>
        </div>

        {/* Expand/collapse handle. Floats outside the grid columns so it
         *  doesn't reserve any layout space — pinned to the right edge
         *  of the editor content, vertically centered. Slides with the
         *  panel when expanded so it always sits *just* outside the
         *  panel's left edge. */}
        <PanelHandle
          collapsed={sideCollapsed}
          onToggle={() => setSideCollapsed((c) => !c)}
        />
      </div>

      {/* Tablet / mobile layout */}
      <div className="flex-1 lg:hidden flex flex-col gap-3 px-3 pb-3 overflow-hidden min-h-0">
        <div className="relative aspect-video shrink-0 bg-sunken rounded-lg border border-rule shadow-panel overflow-hidden">
          <div className="absolute inset-0">{videoArea}</div>
        </div>
        {fxPanel && (
          <div className="shrink-0 rounded-lg overflow-hidden border border-rule shadow-panel">
            {fxPanel}
          </div>
        )}
        <div className="shrink-0 bg-paper-hi rounded-lg border border-rule shadow-panel p-3">
          {transport}
        </div>
        <div className="shrink-0 bg-paper-hi rounded-lg border border-rule shadow-panel p-3">
          {timeline}
        </div>
        <ChunkyButton variant="primary" size="lg" fullWidth onClick={() => setSheetOpen(true)}>
          OPEN PANELS
        </ChunkyButton>
        <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <div className="h-full p-3">{sidePanel}</div>
        </BottomSheet>
      </div>
    </div>
  );
}

/**
 * PanelHandle — anodized-aluminum drawer pull recessed into the editor's
 * right edge. Toggles the side panel; sits flush at screen-edge when
 * collapsed, flush at panel-edge when expanded. TE-language: brushed
 * metal body, knurled center grip, etched direction chevron, no LEDs.
 */
function PanelHandle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Outer grid has px-3 (12) + gap-3 (12). `right: 0` puts the handle's
  // right edge at the grid's outer right edge = the screen edge → flush.
  // Expanded: panel takes the right column (EXPANDED_W) plus the gap-3
  // between columns, so the handle's right edge sits exactly at the
  // panel's left edge.
  const rightPx = collapsed ? 0 : EXPANDED_W + 12;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Show side panel" : "Hide side panel"}
      title={collapsed ? "Show panel" : "Hide panel"}
      className={[
        "group absolute top-1/2 -translate-y-1/2 z-20",
        "w-3 h-10 rounded-l-md cursor-pointer",
        "transition-[right,filter] duration-200 ease-out",
        "hover:brightness-[1.05]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hot/40",
      ].join(" ")}
      style={{ right: rightPx, ...ALUMINUM_BODY }}
    >
      {/* Knurled grip — repeating 1 px stripes read as machined ridges. */}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-4 rounded-[1px]"
        style={KNURLED_GRIP}
      />

      {/* Tiny etched direction chevron, painted on the metal. */}
      <span
        aria-hidden
        className="absolute top-[2px] left-0 right-0 text-center font-display leading-none"
        style={{
          fontSize: 8,
          color: "rgba(26,24,22,0.55)",
          textShadow: "0 0.5px 0 rgba(255,255,255,0.55)",
        }}
      >
        {collapsed ? "‹" : "›"}
      </span>
    </button>
  );
}

const ALUMINUM_BODY: React.CSSProperties = {
  background:
    "linear-gradient(180deg, #E8E1D0 0%, #D5CAA8 52%, #C9BFA6 100%)",
  border: "1px solid rgba(26,24,22,0.22)",
  borderRight: "none",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.55)",
    "inset 0 -1px 0 rgba(0,0,0,0.10)",
    "-1px 1px 3px rgba(0,0,0,0.10)",
  ].join(", "),
};

const KNURLED_GRIP: React.CSSProperties = {
  background:
    "repeating-linear-gradient(0deg, rgba(26,24,22,0.22) 0px, rgba(26,24,22,0.22) 1px, rgba(255,255,255,0.55) 1px, rgba(255,255,255,0.55) 2px, transparent 2px, transparent 3px)",
  boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.06)",
};

function TopBar({
  title,
  jobId,
  onSubmit,
  submitting,
}: {
  title: string;
  jobId: string;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <header className="h-14 px-3 flex items-center justify-between border-b border-rule bg-paper-hi shadow-panel relative">
      <div className="flex items-center gap-2 min-w-0">
        <Link
          to={`/job/${jobId}`}
          className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-paper-deep"
          aria-label="Back to job"
        >
          <ChevronLeftIcon />
        </Link>
        <div className="font-display text-base truncate">{title}</div>
        <span className="hidden sm:inline-block ml-2 px-1.5 py-0.5 text-[10px] tracking-label uppercase font-mono bg-paper-deep text-ink-2 rounded">
          editor
        </span>
      </div>
      <ChunkyButton
        variant="primary"
        size="md"
        onClick={onSubmit}
        disabled={submitting}
        iconLeft={<DownloadIcon />}
      >
        {submitting ? "Rendering…" : "Render"}
      </ChunkyButton>
    </header>
  );
}
