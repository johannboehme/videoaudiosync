/**
 * WebGL2-Backed FxRenderer. Best-Path für die Live-Preview-FX-Layer.
 *
 * Architektur:
 *   - Eigene Output-Canvas, mit alpha:true premultiplied — der FX-Layer
 *     bleibt durchlässig, sodass der darunter liegende `<video>`-Stack
 *     vom Browser-GPU-Compositor durchgereicht wird.
 *   - Pro Frame: gl.clear → für jede aktive FX: program/uniforms binden
 *     → fullscreen-quad draw mit alpha-blending (`SRC_ALPHA, ONE_MINUS_SRC_ALPHA`).
 *   - Programme werden lazy via ProgramCache compiliert, beim ersten
 *     Vorkommen einer Kind. Wir reichen pro Frame nur Uniforms durch.
 */
import { activeFxAt } from "./../active";
import { fxCatalog } from "./../catalog";
import type { WebGL2DrawContext } from "./../renderer-context";
import type { FxRenderer } from "./../render";
import type { PunchFx } from "./../types";
import { ProgramCache, REGISTERED_FRAGMENTS, type CachedProgram } from "./program-cache";
import { makeFullscreenQuad } from "./quad";

void activeFxAt;

export class WebGL2FxRenderer implements FxRenderer {
  readonly backend = "webgl2" as const;

  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private programs: ProgramCache;
  private quad: ReturnType<typeof makeFullscreenQuad>;
  private currentProgram: CachedProgram | null = null;
  private cssW = 0;
  private cssH = 0;

  /** Reusable adapter so the FxDefinition.drawWebGL2 doesn't have to know
   *  about our internal program-cache or quad. The same instance is
   *  re-used per frame — the catalog reads and forgets. */
  private drawCtx: WebGL2DrawContext;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error("WebGL2FxRenderer: getContext('webgl2') returned null");
    }
    this.gl = gl;
    this.programs = new ProgramCache(gl);
    this.quad = makeFullscreenQuad(gl);

    // Alpha-over-blending so multiple stacked FX composit correctly.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.drawCtx = {
      useProgram: (name: string) => {
        const p = this.programs.get(name);
        this.gl.useProgram(p.program);
        this.currentProgram = p;
      },
      setUniform1f: (name: string, value: number) => {
        if (!this.currentProgram) return;
        const loc = this.programs.getUniform(this.currentProgram, name);
        if (loc !== null) this.gl.uniform1f(loc, value);
      },
      setUniform2f: (name: string, a: number, b: number) => {
        if (!this.currentProgram) return;
        const loc = this.programs.getUniform(this.currentProgram, name);
        if (loc !== null) this.gl.uniform2f(loc, a, b);
      },
      drawFullscreenQuad: () => {
        this.quad.draw();
      },
    };
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssW = Math.max(1, Math.round(cssWidth));
    this.cssH = Math.max(1, Math.round(cssHeight));
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(_t: number, activeFx: readonly PunchFx[]): void {
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    if (activeFx.length === 0) return;
    const w = this.cssW;
    const h = this.cssH;
    for (const fx of activeFx) {
      const def = fxCatalog[fx.kind];
      if (!def) continue;
      def.drawWebGL2(this.drawCtx, fx, w, h);
    }
    this.currentProgram = null;
  }

  destroy(): void {
    this.quad.destroy();
    this.programs.destroy();
    // Don't drop the gl context itself — the canvas owns it; the FxOverlay
    // component will discard the canvas on unmount.
  }

  /**
   * Eagerly compile + link every registered FX fragment shader. Removes
   * the 1–50 ms cold-start the user would otherwise see on first FX
   * activation (compile cost varies wildly by GPU driver). Cache hits
   * after warmup are a Map lookup, microsecond-level.
   *
   * Idempotent: subsequent calls are no-ops because the cache is hit.
   */
  warmup(): void {
    for (const name of REGISTERED_FRAGMENTS) {
      try {
        this.programs.get(name);
      } catch (err) {
        // Don't let one bad shader poison the warmup of others. The
        // exception will resurface on actual use; until then the user
        // can still operate the editor.
        console.warn(`[fx] warmup: shader '${name}' failed to compile:`, err);
      }
    }
  }
}
