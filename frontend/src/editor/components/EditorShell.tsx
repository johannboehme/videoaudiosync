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
       *  expand-handle floats over the right edge as a small grab tab. */}
      <div
        className="relative flex-1 hidden lg:grid gap-3 px-3 pb-3 overflow-hidden min-h-0 transition-[grid-template-columns] duration-200 ease-out"
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
 * Skeuomorphic drawer-pull that toggles the side panel. Floats over the
 * right side so it never reserves layout space. When collapsed it sits
 * flush against the right edge (panel is gone, full screen for the
 * editor); when expanded it sits just outside the panel's left edge.
 *
 * Look: a small chunky grip with knurled horizontal lines (mirrors the
 * fader-thumb on the time scrollbar), a brushed-cobalt face that sets
 * it apart from the paper chrome, and a hot LED dot at the top so the
 * eye lands on it.
 */
function PanelHandle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Outer grid has px-3 + gap-3 (= 12 px each). When collapsed the panel
  // is 0 so the handle sits inside the right padding; when expanded the
  // panel takes EXPANDED_W and the handle sits at its left edge.
  const rightPx = collapsed ? 12 : EXPANDED_W + 12 + 12;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Show side panel" : "Hide side panel"}
      title={collapsed ? "Show panel" : "Hide panel"}
      className={[
        "group absolute top-1/2 -translate-y-1/2 z-20",
        "w-3.5 h-11 rounded-l flex flex-col items-center justify-between py-1.5",
        "transition-[right] duration-200 ease-out",
      ].join(" ")}
      style={{
        right: rightPx,
        background: "linear-gradient(180deg, #2A4F8F 0%, #1F4079 50%, #2A4F8F 100%)",
        border: "1px solid rgba(0,0,0,0.45)",
        boxShadow: [
          "inset 0 1px 0 rgba(255,255,255,0.18)",
          "inset 0 -1px 0 rgba(0,0,0,0.3)",
          "-1px 1px 2px rgba(0,0,0,0.18)",
        ].join(", "),
      }}
    >
      {/* Hot LED at the top — small "this is interactive" cue. */}
      <span
        aria-hidden
        className="block w-1 h-1 rounded-full"
        style={{
          background: "#FF5722",
          boxShadow: "0 0 3px rgba(255,87,34,0.85)",
        }}
      />
      {/* Knurled grip — three thin horizontal lines, brighter on hover. */}
      <span
        aria-hidden
        className="flex flex-col gap-[2px] py-0.5"
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block w-[6px] h-[1px] rounded-sm"
            style={{ background: "rgba(255,255,255,0.55)" }}
          />
        ))}
      </span>
      {/* Direction hint at the bottom — chevron-left when expanded
       *  (collapse), chevron-right when collapsed (expand). Tucked
       *  small so the grip texture stays the focal point. */}
      <ChevronLeftIcon
        className="w-2 h-2 transition-transform duration-200 text-paper-hi/85 group-hover:text-paper-hi"
        style={{ transform: collapsed ? "rotate(180deg)" : "none" }}
      />
    </button>
  );
}

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
