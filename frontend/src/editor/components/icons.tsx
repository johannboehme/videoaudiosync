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
/** Curved arrow forming a clockwise loop — for the rotation hardware
 *  cluster header. */
export const RotateCwIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
/** Vertical axis with two arrows pointing horizontally outward — flip H. */
export const FlipHIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2 2" />
    <polyline points="9 8 5 12 9 16" />
    <polyline points="15 8 19 12 15 16" />
  </svg>
);
/** Horizontal axis with two arrows pointing vertically outward — flip V. */
export const FlipVIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2 2" />
    <polyline points="8 9 12 5 16 9" />
    <polyline points="8 15 12 19 16 15" />
  </svg>
);
/** Speaker cone + soundwaves — master-audio volume header. */
export const VolumeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);
/** Picture-frame icon — image-clip header. */
export const ImageIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);
/** Film-slate icon — video-clip header. */
export const VideoClipIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <rect x="2" y="6" width="20" height="14" rx="2" />
    <polygon points="10 10 16 13 10 16 10 10" fill="currentColor" stroke="none" />
    <line x1="2" y1="6" x2="22" y2="6" />
    <line x1="6" y1="2" x2="9" y2="6" />
    <line x1="11" y1="2" x2="14" y2="6" />
    <line x1="16" y1="2" x2="19" y2="6" />
  </svg>
);
