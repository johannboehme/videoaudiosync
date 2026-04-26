// Top-level editor layout. Desktop = grid; tablet/mobile = video + bottom sheet.
import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { ChunkyButton } from "./ChunkyButton";
import { ChevronLeftIcon, DownloadIcon } from "./icons";
import { BottomSheet } from "./BottomSheet";

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

  return (
    <div className="flex flex-col h-screen overflow-hidden paper-bg">
      <TopBar
        title={jobTitle}
        jobId={jobId}
        onSubmit={onSubmit}
        submitting={submitting}
      />

      {/* Desktop layout (lg+) */}
      <div className="flex-1 hidden lg:grid lg:grid-cols-[1fr_380px] gap-3 px-3 pb-3 overflow-hidden">
        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex-1 rounded-lg border border-rule shadow-panel bg-sunken overflow-hidden">
            {videoArea}
          </div>
          <div className="bg-paper-hi rounded-lg border border-rule shadow-panel p-3">
            {transport}
          </div>
          <div className="bg-paper-hi rounded-lg border border-rule shadow-panel p-3">
            {timeline}
          </div>
        </div>
        <div className="overflow-hidden">{sidePanel}</div>
      </div>

      {/* Tablet / mobile layout */}
      <div className="flex-1 lg:hidden flex flex-col gap-3 px-3 pb-3 overflow-hidden">
        <div className="aspect-video bg-sunken rounded-lg border border-rule shadow-panel overflow-hidden">
          {videoArea}
        </div>
        <div className="bg-paper-hi rounded-lg border border-rule shadow-panel p-3">
          {transport}
        </div>
        <div className="bg-paper-hi rounded-lg border border-rule shadow-panel p-3 flex-1 overflow-hidden">
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
