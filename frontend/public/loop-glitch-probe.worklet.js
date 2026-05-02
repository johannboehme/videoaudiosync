/* eslint-disable no-undef */
/**
 * AudioWorklet that monitors the master audio output for gapless-loop
 * regressions. Runs sample-accurate on the audio render thread; flags
 * any sample-to-sample amplitude jump above THRESHOLD as a likely click.
 *
 * The two-`<audio>` ping-pong + WebAudio crossfade should produce
 * NO events here. If a wrap mechanism regressed back to seek-on-active,
 * the click shows up as a fat delta around the wrap timestamp.
 *
 * Posts `{ ctxTime, magnitude, channel }` per detection. Consumer
 * (frontend/src/editor/audio-glitch-probe.ts) wires this to
 * `window.__loopGlitches` for the bench harness to read.
 */

const THRESHOLD = 0.3; // ≈ -10 dBFS sample-to-sample step

class LoopGlitchProbe extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Last sample seen per channel — used to span quantum boundaries
     *  so a glitch at the boundary isn't missed. */
    this.last = [0, 0];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    for (let ch = 0; ch < input.length && ch < this.last.length; ch++) {
      const data = input[ch];
      let prev = this.last[ch];
      let maxDelta = 0;
      for (let i = 0; i < data.length; i++) {
        const d = Math.abs(data[i] - prev);
        if (d > maxDelta) maxDelta = d;
        prev = data[i];
      }
      this.last[ch] = prev;
      if (maxDelta > THRESHOLD) {
        this.port.postMessage({
          ctxTime: currentTime,
          magnitude: maxDelta,
          channel: ch,
        });
      }
    }
    return true;
  }
}

registerProcessor("loop-glitch-probe", LoopGlitchProbe);
