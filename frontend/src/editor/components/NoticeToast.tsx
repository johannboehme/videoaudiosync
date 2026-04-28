/**
 * Floating one-shot toast wired to `editorStore.notice`. Auto-dismisses
 * after a short window so the editor stays uncluttered. Multiple pushes
 * in quick succession reset the timer because each push rolls a new key
 * and AnimatePresence treats it as a new element.
 */
import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEditorStore } from "../store";

const VISIBLE_MS = 2400;

export function NoticeToast() {
  const notice = useEditorStore((s) => s.notice);
  const dismiss = useEditorStore((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismiss, VISIBLE_MS);
    return () => clearTimeout(t);
  }, [notice, dismiss]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <AnimatePresence mode="wait">
        {notice && (
          <motion.div
            key={notice.key}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={[
              "pointer-events-auto bg-sunken text-paper-hi rounded-md",
              "px-4 py-2 shadow-lcd font-mono text-xs tracking-tight",
              "border border-black/40",
            ].join(" ")}
            data-testid="editor-notice"
          >
            {notice.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
