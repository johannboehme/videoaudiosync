// Toggle group with a sliding active indicator.
import { motion } from "framer-motion";
import { ReactNode } from "react";

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
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="label">{label}</span>}
      <div
        role="tablist"
        className={[
          "relative inline-flex items-stretch rounded-md p-1 gap-1",
          "bg-paper-deep shadow-pressed",
          fullWidth ? "w-full" : "",
        ].join(" ")}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(o.value)}
              className={[
                "relative flex-1 rounded-[5px] px-3 font-display tracking-label uppercase",
                "transition-colors",
                heightCls,
                active ? "text-paper-hi" : "text-ink-2 hover:text-ink",
              ].join(" ")}
              style={{ minWidth: 44 }}
            >
              {active && (
                <motion.span
                  layoutId="seg-active"
                  className="absolute inset-0 rounded-[5px] bg-ink shadow-emboss"
                  transition={{ duration: 0.18, ease: "easeOut" }}
                />
              )}
              <span className="relative z-10">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
