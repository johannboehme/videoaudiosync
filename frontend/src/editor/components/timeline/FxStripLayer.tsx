/**
 * FX-Capsule-Layer für die ProgramStrip — Tonband-Visual.
 *
 * Konzept (verworfen: Capsules + Drag/Resize):
 *   - Eine durchgängige Tape-Lane, die in horizontale Segmente unterteilt
 *     ist. Jedes Segment kennt die Menge der dort aktiven FX-Kinds.
 *   - Ein FX-Kind hat einen festen vertikalen Slot in der Lane. Slot-
 *     Index = Position im fxCatalog (Object.keys-Reihenfolge). Mit nur
 *     einem Kind füllt es die ganze Lane; mit N Kinds bekommt jedes
 *     1/N der Höhe ("Regenbogen"). Inaktive Slots sind transparent.
 *   - Live-Recording-Edge ist ein dünner heller Pulser am outS der
 *     liveFxIds, vertikal beschränkt auf den Slot des Live-Kinds.
 *
 * Read-only — keine Pointer-Events, keine Drag/Resize, keine ×-Buttons.
 * Editieren passiert ausschließlich über Hotkeys + Pad-Buttons.
 */
import { useMemo } from "react";
import type { FxKind, PunchFx } from "../../fx/types";
import { fxCatalog } from "../../fx/catalog";

interface Props {
  fx: readonly PunchFx[];
  viewStartS: number;
  viewEndS: number;
  width: number;
  height: number;
  liveFxIds: ReadonlySet<string>;
}

interface Segment {
  startS: number;
  endS: number;
  /** True per slot index (catalog order). */
  active: boolean[];
}

export function FxStripLayer({
  fx,
  viewStartS,
  viewEndS,
  width,
  height,
  liveFxIds,
}: Props) {
  // Stable slot order — fxCatalog object insertion order.
  const slots = useMemo<FxKind[]>(
    () => Object.keys(fxCatalog) as FxKind[],
    [],
  );
  const slotIndexOf = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    slots.forEach((k, i) => {
      m[k] = i;
    });
    return m;
  }, [slots]);
  const N = slots.length;

  const visibleSpan = Math.max(1e-6, viewEndS - viewStartS);
  const tToX = (t: number) =>
    ((t - viewStartS) / visibleSpan) * width;

  const segments = useMemo<Segment[]>(() => {
    if (N === 0) return [];
    const lo = viewStartS;
    const hi = viewEndS;
    const ts = new Set<number>([lo, hi]);
    for (const f of fx) {
      if (f.outS <= lo || f.inS >= hi) continue;
      ts.add(Math.max(lo, Math.min(hi, f.inS)));
      ts.add(Math.max(lo, Math.min(hi, f.outS)));
    }
    const sorted = [...ts].filter((t) => t >= lo && t <= hi).sort((a, b) => a - b);
    const out: Segment[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (b - a < 1e-9) continue;
      const mid = (a + b) / 2;
      const active = new Array<boolean>(N).fill(false);
      for (const f of fx) {
        if (f.inS <= mid && mid < f.outS) {
          const idx = slotIndexOf[f.kind];
          if (idx != null) active[idx] = true;
        }
      }
      out.push({ startS: a, endS: b, active });
    }
    return out;
  }, [fx, viewStartS, viewEndS, slotIndexOf, N]);

  // Per slot, the most-recent live fx (used for the leading-edge pulser).
  const livePulses = useMemo(() => {
    const items: Array<{ slot: number; outS: number; color: string }> = [];
    for (const f of fx) {
      if (!liveFxIds.has(f.id)) continue;
      const slot = slotIndexOf[f.kind];
      if (slot == null) continue;
      items.push({
        slot,
        outS: f.outS,
        color: fxCatalog[f.kind].capsuleColor,
      });
    }
    return items;
  }, [fx, liveFxIds, slotIndexOf]);

  if (N === 0) return null;

  return (
    <div
      className="relative pointer-events-none"
      style={{ width, height, overflow: "hidden" }}
    >
      {segments.map((seg, i) => {
        if (!seg.active.some(Boolean)) return null;
        const x1 = tToX(seg.startS);
        const x2 = tToX(seg.endS);
        if (x2 < 0 || x1 > width) return null;
        const left = Math.max(0, x1);
        const right = Math.min(width, x2);
        if (right <= left) return null;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0"
            style={{
              left,
              width: right - left,
              background: stripeGradient(seg.active, slots),
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 0 rgba(0,0,0,0.4)",
            }}
            title={kindList(seg.active, slots)}
          />
        );
      })}

      {/* Leading-edge pulser per live fx — sits on top of the stripes. */}
      {livePulses.map((p, i) => {
        const x = tToX(p.outS);
        if (x < -2 || x > width + 2) return null;
        const slotTop = (p.slot * height) / N;
        const slotH = height / N;
        return (
          <span
            key={i}
            className="absolute pointer-events-none"
            style={{
              left: x - 1,
              top: slotTop,
              width: 2,
              height: slotH,
              background:
                "linear-gradient(180deg, #FFFFFF 0%, rgba(255,255,255,0.7) 100%)",
              boxShadow: `0 0 6px ${p.color}, 0 0 12px rgba(255,255,255,0.85)`,
              animation: "vas-fx-live-pulse 0.7s ease-in-out infinite",
            }}
          />
        );
      })}
    </div>
  );
}

/** Build a vertical multi-stop linear-gradient that paints the active
 *  slots in their catalog colour and leaves inactive slots transparent.
 *  Stops are placed at exact slot boundaries so the bands are crisp,
 *  not blended. */
function stripeGradient(active: boolean[], slots: FxKind[]): string {
  const N = active.length;
  if (N === 0) return "transparent";
  const stops: string[] = [];
  for (let i = 0; i < N; i++) {
    const startPct = (i * 100) / N;
    const endPct = ((i + 1) * 100) / N;
    const color = active[i]
      ? fxCatalog[slots[i]].capsuleColor
      : "transparent";
    stops.push(`${color} ${startPct.toFixed(3)}% ${endPct.toFixed(3)}%`);
  }
  return `linear-gradient(180deg, ${stops.join(", ")})`;
}

function kindList(active: boolean[], slots: FxKind[]): string {
  const labels: string[] = [];
  for (let i = 0; i < active.length; i++) {
    if (active[i]) labels.push(fxCatalog[slots[i]].label);
  }
  return labels.join(" + ");
}

export type FxStripLayerProps = Props;
