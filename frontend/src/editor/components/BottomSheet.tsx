// Mobile bottom sheet — hardware-drawer feel, snap heights via framer-motion.
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { ReactNode, useState } from "react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: ReactNode;
}

export function BottomSheet({ open, onOpenChange, children }: Props) {
  const [snap, setSnap] = useState<"half" | "full">("half");
  const heights = { half: "55vh", full: "92vh" };

  function onDragEnd(_e: unknown, info: PanInfo) {
    if (info.offset.y > 80) {
      if (snap === "full") setSnap("half");
      else onOpenChange(false);
    } else if (info.offset.y < -80) {
      setSnap("full");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-sunken/40 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            role="dialog"
            className="fixed inset-x-0 bottom-0 z-50 bg-paper-hi rounded-t-xl border-t border-rule shadow-[0_-12px_32px_rgba(0,0,0,0.18)] overflow-hidden"
            initial={{ y: "100%" }}
            animate={{ y: 0, height: heights[snap] }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.3 }}
            onDragEnd={onDragEnd}
          >
            <div className="w-full flex items-center justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
              <span className="block w-12 h-1.5 rounded-full bg-rule" />
            </div>
            <div className="overflow-auto h-full pb-12">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
