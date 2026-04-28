/**
 * "+ Media" entry in the lane header column. Two variants:
 *   - SYNC  : runs the audio matcher → cam can use match-snap.
 *   - B-ROLL: skips the matcher → free placement, no candidates.
 *
 * Bound to addVideoToJob — appends a fresh cam to videos[] immediately
 * (lane appears) and prepares it in the background. The lane header for
 * the new cam will surface its own "syncing…" state until prep finishes.
 */
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { addVideoToJob } from "../../local/jobs";
import { useEditorStore } from "../store";

interface Props {
  jobId: string;
  /** Width of the lane-header column so this strip lines up with it. */
  width?: number;
}

const VIDEO_ACCEPT = "video/*";

export function AddMediaButton({ jobId, width = 156 }: Props) {
  const syncInputRef = useRef<HTMLInputElement>(null);
  const brollInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"sync" | "broll" | null>(null);
  const pushNotice = useEditorStore((s) => s.pushNotice);

  const onFiles = async (files: FileList | null, mode: "sync" | "broll") => {
    if (!files || files.length === 0) return;
    setBusy(mode);
    try {
      // Process sequentially — multiple parallel sync workers would compete
      // for cache/CPU and is rarely what the user wants for a quick add.
      for (const f of Array.from(files)) {
        await addVideoToJob(jobId, f, { skipSync: mode === "broll" });
      }
      pushNotice(
        files.length === 1
          ? `Added ${files[0].name}`
          : `Added ${files.length} clips`,
      );
    } catch (err) {
      pushNotice(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="flex flex-col gap-1 px-2 py-2 border-t border-rule/60 bg-paper-deep/40"
      style={{ width }}
    >
      <span className="font-display tracking-label uppercase text-[9px] text-ink-3 px-0.5">
        + Media
      </span>
      <AddKey
        label="SYNC CAM"
        sublabel="match audio"
        loading={busy === "sync"}
        disabled={busy !== null}
        testId="add-media-sync"
        onClick={() => syncInputRef.current?.click()}
      />
      <AddKey
        label="B-ROLL"
        sublabel="no audio match"
        loading={busy === "broll"}
        disabled={busy !== null}
        testId="add-media-broll"
        onClick={() => brollInputRef.current?.click()}
      />
      <input
        ref={syncInputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => onFiles(e.target.files, "sync")}
        data-testid="add-media-sync-input"
      />
      <input
        ref={brollInputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => onFiles(e.target.files, "broll")}
        data-testid="add-media-broll-input"
      />
    </div>
  );
}

interface KeyProps {
  label: string;
  sublabel: string;
  loading: boolean;
  disabled: boolean;
  testId: string;
  onClick: () => void;
}

function AddKey({ label, sublabel, loading, disabled, testId, onClick }: KeyProps) {
  return (
    <motion.button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className={[
        "relative w-full text-left rounded-md px-2.5 py-2 border border-rule",
        "bg-paper-hi hover:bg-paper-deep disabled:opacity-50 disabled:cursor-not-allowed",
        "shadow-emboss flex items-center gap-2",
      ].join(" ")}
      style={{
        background: loading
          ? "linear-gradient(180deg, #FFE3D6 0%, #FAF6EC 60%, #E8E1D0 100%)"
          : undefined,
      }}
    >
      <span className="text-base leading-none text-hot">+</span>
      <span className="flex flex-col min-w-0">
        <span className="font-display font-semibold tracking-label uppercase text-[10px] text-ink leading-none">
          {label}
        </span>
        <span className="font-mono text-[9px] text-ink-3 leading-none mt-0.5">
          {loading ? "preparing…" : sublabel}
        </span>
      </span>
      {loading && (
        <motion.span
          aria-hidden
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-block w-1.5 h-1.5 rounded-full bg-hot"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </motion.button>
  );
}
