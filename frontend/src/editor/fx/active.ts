import type { PunchFx } from "./types";

/**
 * Returns the FX active at master-time `t`, in the input's stable order.
 * `inS` is inclusive, `outS` exclusive — same convention as the cuts /
 * cam-range resolver in `cuts.ts`.
 */
export function activeFxAt(
  fx: readonly PunchFx[],
  t: number,
): PunchFx[] {
  const out: PunchFx[] = [];
  for (const f of fx) {
    if (f.inS <= t && t < f.outS) out.push(f);
  }
  return out;
}
