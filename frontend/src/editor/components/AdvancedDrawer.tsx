// Collapsible drawer for the advanced export controls. Closed by default
// because most users will pick a preset + quality and leave the panel.
import { motion, AnimatePresence } from "framer-motion";
import { ReactNode, useState } from "react";

interface Props {
  /** Initial expanded state. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function AdvancedDrawer({ defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 self-start font-display tracking-label uppercase text-xs text-ink-2 hover:text-ink"
      >
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="inline-block leading-none"
        >
          ▸
        </motion.span>
        Advanced
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 rounded-md bg-paper-deep p-3 shadow-pressed">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
