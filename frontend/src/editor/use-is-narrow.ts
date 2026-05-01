// Shared "viewport below the Tailwind sm breakpoint (640 px)" hook.
// Used by the Timeline lane headers and the FX hardware panel to switch
// to compact mobile layouts. SSR-safe — returns false server-side, then
// re-evaluates on first client effect tick.
import { useEffect, useState } from "react";

const MQ = "(max-width: 639px)";

export function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MQ).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(MQ);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    const legacy = mql as unknown as {
      addListener?: (cb: (ev: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (ev: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, []);
  return narrow;
}
