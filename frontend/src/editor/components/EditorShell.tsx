// Top-level editor layout. Desktop = grid; tablet/mobile = video + bottom sheet.
import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChunkyButton } from "./ChunkyButton";
import {
  ChevronLeftIcon,
  DownloadIcon,
  SyncIcon,
} from "./icons";
import { BottomSheet } from "./BottomSheet";
import { useEditorStore, type PanelTab } from "../store";

const SIDE_PANEL_COLLAPSE_KEY = "editor.sidepanel.collapsed";
const SLIM_RAIL_W = 36;
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

      {/* Desktop layout (lg+) */}
      <div
        className="flex-1 hidden lg:grid gap-3 px-3 pb-3 overflow-hidden min-h-0 transition-[grid-template-columns] duration-200 ease-out"
        style={{
          gridTemplateColumns: sideCollapsed
            ? `1fr ${SLIM_RAIL_W}px`
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
        <div className="relative min-h-0">
          {sideCollapsed ? (
            <SlimRail onExpand={() => setSideCollapsed(false)} />
          ) : (
            <div className="relative h-full overflow-hidden">
              <CollapseTab
                onCollapse={() => setSideCollapsed(true)}
              />
              <div className="h-full overflow-hidden">{sidePanel}</div>
            </div>
          )}
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

/**
 * Small chevron tab on the *expanded* side panel that collapses the panel.
 * Lives just outside the panel's left edge so it doesn't push the tab
 * row inward, anchored to the vertical center of the panel area.
 */
function CollapseTab({ onCollapse }: { onCollapse: () => void }) {
  return (
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Collapse side panel"
      title="Collapse side panel"
      className={[
        "absolute top-1/2 -translate-y-1/2 -left-3 z-10",
        "w-6 h-14 rounded-l-md flex items-center justify-center",
        "bg-paper-hi border border-r-0 border-rule shadow-panel",
        "text-ink-2 hover:text-ink hover:bg-paper-deep transition-colors",
      ].join(" ")}
    >
      <ChevronLeftIcon
        className="w-3.5 h-3.5"
        style={{ transform: "rotate(180deg)" }}
      />
    </button>
  );
}

/**
 * Collapsed side-panel slim-rail. Doubles as a quick tab switcher: each
 * stacked button (SYNC / TRIM / OVERLAYS / EXPORT) jumps directly to
 * that tab AND expands the panel in one click. The currently-active
 * tab is highlighted with a hot-orange accent stripe and the
 * tape-deck "key pressed" inset shadow, so the user knows where they
 * left off even while the body is hidden.
 */
function SlimRail({ onExpand }: { onExpand: () => void }) {
  const activeTab = useEditorStore((s) => s.ui.activePanel);
  const setActive = useEditorStore((s) => s.setActivePanel);

  const tabs: { value: PanelTab; label: string; glyph: ReactNode }[] = [
    {
      value: "sync",
      label: "Sync",
      glyph: <SyncIcon className="w-3.5 h-3.5" />,
    },
    { value: "trim", label: "Trim", glyph: <RailLetter>T</RailLetter> },
    {
      value: "overlays",
      label: "Overlays",
      glyph: <RailLetter>O</RailLetter>,
    },
    {
      value: "export",
      label: "Export",
      glyph: <DownloadIcon className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div
      className="h-full flex flex-col gap-1 py-2 bg-paper-hi rounded-lg border border-rule shadow-panel"
      role="tablist"
      aria-label="Side panel quick tabs"
    >
      {tabs.map((t) => {
        const active = t.value === activeTab;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${t.label} — click to expand panel`}
            title={`${t.label} (click to expand)`}
            onClick={() => {
              setActive(t.value);
              onExpand();
            }}
            className={[
              "relative mx-1.5 flex flex-col items-center justify-center gap-0.5 py-2 rounded-md",
              "text-ink-2 hover:text-ink transition-colors",
              active ? "bg-paper-deep" : "hover:bg-paper-deep/60",
            ].join(" ")}
          >
            {/* Hot accent stripe for the active tab — left edge so it
             *  reads as a "current" marker without dominating. */}
            {active && (
              <span
                aria-hidden
                className="absolute top-1 bottom-1 left-0 w-[2px] rounded-r bg-hot"
                style={{ boxShadow: "0 0 4px rgba(255,87,34,0.55)" }}
              />
            )}
            <span
              className={active ? "text-hot" : "text-ink-2"}
              aria-hidden
            >
              {t.glyph}
            </span>
            <span
              className="font-display tracking-label uppercase text-[8.5px] leading-none font-semibold"
              style={{ color: active ? "#1A1816" : undefined }}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RailLetter({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="font-display font-semibold text-[13px] leading-none"
    >
      {children}
    </span>
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
