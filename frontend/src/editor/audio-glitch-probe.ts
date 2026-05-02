/**
 * Opt-in audio-glitch detector. Loads `public/loop-glitch-probe.worklet.js`
 * into a given AudioContext and connects it as a parallel tap on a
 * source node — does NOT alter the audible output.
 *
 * Activation:
 *   - URL query `?perf=1`, OR
 *   - `localStorage.tk1Probe = "1"`, OR
 *   - `window.__tk1ProbeGlitches = true` set before the editor mounts.
 *
 * On each detected click the worklet posts to `window.__loopGlitches`
 * (which the probe ensures exists). Bench scripts read this array.
 */

export interface GlitchEvent {
  ctxTime: number;
  magnitude: number;
  channel: number;
}

declare global {
  interface Window {
    __loopGlitches?: GlitchEvent[];
    __tk1ProbeGlitches?: boolean;
  }
}

export function isProbeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__tk1ProbeGlitches === true) return true;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("perf") === "1") return true;
  } catch {
    /* SSR / sandbox without window.location */
  }
  try {
    if (window.localStorage.getItem("tk1Probe") === "1") return true;
  } catch {
    /* localStorage unavailable */
  }
  return false;
}

/**
 * Load the worklet module + create a probe node. Returns the node so
 * the caller can connect it (parallel tap from masterGain). The node
 * has 1 input, 0 outputs — it's a pure observer.
 */
export async function attachLoopGlitchProbe(
  ctx: AudioContext,
  source: AudioNode,
): Promise<AudioWorkletNode> {
  if (typeof window !== "undefined") {
    if (!Array.isArray(window.__loopGlitches)) window.__loopGlitches = [];
  }
  await ctx.audioWorklet.addModule("/loop-glitch-probe.worklet.js");
  const node = new AudioWorkletNode(ctx, "loop-glitch-probe", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  node.port.onmessage = (ev) => {
    const w = window as unknown as { __loopGlitches?: GlitchEvent[] };
    if (w.__loopGlitches) w.__loopGlitches.push(ev.data as GlitchEvent);
  };
  source.connect(node);
  return node;
}
