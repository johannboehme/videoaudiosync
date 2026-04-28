/**
 * useAutoPersist — debounced save of editor state into the LocalJob row.
 *
 * What gets persisted (300 ms after the last change):
 *  - per-cam: `syncOverrideMs`, `startOffsetS`, `selectedCandidateIdx`
 *  - `cuts[]` (multi-cam markers)
 *  - `trim` { in, out }
 *  - `bpm` (value + manualOverride flag — survives reload so the user
 *    doesn't lose their override after a refresh)
 *  - `ui` { snapMode, lanesLocked }
 *
 * Skipped during the initial load — we only fire when the user actually
 * changes something. Wiring point: mount once in the editor shell after
 * `loadJob()` resolved.
 */
import { useEffect } from "react";
import { useEditorStore } from "./store";
import { jobsDb, type LocalJob, type VideoAsset } from "../storage/jobs-db";

const DEBOUNCE_MS = 300;

/** Pure helper: derive the persist-patch for `updateJob` from an editor
 *  state snapshot and the current LocalJob row. Exported for testing. */
export function buildPersistPatch(
  s: ReturnType<typeof useEditorStore.getState>,
  job: LocalJob,
): Partial<LocalJob> {
  const updatedVideos: VideoAsset[] = (job.videos ?? []).map((v) => {
    const clip = s.clips.find((c) => c.id === v.id);
    if (!clip) return v;
    return {
      ...v,
      syncOverrideMs: clip.syncOverrideMs,
      startOffsetS: clip.startOffsetS,
      selectedCandidateIdx: clip.selectedCandidateIdx,
    };
  });

  const bpm = s.jobMeta?.bpm
    ? {
        value: s.jobMeta.bpm.value,
        confidence: s.jobMeta.bpm.confidence,
        phase: s.jobMeta.bpm.phase,
        manualOverride: s.jobMeta.bpm.manualOverride,
      }
    : undefined;

  return {
    videos: updatedVideos,
    cuts: s.cuts,
    bpm,
    ui: { snapMode: s.ui.snapMode, lanesLocked: s.ui.lanesLocked },
    trim: { in: s.trim.in, out: s.trim.out },
  };
}

export function useAutoPersist(jobId: string | null): void {
  useEffect(() => {
    if (!jobId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let firstFire = true;

    const flush = async () => {
      timer = null;
      if (cancelled) return;
      const s = useEditorStore.getState();
      if (!s.jobMeta || s.jobMeta.id !== jobId) return;

      try {
        const job = await jobsDb.getJob(jobId);
        if (!job || cancelled) return;
        await jobsDb.updateJob(jobId, buildPersistPatch(s, job));
      } catch (err) {
        // Non-fatal: a failed write means we'll retry on the next change.
        console.warn("auto-persist failed:", err);
      }
    };

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    };

    const unsub = useEditorStore.subscribe((state, prev) => {
      // Skip while the store hasn't been loaded yet for this jobId.
      if (!state.jobMeta || state.jobMeta.id !== jobId) return;

      // Skip the very first transition into "loaded" — that's loadJob()
      // hydrating the store from IDB, not a user edit.
      if (firstFire) {
        firstFire = false;
        return;
      }

      if (
        state.clips !== prev.clips ||
        state.cuts !== prev.cuts ||
        state.trim !== prev.trim ||
        state.ui.snapMode !== prev.ui.snapMode ||
        state.ui.lanesLocked !== prev.ui.lanesLocked ||
        state.jobMeta.bpm !== prev.jobMeta?.bpm
      ) {
        schedule();
      }
    });

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unsub();
    };
  }, [jobId]);
}
