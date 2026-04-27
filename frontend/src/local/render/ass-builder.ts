/**
 * ASS (Advanced SubStation Alpha) subtitle generator. Direct 1:1 port of
 * `app/pipeline/ass.py` — pure string logic, no I/O. The output bytes
 * must match the Python builder exactly (verified by goldfile test).
 *
 * The renderer is JASSUB (libass-WASM), wired up in ass-renderer.ts.
 */

export type AnimationKind =
  | "fade"
  | "pop"
  | "slide_in"
  | "wobble"
  | "word_reveal"
  | "none";

export type ReactiveParam = "scale" | "y" | "rotate";

export interface TextOverlay {
  text: string;
  start: number;
  end: number;
  preset: string;
  x: number;
  y: number;
  animation: AnimationKind;
  reactiveBand?: string | null;
  reactiveParam: ReactiveParam;
  reactiveAmount: number;
}

export interface EnergyCurves {
  fps: number;
  frames: number;
  bands: Record<string, number[]>;
}

interface Preset {
  font: string;
  size: number;
  primary: string;
  outline: string;
  outline_w: number;
  shadow: number;
  bold: number;
  border_style?: number;
  back_color?: string;
}

export const PRESETS: Record<string, Preset> = {
  plain: {
    font: "Arial",
    size: 64,
    primary: "#FFFFFF",
    outline: "#000000",
    outline_w: 2,
    shadow: 0,
    bold: -1,
  },
  boxed: {
    font: "Arial Black",
    size: 56,
    primary: "#000000",
    outline: "#FFFFFF",
    outline_w: 0,
    shadow: 0,
    bold: -1,
    border_style: 4,
    back_color: "#FFFFFF",
  },
  outline: {
    font: "Arial Black",
    size: 64,
    primary: "#FFFFFF",
    outline: "#000000",
    outline_w: 4,
    shadow: 0,
    bold: -1,
  },
  glow: {
    font: "Arial Black",
    size: 64,
    primary: "#FFFFFF",
    outline: "#FF00FF",
    outline_w: 2,
    shadow: 4,
    bold: -1,
  },
  gradient: {
    font: "Arial Black",
    size: 72,
    primary: "#FFD93D",
    outline: "#6BCB77",
    outline_w: 3,
    shadow: 0,
    bold: -1,
  },
};

/**
 * Python-compatible banker's rounding (round-half-to-even). Used wherever
 * the goldfile depends on byte-exact match with Python's `round()`.
 * `Math.round` rounds half-up, which produces off-by-one differences on
 * boundaries.
 */
function bankerRound(x: number): number {
  if (x < 0) return -bankerRound(-x);
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // diff === 0.5 (within floating-point fuzz) → round to even
  return floor % 2 === 0 ? floor : floor + 1;
}

