/**
 * Backend-agnostic context types used by `FxDefinition.drawCanvas2D` and
 * `drawWebGL2`. Keeps the catalog independent of concrete renderer
 * classes — a definition can be unit-tested by passing a stub here.
 */
import type { PunchFx } from "./types";

/** Subset of CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D
 *  that we actually use in fx draws. Matches both real APIs. */
export type CanvasLikeContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

/** Wie der Shader auf das Source-Layer-Output (Canvas2D-Snapshot oder
 *  WebGL2-FBO-Texture) zugreift. Source-Sampling-Effekte wie RGB,
 *  ZOOM, UV, ECHO, TAPE setzen dies; reine Overlays (Vignette, Wash)
 *  ignorieren es. */
export type FxBlendMode = "over" | "replace";

/** Minimal API a WebGL2 fx draw needs. Hides program-cache + quad-VBO
 *  details from the catalog so unit-tests can stub it cheaply. */
export interface WebGL2DrawContext {
  /** Bind the program registered under `name` (compiled lazily). */
  useProgram(name: string): void;
  setUniform1i(name: string, value: number): void;
  setUniform1f(name: string, value: number): void;
  setUniform2f(name: string, a: number, b: number): void;
  setUniform4f(name: string, a: number, b: number, c: number, d: number): void;
  /** Bind the layer-pass output texture to the given texture unit and
   *  set `samplerName` (defaults to "u_source") to that unit. The unit
   *  is reserved by the backend for source sampling — implementations
   *  pick a fixed slot (typically 0). */
  bindSourceTexture(samplerName?: string): void;
  /** "over" = additive premultiplied (Vignette/Wash). "replace" =
   *  no blending, the FX shader fully owns the output (RGB-Split,
   *  ZOOM, ECHO, TAPE). Backend resets to "over" between fx. */
  setBlendMode(mode: FxBlendMode): void;
  /** Issue the fullscreen-quad draw call with the active program. */
  drawFullscreenQuad(): void;
}

/** Shared helper for tests / debug logging — describes a fx call site. */
export function fxLogId(fx: PunchFx): string {
  return `${fx.kind}#${fx.id}`;
}
