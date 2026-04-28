/**
 * "+ Add" entry for the editor: one chunky button + an inline MATCH AUDIO
 * toggle. The file picker accepts video and image; the component
 * inspects each file's type and routes accordingly:
 *
 *   - image/*  → addImageToJob (the MATCH toggle is irrelevant)
 *   - video/*  → addVideoToJob with skipSync = !matchAudio
 *
 * One-line layout — sits outside the scrollable lane stack so adding
 * cams doesn't push the timeline into the preview area.
 */
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { addImageToJob, addVideoToJob } from "../../local/jobs";
import { useEditorStore } from "../store";

interface Props {
  jobId: string;
}

const ACCEPT = "video/*,image/*";

export function AddMediaButton({ jobId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [matchAudio, setMatchAudio] = useState(true);
  const pushNotice = useEditorStore((s) => s.pushNotice);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      // Sequential — multiple parallel sync workers would compete for
      // cache + CPU. The per-file branch dispatches to image/video.
      let videoCount = 0;
      let imageCount = 0;
      for (const f of Array.from(files)) {
        if (f.type.startsWith("image/")) {
          await addImageToJob(jobId, f);
          imageCount++;
        } else {
          // Treat anything non-image as video. Browsers sometimes report
          // video/* with no specific subtype on mobile pickers.
          await addVideoToJob(jobId, f, { skipSync: !matchAudio });
          videoCount++;
        }
      }
      const parts: string[] = [];
      if (videoCount > 0) {
        parts.push(`${videoCount} ${videoCount === 1 ? "clip" : "clips"}`);
      }
      if (imageCount > 0) {
        parts.push(`${imageCount} ${imageCount === 1 ? "image" : "images"}`);
      }
      pushNotice(`Added ${parts.join(" + ")}`);
    } catch (err) {
      pushNotice(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 px-2"
      data-testid="add-media-bar"
    >
      <MatchToggle
        on={matchAudio}
        onChange={setMatchAudio}
        disabled={busy}
      />
      <motion.button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        whileTap={{ scale: 0.94 }}
        aria-label={busy ? "Adding media" : "Add media (video or image)"}
        title={busy ? "Adding…" : "Add media (video or image)"}
        className={[
          "inline-flex items-center justify-center w-6 h-6 rounded-md",
          "bg-paper-hi border border-rule shadow-emboss",
          "hover:bg-paper-deep disabled:opacity-50 disabled:cursor-not-allowed",
          "font-mono leading-none",
        ].join(" ")}
        data-testid="add-media-button"
      >
        <span className="text-sm text-hot">{busy ? "·" : "+"}</span>
      </motion.button>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => onFiles(e.target.files)}
        data-testid="add-media-input"
      />
    </div>
  );
}

function MatchToggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Match audio for incoming video clips"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={[
        "inline-flex items-center gap-1 h-6 px-1.5 rounded select-none",
        "border transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        on
          ? "border-hot bg-hot/10 text-ink"
          : "border-rule bg-paper-deep text-ink-3",
      ].join(" ")}
      data-testid="add-media-match-toggle"
      title={
        on
          ? "Incoming videos will be audio-matched (ignored for images)"
          : "Incoming videos go in unsynced — place them by hand"
      }
    >
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{
          background: on ? "#FF5722" : "#9A8F80",
          boxShadow: on ? "0 0 4px rgba(255,87,34,0.9)" : "none",
        }}
      />
      <span className="font-display tracking-label uppercase text-[9px] font-semibold">
        match
      </span>
    </button>
  );
}
