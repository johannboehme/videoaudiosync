/**
 * FX-Catalog: registry of supported FxKinds with their parameters and
 * draw implementations (Canvas2D + WebGL2 — same parameters, different
 * pixel-producing backends; see ../../plans for the architecture).
 *
 * V1 ships `vignette`. New kinds: add a const + add it to `fxCatalog`.
 */
import type {
  CanvasLikeContext,
  WebGL2DrawContext,
} from "./renderer-context";
import type { FxKind, PunchFx } from "./types";

export interface FxDefinition {
  kind: FxKind;
  /** Short display label on pads / capsules. ≤ 4 chars. */
  label: string;
  /** Capsule fill colour on the ProgramStrip + LED tint on the pad. */
  capsuleColor: string;
  defaultParams: Record<string, number>;
  /** Default tap-length when the user just taps (no hold) and BPM is set.
   *  Multiplied by `60/bpm`. Falls back to `defaultLengthS` when BPM null. */
  defaultLengthBeats?: number;
  /** Fallback default tap-length when no BPM is detected. */
  defaultLengthS: number;

  /** Canvas2D / OffscreenCanvas2D renderer. Same code runs in:
   *   - Live preview's Canvas2DBackend (when WebGL2 unavailable)
   *   - Final render via `compositor.ts` (also via Canvas2DBackend)
   *  Implementations should NOT touch ctx state outside save/restore;
   *  the backend wraps each call in save/restore for safety. */
  drawCanvas2D(ctx: CanvasLikeContext, fx: PunchFx, w: number, h: number): void;

  /** WebGL2 renderer. Called with a configured fullscreen-quad pipeline;
   *  implementation pulls params, sets uniforms, and issues the draw. */
  drawWebGL2(ctx: WebGL2DrawContext, fx: PunchFx, w: number, h: number): void;
}

const VIGNETTE_DEFAULTS = {
  /** 0..1 — alpha of the darkest corner pixel. Higher = more cinematic. */
  intensity: 0.92,
  /** 0..1 — fraction of the radius over which the falloff happens.
   *  Higher = darkening starts closer to center → more dramatic. */
  falloff: 0.85,
} as const;

function vignetteParams(fx: PunchFx): { intensity: number; falloff: number } {
  const p = fx.params ?? {};
  const intensity = clamp01(
    p.intensity ?? VIGNETTE_DEFAULTS.intensity,
  );
  const falloff = clamp01(p.falloff ?? VIGNETTE_DEFAULTS.falloff);
  return { intensity, falloff };
}

const VIGNETTE: FxDefinition = {
  kind: "vignette",
  label: "VIGN",
  capsuleColor: "#1F4E5F",
  defaultParams: { ...VIGNETTE_DEFAULTS },
  defaultLengthBeats: 1,
  defaultLengthS: 0.5,

  drawCanvas2D(ctx, fx, w, h) {
    const { intensity, falloff } = vignetteParams(fx);
    if (intensity <= 0) return;
    // Inner radius = where the falloff begins (no darkening before this).
    // Outer radius = the corner distance of the canvas (hypotenuse / 2).
    const cx = w / 2;
    const cy = h / 2;
    const outer = Math.hypot(cx, cy);
    const inner = outer * (1 - falloff);
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, `rgba(0,0,0,${intensity})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  },

  drawWebGL2(ctx, fx) {
    const { intensity, falloff } = vignetteParams(fx);
    ctx.useProgram("vignette");
    ctx.setUniform1f("u_intensity", intensity);
    ctx.setUniform1f("u_falloff", falloff);
    ctx.drawFullscreenQuad();
  },
};

export const fxCatalog: Readonly<Record<FxKind, FxDefinition>> = {
  vignette: VIGNETTE,
};

export function getFxDefinition(kind: FxKind): FxDefinition {
  return fxCatalog[kind];
}

/** Default tap-length for a fx kind in seconds, given an optional BPM. */
export function defaultTapLengthS(kind: FxKind, bpm: number | null): number {
  const def = fxCatalog[kind];
  if (def.defaultLengthBeats != null && bpm && bpm > 0) {
    return def.defaultLengthBeats * (60 / bpm);
  }
  return def.defaultLengthS;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
