/**
 * Canvas2D-based renderer for the ASS subset our app actually produces.
 *
 * Why not JASSUB? JASSUB transfers control of the canvas to a worker via
 * `transferControlToOffscreen`. In our offline-render pipeline (no DOM
 * paint loop, frames pulled by createImageBitmap), Chromium does not
 * reliably propagate the worker's pixels back to the placeholder canvas
 * — so we get blanks. Building a focused renderer for the subset of ASS
 * we generate (text overlays with fade/pop/slide_in/wobble/word_reveal
 * + audio-reactive scale/y/rotation) is reliable, deterministic, and
 * keeps the render hot path on the main thread.
 *
 * The renderer reads the same TextOverlay shape that ass-builder writes,
 * so the data model is shared; ass-builder remains the source of truth
 * for what an exported .ass file looks like (e.g. for downloading), and
 * this renderer is the source of truth for what burns into rendered
 * video.
 */

import { PRESETS, type TextOverlay, type EnergyCurves } from "./ass-builder";

interface PresetStyle {
  font: string;
  size: number;
  primary: string;
  outline: string;
  outline_w: number;
  back_color?: string;
  border_style?: number;
}

function lookupPreset(name: string): PresetStyle {
  return (PRESETS[name] ?? PRESETS.plain) as PresetStyle;
}