function ts(t: number): string {
  const tt = Math.max(0, t);
  const h = Math.floor(tt / 3600);
  const m = Math.floor((tt % 3600) / 60);
  const s = tt % 60;
  // f"{h}:{m:02d}:{s:05.2f}" — width 5, precision 2 → "00.00".."59.99"
  const sStr = s.toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sStr}`;
}

function assColor(rgb: string, alpha = 0): string {
  const c = rgb.replace(/^#/, "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  return `&H${hex(alpha)}${hex(b)}${hex(g)}${hex(r)}`;
}

function styleBlock(name: string, p: Preset): string {
  const primary = assColor(p.primary);
  const outline = assColor(p.outline);
  const back = assColor(p.back_color ?? "#000000");
  const borderStyle = p.border_style ?? 1;
  return (
    `Style: ${name},${p.font},${p.size},${primary},&H000000FF,${outline},${back},` +
    `${p.bold ?? 0},0,0,0,100,100,0,0,${borderStyle},${p.outline_w ?? 2},` +
    `${p.shadow ?? 0},5,30,30,30,1`
  );
}

function animationTags(o: TextOverlay, w: number, h: number): { open: string; body: string } {
  const px = bankerRound(o.x * w);
  const py = bankerRound(o.y * h);
  const durMs = Math.max(1, Math.floor((o.end - o.start) * 1000));
  const tags: string[] = [`\\pos(${px},${py})`, "\\an5"];

  if (o.animation === "fade") {
    tags.push("\\fad(200,200)");
  } else if (o.animation === "pop") {
    tags.push("\\fscx0\\fscy0\\t(0,150,\\fscx115\\fscy115)\\t(150,250,\\fscx100\\fscy100)\\fad(0,200)");
  } else if (o.animation === "slide_in") {
    tags.push(`\\move(${px - 200},${py},${px},${py},0,250)\\fad(0,200)`);
  } else if (o.animation === "wobble") {
    tags.push(`\\t(0,${durMs},\\frz3)\\t(${Math.floor(durMs / 2)},${durMs},\\frz-3)\\fad(150,150)`);
  }

  const open = "{" + tags.join("") + "}";

  if (o.animation === "word_reveal") {
    const words = o.text.split(/\s+/).filter((s) => s.length > 0);
    if (words.length === 0) return { open, body: o.text };
    const per = Math.floor(durMs / Math.max(1, words.length));
    const parts: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const t1 = i * per;
      const t2 = t1 + Math.min(120, per);
      parts.push(`{\\alpha&HFF&\\t(${t1},${t2},\\alpha&H00&)}${words[i]} `);
    }
    return { open, body: parts.join("").replace(/\s+$/, "") };
  }

  return { open, body: o.text };
}

function reactiveKeyframes(
  o: TextOverlay,
  energy: EnergyCurves | null | undefined,
  durationS: number,
): string {
  if (!energy || !o.reactiveBand) return "";
  const band = energy.bands[o.reactiveBand];
  if (!band || band.length === 0) return "";
  const energyFps = energy.fps || 30.0;
  const sampleFps = 12.0;
  const n = Math.max(1, bankerRound(durationS * sampleFps));
  const stepMs = Math.floor(1000 / sampleFps);

  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const tMs = i * stepMs;
    const tSeconds = o.start + i / sampleFps;
    const idx = bankerRound(tSeconds * energyFps);
    const v = idx >= 0 && idx < band.length ? band[idx] : 0;
    const amt = o.reactiveAmount * v;
    if (o.reactiveParam === "scale") {
      const scale = bankerRound(100 * (1 + amt));
      parts.push(`\\t(${tMs},${tMs + stepMs},\\fscx${scale}\\fscy${scale})`);
    } else if (o.reactiveParam === "y") {
      const dy = bankerRound(-amt * 30);
      parts.push(`\\t(${tMs},${tMs + stepMs},\\move(0,0,0,${dy}))`);
    } else if (o.reactiveParam === "rotate") {
      // Python `round(amt*8, 2)` uses banker's rounding at the 2nd decimal.
      const ang = bankerRound(amt * 8 * 100) / 100;
      parts.push(`\\t(${tMs},${tMs + stepMs},\\frz${ang})`);
    }
  }
  return parts.join("");
}

export function buildAss(
  overlays: TextOverlay[],
  width: number,
  height: number,
  energy?: EnergyCurves | null,
): string {
  const used = new Set<string>(
    overlays.filter((o) => PRESETS[o.preset]).map((o) => o.preset),
  );
  if (used.size === 0) used.add("plain");

  const header =
    "[Script Info]\n" +
    "ScriptType: v4.00+\n" +
    `PlayResX: ${width}\n` +
    `PlayResY: ${height}\n` +
    "WrapStyle: 0\n" +
    "ScaledBorderAndShadow: yes\n" +
    "\n" +
    "[V4+ Styles]\n" +
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, " +
    "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, " +
    "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n";

  // Python uses set iteration order, which is insertion order for sets backed
  // by dict (since 3.7 sets keep insertion order in CPython practice for small
  // sets). We use the overlay-encounter order to match.
  const stylesArr: string[] = [];
  for (const name of used) {
    stylesArr.push(styleBlock(name, PRESETS[name]));
  }
  const styles = stylesArr.join("\n");

  const eventsHeader =
    "\n\n[Events]\n" +
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";

  const lines: string[] = [];
  for (const o of overlays) {
    const preset = PRESETS[o.preset] ? o.preset : "plain";
    let { open } = animationTags(o, width, height);
    const { body } = animationTags(o, width, height);
    const reactive = reactiveKeyframes(o, energy ?? null, o.end - o.start);
    if (reactive) {
      open = open.slice(0, -1) + reactive + "}";
    }
    lines.push(
      `Dialogue: 0,${ts(o.start)},${ts(o.end)},${preset},,0,0,0,,${open}${body}`,
    );
  }

  return header + styles + eventsHeader + lines.join("\n") + "\n";
}

export function overlaysFromSpec(items: Array<Record<string, unknown>>): TextOverlay[] {
  const out: TextOverlay[] = [];
  for (const it of items) {
    if (it.type !== "text") continue;
    const reactive = (it.reactive as Record<string, unknown> | undefined) ?? {};
    out.push({
      text: String(it.text ?? ""),
      start: Number(it.start ?? 0),
      end: Number(it.end ?? 0),
      preset: String(it.preset ?? "plain"),
      x: Number(it.x ?? 0.5),
      y: Number(it.y ?? 0.85),
      animation: String(it.animation ?? "fade") as AnimationKind,
      reactiveBand: (reactive.band as string | null | undefined) ?? null,
      reactiveParam: String(reactive.param ?? "scale") as ReactiveParam,
      reactiveAmount: Number(reactive.amount ?? 0.3),
    });
  }
  return out;
}
