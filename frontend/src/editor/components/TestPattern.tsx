/**
 * SMPTE-style color bars test pattern.
 *
 * Shown in the preview when no cam has material at the current playhead
 * position (gap in the program). Eight vertical stripes in the standard
 * SMPTE order, plus a small "NO SIGNAL" plate centered over the bars
 * for clarity. Drawn purely with CSS so it scales to any preview size
 * without canvas overhead.
 */
const SMPTE_BARS = [
  "#C0C0C0", // gray
  "#C0C000", // yellow
  "#00C0C0", // cyan
  "#00C000", // green
  "#C000C0", // magenta
  "#C00000", // red
  "#0000C0", // blue
  "#1A1A1A", // dark gray
];

export function TestPattern() {
  return (
    <div className="relative w-full h-full bg-sunken flex">
      {SMPTE_BARS.map((color, i) => (
        <div
          key={i}
          className="flex-1 h-full"
          style={{ background: color }}
        />
      ))}
      {/* "NO SIGNAL" plate */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="px-4 py-2 font-display font-semibold tracking-label uppercase text-sm rounded-sm"
          style={{
            background: "rgba(26,24,22,0.85)",
            color: "#F2EDE2",
            border: "1px solid rgba(255,255,255,0.15)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}
        >
          ● NO SIGNAL
        </div>
      </div>
    </div>
  );
}
