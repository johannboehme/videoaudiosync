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

/** Minimal API a WebGL2 fx draw needs. Hides program-cache + quad-VBO
 *  details from the catalog so unit-tests can stub it cheaply. */
export interface WebGL2DrawContext {
  /** Bind the program registered under `name` (compiled lazily). */
  useProgram(name: string): void;
  setUniform1f(name: string, value: number): void;
  setUniform2f(name: string, a: number, b: number): void;
  /** Issue the fullscreen-quad draw call with the active program. */
  drawFullscreenQuad(): void;
}

/** Shared helper for tests / debug logging — describes a fx call site. */
export function fxLogId(fx: PunchFx): string {
  return `${fx.kind}#${fx.id}`;
}