function rgbToCss(rgb: string): string {
  const c = rgb.replace(/^#/, "");
  return `#${c.toUpperCase()}`;
}

interface ReactiveSample {
  scale: number; // multiplier (1.0 = unchanged)
  yOffset: number; // px
  rotation: number; // radians
}

function sampleReactive(
  o: TextOverlay,
  energy: EnergyCurves | null | undefined,
  tSeconds: number,
): ReactiveSample {
  const out: ReactiveSample = { scale: 1, yOffset: 0, rotation: 0 };
  if (!energy || !o.reactiveBand) return out;
  const series = energy.bands[o.reactiveBand];
  if (!series || series.length === 0) return out;
  const fps = energy.fps || 30;
  const idx = Math.round(tSeconds * fps);
  const v = idx >= 0 && idx < series.length ? series[idx] : 0;
  const amt = o.reactiveAmount * v;
  if (o.reactiveParam === "scale") out.scale = 1 + amt;
  else if (o.reactiveParam === "y") out.yOffset = -amt * 30;
  else if (o.reactiveParam === "rotate") out.rotation = (amt * 8 * Math.PI) / 180;
  return out;
}

/** Derived per-frame animation amplitudes for a single overlay. */
function sampleAnimation(o: TextOverlay, tSeconds: number): {
  alpha: number;
  scale: number;
  xOffset: number;
  rotation: number;
} {
  const localT = tSeconds - o.start;
  const dur = Math.max(0.001, o.end - o.start);
  let alpha = 1;
  let scale = 1;
  let xOffset = 0;
  let rotation = 0;

  switch (o.animation) {
    case "fade": {
      // 200 ms in, 200 ms out
      const fadeIn = Math.min(1, localT / 0.2);
      const fadeOut = Math.min(1, (dur - localT) / 0.2);
      alpha = Math.max(0, Math.min(fadeIn, fadeOut));
      break;
    }
    case "pop": {
      // 0..150 ms: 0 → 115 %, 150..250 ms: 115 → 100 %, then steady; fade out 200 ms.
      if (localT < 0.15) {
        scale = (localT / 0.15) * 1.15;
      } else if (localT < 0.25) {
        const k = (localT - 0.15) / 0.1;
        scale = 1.15 - k * 0.15;
      } else {
        scale = 1;
      }
      alpha = Math.min(1, Math.max(0, (dur - localT) / 0.2));
      break;
    }
    case "slide_in": {
      // 0..250 ms: enter from -200 px to 0
      if (localT < 0.25) {
        xOffset = (1 - localT / 0.25) * -200;
      }
      const fadeOut = Math.min(1, (dur - localT) / 0.2);
      alpha = Math.max(0, Math.min(1, fadeOut));
      break;
    }
    case "wobble": {
      // 3° → -3° wobble across the duration, 150 ms fade in/out
      const phase = (localT / dur) * Math.PI * 2;
      rotation = (Math.sin(phase) * 3 * Math.PI) / 180;
      const fadeIn = Math.min(1, localT / 0.15);
      const fadeOut = Math.min(1, (dur - localT) / 0.15);
      alpha = Math.max(0, Math.min(fadeIn, fadeOut));
      break;
    }
    case "word_reveal":
      // Handled in drawText below by per-word alpha; default alpha = 1.
      break;
    case "none":
    default:
      break;
  }

  return { alpha, scale, xOffset, rotation };
}

function drawTextWithStyle(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  preset: PresetStyle,
  scale: number,
) {
  const fontSize = preset.size * scale;
  ctx.font = `${preset.size > 0 && preset.font.toLowerCase().includes("black") ? "900" : "bold"} ${fontSize}px ${preset.font}, "Arial Black", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  if (preset.border_style === 4 && preset.back_color) {
    // Boxed: opaque box behind text.
    const metrics = ctx.measureText(text);
    const w = metrics.width + 24;
    const h = fontSize + 16;
    ctx.fillStyle = rgbToCss(preset.back_color);
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }

  // Outline (stroke first, then fill on top).
  if (preset.outline_w > 0) {
    ctx.lineWidth = preset.outline_w * 2 * scale;
    ctx.strokeStyle = rgbToCss(preset.outline);
    ctx.lineJoin = "round";
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = rgbToCss(preset.primary);
  ctx.fillText(text, 0, 0);
}

/**
 * Paints all overlays active at the given time onto the supplied context.
 */
export function renderOverlays(
  ctx: OffscreenCanvasRenderingContext2D,
  overlays: TextOverlay[],
  width: number,
  height: number,
  tSeconds: number,
  energy?: EnergyCurves | null,
): void {
  for (const o of overlays) {
    if (tSeconds < o.start || tSeconds >= o.end) continue;
    const preset = lookupPreset(o.preset);

    const anim = sampleAnimation(o, tSeconds);
    const reactive = sampleReactive(o, energy ?? null, tSeconds);
    if (anim.alpha <= 0) continue;

    const cx = o.x * width + anim.xOffset;
    const cy = o.y * height + reactive.yOffset;

    ctx.save();
    ctx.globalAlpha = anim.alpha;
    ctx.translate(cx, cy);
    if (anim.rotation !== 0 || reactive.rotation !== 0) {
      ctx.rotate(anim.rotation + reactive.rotation);
    }

    if (o.animation === "word_reveal") {
      // Per-word alpha reveal.
      const words = o.text.split(/\s+/).filter((w) => w.length > 0);
      if (words.length === 0) {
        ctx.restore();
        continue;
      }
      const dur = Math.max(0.001, o.end - o.start);
      const per = dur / words.length;
      const localT = tSeconds - o.start;
      // Render with measured spacing — this is approximate but good enough
      // for the overlay size we use.
      const fontSize = preset.size * anim.scale * reactive.scale;
      ctx.font = `bold ${fontSize}px ${preset.font}, "Arial Black", sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const widths = words.map((w) => ctx.measureText(w + " ").width);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = -total / 2;
      for (let i = 0; i < words.length; i++) {
        const t1 = i * per;
        const t2 = t1 + Math.min(0.12, per);
        const wordAlpha = Math.max(0, Math.min(1, (localT - t1) / Math.max(0.0001, t2 - t1)));
        ctx.save();
        ctx.globalAlpha *= wordAlpha;
        ctx.translate(x, 0);
        // Stroke + fill via the helper, but we've got our own translate so
        // pass a draw method that uses textAlign=left.
        if (preset.outline_w > 0) {
          ctx.lineWidth = preset.outline_w * 2 * anim.scale * reactive.scale;
          ctx.strokeStyle = rgbToCss(preset.outline);
          ctx.lineJoin = "round";
          ctx.strokeText(words[i], 0, 0);
        }
        ctx.fillStyle = rgbToCss(preset.primary);
        ctx.fillText(words[i], 0, 0);
        ctx.restore();
        x += widths[i];
      }
    } else {
      drawTextWithStyle(ctx, o.text, preset, anim.scale * reactive.scale);
    }

    ctx.restore();
  }
}
