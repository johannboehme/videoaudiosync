// Toggle group with a sliding active indicator.
//
// Single always-mounted indicator slides between the actual button rects
// using a measured offset/width pair. (Earlier version used Framer's
// `layoutId` shared-layout animation with `{active && <motion.span>}` —
// that unmount/mount-races on switch and produced a single-frame "no
// indicator visible" gap which left the active label as white text on a
// light background.)
import { motion } from "framer-motion";
import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface Option<V extends string> {
  value: V;
  label: ReactNode;
}

interface Props<V extends string> {
  value: V;
  options: Option<V>[];
  onChange: (v: V) => void;
  size?: "sm" | "md";
  fullWidth?: boolean;
  label?: string;
}

export function SegmentedControl<V extends string>({
  value,
  options,
  onChange,
  size = "md",
  fullWidth = false,
  label,
}: Props<V>) {
  const heightCls = size === "sm" ? "h-9 text-xs" : "h-11 text-sm";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(
    null,
  );

  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const measure = useCallback(() => {
    const c = containerRef.current;
    const btn = buttonRefs.current[activeIndex];
    if (!c || !btn) return;
    const cb = c.getBoundingClientRect();
    const bb = btn.getBoundingClientRect();
    setPill({ left: bb.left - cb.left, width: bb.width });
  }, [activeIndex]);

  useLayoutEffect(() => {
    measure();
  }, [measure, options.length]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    if (typeof ResizeObserver === "undefined") {
      // jsdom & older browsers — fall back to a window-resize listener.
      const onResize = () => measure();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(c);
    for (const b of buttonRefs.current) if (b) ro.observe(b);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="label">{label}</span>}
      <div
        ref={containerRef}
        role="tablist"
        className={[
          "relative inline-flex items-stretch rounded-md p-1 gap-1",
          "bg-paper-deep shadow-pressed",
          fullWidth ? "w-full" : "",
        ].join(" ")}
      >
        {pill && (
          <motion.span
            aria-hidden
            className="absolute rounded-[5px] bg-ink shadow-emboss pointer-events-none"
            style={{ top: 4, bottom: 4 }}
            initial={false}
            animate={{ left: pill.left, width: pill.width }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        )}
        {options.map((o, i) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                buttonRefs.current[i] = el;
              }}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(o.value)}
              className={[
                "relative z-10 flex-1 rounded-[5px] px-3 font-display tracking-label uppercase",
                "transition-colors",
                heightCls,
                active ? "text-paper-hi" : "text-ink-2 hover:text-ink",
              ].join(" ")}
              style={{ minWidth: 44 }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
