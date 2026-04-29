/**
 * Punch-In Effect (P-FX) — visueller Effekt mit In/Out-Punkten auf der
 * Master-Timeline. Anders als Cuts (exklusive Cam-Switches) überlappen
 * P-FX frei und stapeln sich; ein Pixel kann mehreren FX angehören.
 *
 * V1: Vignette only. Weitere Kinds folgen iterativ — neue Kind = ein
 * Eintrag in `catalog.ts` plus eine `drawCanvas2D`/`drawWebGL2`-Pair.
 */

export type FxKind = "vignette";

export interface PunchFx {
  id: string;
  kind: FxKind;
  /** Master-time inclusive start. */
  inS: number;
  /** Master-time exclusive end. */
  outS: number;
  /** Kind-spezifische Parameter. Optional — falls fehlend, nutzen die
   *  Renderer die `defaultParams` aus der FxDefinition. */
  params?: Record<string, number>;
}

/** Minimal-Snapshot, der einer FxDefinition reicht, um zu rendern.
 *  Tests können das ohne den Catalog-Lookup direkt aufrufen. */
export interface FxRenderInput {
  fx: PunchFx;
  /** Master-time. Renderer normalisieren ggf. auf fx-lokal. */
  t: number;
  /** Output-Dimensionen in Pixeln. */
  w: number;
  h: number;
}
