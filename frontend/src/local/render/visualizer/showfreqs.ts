/**
 * `showfreqs`-style frequency-bars visualizer.
 *
 * Re-uses our energy curves (precomputed STFT bands) so we don't re-FFT
 * per frame. We split the visible spectrum into N equal-width bars and
 * pick the closest energy-band value for each. Lightweight, looks like
 * an EQ at the bottom of the screen.
 */

import type { Visualizer } from "./types";
import type { EnergyCurves } from "../ass-builder";

export interface ShowfreqsOptions {
  energy: EnergyCurves;
  /** Names of the bands to show, left-to-right. Defaults to bass→highs. */
  bands?: string[];
  yPosition?: number;
  height?: number;
  color?: string;
  background?: string | null;
  /** Number of mini-bars per band (purely cosmetic — split each band visually). */
  barsPerBand?: number;
  gap?: number;
}

export class ShowfreqsVisualizer implements Visualizer {
  private energy: EnergyCurves;
  private bands: string[];
  private yPosition: number;
  private height: number;
  private color: string;
  private background: string | null;
  private barsPerBand: number;
  private gap: number;

  constructor(opts: ShowfreqsOptions) {
    this.energy = opts.energy;
    this.bands = opts.bands ?? ["bass", "low_mids", "mids", "highs"];
    this.yPosition = opts.yPosition ?? -1;
    this.height = opts.height ?? 80;
    this.color = opts.color ?? "rgba(31, 78, 140, 0.9)"; // TE cobalt
    this.background = opts.background ?? "rgba(255, 255, 255, 0.15)";
    this.barsPerBand = opts.barsPerBand ?? 6;
    this.gap = opts.gap ?? 2;
  }

  draw(ctx: OffscreenCanvasRenderingContext2D, t: number, w: number, h: number): void {
    const top = this.yPosition < 0 ? h - this.height - 16 : this.yPosition;
    if (this.background !== null) {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, top, w, this.height);
    }

    const fps = this.energy.fps || 30;
    const idx = Math.round(t * fps);
    const totalBars = this.bands.length * this.barsPerBand;
    const barWidth = (w - this.gap * (totalBars + 1)) / totalBars;
    if (barWidth <= 0) return;

    ctx.save();
    ctx.fillStyle = this.color;

    let bar = 0;
    for (const bandName of this.bands) {
      const series = this.energy.bands[bandName];
      let value = 0;
      if (series && series.length > 0) {
        const i = Math.max(0, Math.min(series.length - 1, idx));
        value = series[i];
      }
      // Within a band, fade the smaller bars so the EQ "ramps up".
      for (let j = 0; j < this.barsPerBand; j++) {
        const fade = (j + 1) / this.barsPerBand;
        const v = value * fade;
        const barH = Math.max(2, v * (this.height - 4));
        const x = this.gap + bar * (barWidth + this.gap);
        const y = top + this.height - 2 - barH;
        ctx.fillRect(x, y, barWidth, barH);
        bar++;
      }
    }
    ctx.restore();
  }
}
