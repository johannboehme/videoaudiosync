// Tiny inline SVG icon set, line-based, optical-aligned for chunky buttons.
import { SVGProps } from "react";

const baseProps: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
  </svg>
);
export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
    <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" />
  </svg>
);
export const SkipBackIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polygon points="19 4 9 12 19 20 19 4" fill="currentColor" stroke="none" />
    <line x1="5" y1="4" x2="5" y2="20" />
  </svg>
);
export const SkipFwdIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" />
    <line x1="19" y1="4" x2="19" y2="20" />
  </svg>
);
export const StepBackIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polygon points="14 6 8 12 14 18 14 6" fill="currentColor" stroke="none" />
  </svg>
);
export const StepFwdIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polygon points="10 6 16 12 10 18 10 6" fill="currentColor" stroke="none" />
  </svg>
);
export const LoopIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);
export const InIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <line x1="6" y1="4" x2="6" y2="20" />
    <polyline points="10 8 14 12 10 16" />
    <line x1="14" y1="12" x2="20" y2="12" />
  </svg>
);
export const OutIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <line x1="18" y1="4" x2="18" y2="20" />
    <polyline points="14 8 10 12 14 16" />
    <line x1="10" y1="12" x2="4" y2="12" />
  </svg>
);
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
export const MinusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
export const XIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);
export const DownloadIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
export const ChevronLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
/** Skip to the detected audio start: flat silence → marker → waveform. */
export const AudioStartIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    {/* flat line = silence before the music */}
    <line x1="1" y1="12" x2="6" y2="12" />
    {/* vertical bar = the audio-start marker */}
    <line x1="8" y1="4" x2="8" y2="20" />
    {/* waveform bars = the audio content that follows */}
    <line x1="11" y1="9" x2="11" y2="15" />
    <line x1="14" y1="6" x2="14" y2="18" />
    <line x1="17" y1="9" x2="17" y2="15" />
    <line x1="20" y1="11" x2="20" y2="13" />
  </svg>
);
export const SyncIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
    <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
  </svg>
);
