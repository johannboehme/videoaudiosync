// Top-level editor layout. Desktop = grid; tablet/mobile = video + bottom sheet.
import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChunkyButton } from "./ChunkyButton";
import { ChevronLeftIcon, DownloadIcon } from "./icons";
import { BottomSheet } from "./BottomSheet";

const SIDE_PANEL_COLLAPSE_KEY = "editor.sidepanel.collapsed";

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

      {/* Desktop layout (lg+) */}
      <div
        className="flex-1 hidden lg:grid gap-3 px-3 pb-3 overflow-hidden min-h-0 transition-[grid-template-columns] duration-200 ease-out"
        style={{
          gridTemplateColumns: sideCollapsed ? "1fr 32px" : "1fr 380px",
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
        <div className="relative overflow-hidden min-h-0">
          <CollapseToggle
            collapsed={sideCollapsed}
            onToggle={() => setSideCollapsed((c) => !c)}
          />
          <div
            className={[
              "h-full overflow-hidden transition-opacity duration-150",
              sideCollapsed ? "opacity-0 pointer-events-none" : "opacity-100",
            ].join(" ")}
          >
            {sidePanel}
          </div>
        </div>
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

/** Slim chevron tab on the side-panel's left edge that toggles collapse. */
function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Expand side panel" : "Collapse side panel"}
      title={collapsed ? "Expand side panel" : "Collapse side panel"}
      className={[
        "absolute top-2 z-10 w-6 h-12 rounded-md flex items-center justify-center",
        "bg-paper-hi border border-rule shadow-emboss text-ink-2",
        "hover:bg-paper-deep hover:text-ink transition-colors",
        // Position: at the left edge of the side area when expanded, sits
        // tight in the slim rail when collapsed.
        collapsed ? "left-1/2 -translate-x-1/2" : "left-0 -translate-x-1/2",
      ].join(" ")}
    >
      <span
        aria-hidden
        className="font-mono text-xs leading-none transition-transform"
        style={{ transform: collapsed ? "rotate(180deg)" : "rotate(0deg)" }}
      >
        ›
      </span>
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
