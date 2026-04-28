import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EditorShell } from "../editor/components/EditorShell";
import { ExportPanel } from "../editor/components/ExportPanel";
import { NoticeToast } from "../editor/components/NoticeToast";
import { OverlaysPanel } from "../editor/components/OverlaysPanel";
import { SidePanel } from "../editor/components/SidePanel";
import { SyncTuner } from "../editor/components/SyncTuner";
import { Timeline } from "../editor/components/Timeline";
import { TransportBar } from "../editor/components/TransportBar";
import { TrimPanel } from "../editor/components/TrimPanel";
import { MultiCamPreview } from "../editor/components/MultiCamPreview";
import { useEditorStore } from "../editor/store";
import {
  jobEvents,
  jobsDb,
  removeCamFromJob,
  resolveJobAssetUrl,
  resolveCamAssetUrl,
  runEditRender,
  type LocalJob,
  type EditSpecLocal,
} from "../local/jobs";
import { isVideoAsset, type MediaAsset } from "../storage/jobs-db";
import { decodeAudioToMonoPcm } from "../local/codec";
import { computeWaveformPeaks } from "../local/waveform-peaks";
import { exportSpecToRenderOpts } from "../editor/exportPresets";
import { opfs } from "../storage/opfs";
import type { ClipInit } from "../editor/store";
import { useAutoPersist } from "../editor/useAutoPersist";
import {
  getCachedAnalysis,
  getOrComputeAnalysis,
} from "../local/render/audio-analysis";

interface WaveformData {
  peaks: [number, number][];
  duration: number;
}

/**
 * Translate a persisted MediaAsset into the ClipInit the editor store
 * understands. Used both at first load (loadJob) and when videos[]
 * grows (live "+ Media" path — addClip / updateClip).
 *
 * For video assets this prefers the matcher's full candidates list and
 * falls back to a synthetic single-candidate built from the legacy
 * primary offset. Image assets pass through their durationS verbatim.
 */
function assetToClipInit(v: MediaAsset): ClipInit {
  if (v.kind === "image") {
    return {
      kind: "image",
      id: v.id,
      filename: v.filename,
      color: v.color,
      durationS: v.durationS,
      startOffsetS: v.startOffsetS,
    };
  }
  const persistedCandidates = v.sync?.candidates?.map((c) => ({
    offsetMs: c.offsetMs,
    confidence: c.confidence,
    overlapFrames: c.overlapFrames,
  }));
  const fallbackCandidates =
    v.sync && (!persistedCandidates || persistedCandidates.length === 0)
      ? [
          {
            offsetMs: v.sync.offsetMs,
            confidence: v.sync.confidence,
            overlapFrames: 0,
          },
        ]
      : undefined;
  return {
    id: v.id,
    filename: v.filename,
    color: v.color,
    sourceDurationS: v.durationS ?? 0,
    syncOffsetMs: v.sync?.offsetMs ?? 0,
    syncOverrideMs: v.syncOverrideMs,
    startOffsetS: v.startOffsetS,
    driftRatio: v.sync?.driftRatio ?? 1,
    candidates: persistedCandidates ?? fallbackCandidates,
    selectedCandidateIdx: v.selectedCandidateIdx,
  };
}

/** Per-cam OPFS URLs resolved when the editor opens. Keyed by camId. */
export interface CamAssets {
  videoUrl: string;
  framesUrl: string | null;
}

interface EditorAssets {
  /** cam-1's video URL — kept for the existing single-source preview path. */
  videoUrl: string;
  audioUrl: string;
  wave: WaveformData | null;
  framesUrl: string | null;
  /** All cams' assets, keyed by camId, for the multi-lane timeline + future
   *  multi-cam preview. cam-1's videoUrl here equals the top-level videoUrl. */
  cams: Record<string, CamAssets>;
}

export default function Editor() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const loadJob = useEditorStore((s) => s.loadJob);
  const reset = useEditorStore((s) => s.reset);
  const buildEditSpec = useEditorStore((s) => s.buildEditSpec);

  const [job, setJob] = useState<LocalJob | null>(null);
  const [assets, setAssets] = useState<EditorAssets | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Global hotkeys 1..9 = live-cut to that cam's lane (vintage vision-mixer
  // pushbuttons). Cassette-recorder model:
  //   * keydown — armed cut at the press time, plus a paint-promotion
  //     timer. If the cam was already on PROGRAM at this t, addCut is a
  //     no-op (lives in the store guard). One hold at a time — additional
  //     keydowns while one is active are ignored, so the user can't tangle
  //     two simultaneous overdubs.
  //   * after 500 ms wallclock — paint-mode lights up, the live overwrite
  //     range visualises in the PROGRAM strip.
  //   * keyup —
  //     - tap (no paint reached): keep the immediate cut.
  //     - paint: applyHoldRelease drops cuts inside (start, release], adds
  //       a trailing resume-cut to whichever cam was originally there.
  //   * Esc during hold — cancelHold reverts cuts to the snapshot taken
  //     at press, dropping the immediate cut AND any paint.
  useEffect(() => {
    // Which key fired the active hold. Single-active-hold model — second
    // keydown while one is active is ignored.
    let activeKey: string | null = null;
    let promoteTimer: ReturnType<typeof setTimeout> | null = null;
    const PAINT_PROMOTION_MS = 500;

    function isTypingTarget(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    }

    function clearPromoteTimer() {
      if (promoteTimer !== null) {
        clearTimeout(promoteTimer);
        promoteTimer = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      const s = useEditorStore.getState();

      // Esc cancels an active hold (revert to pre-press state).
      if (e.key === "Escape" && s.holdGesture) {
        e.preventDefault();
        clearPromoteTimer();
        activeKey = null;
        s.cancelHold();
        return;
      }

      const n = parseInt(e.key, 10);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      // Single-active-hold: a new TAKE while another is held is ignored.
      if (s.holdGesture) {
        e.preventDefault();
        return;
      }
      const clip = s.clips[n - 1];
      if (!clip) return;
      e.preventDefault();
      const startS = s.snapMasterTime(s.playback.currentTime);
      // beginHoldGesture must happen BEFORE addCut, so the snapshot
      // captures cuts as they were *before* the immediate tap-cut lands.
      s.beginHoldGesture(clip.id, startS);
      s.addCut({ atTimeS: startS, camId: clip.id });
      activeKey = e.key;
      promoteTimer = setTimeout(() => {
        useEditorStore.getState().promoteHoldToPaint();
      }, PAINT_PROMOTION_MS);
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key !== activeKey) return;
      activeKey = null;
      clearPromoteTimer();
      const s = useEditorStore.getState();
      const hold = s.holdGesture;
      if (!hold) return;
      const endS = s.snapMasterTime(s.playback.currentTime);
      if (hold.painting) {
        // Paint-mode commit: drop everything in (start, end], add the
        // trailing resume-cut (handled by applyHoldRelease).
        s.applyHoldRelease(hold.camId, hold.startS, endS, hold.priorCuts);
      }
      // Else: tap. The immediate cut from keydown stays in place.
      s.endHoldGesture();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      clearPromoteTimer();
    };
  }, []);

  // Auto-persist editor state (cuts, cam-positions, trim, BPM, snap-mode)
  // into the LocalJob record on every change, debounced. Replaces the
  // older cuts-only writeback so changes the user makes round-trip across
  // refreshes — see useAutoPersist for the full field list.
  useAutoPersist(id);

  // Q-hold-to-quantize: hold Q → ghost-preview off-grid markers snapped
  // to the active grid. Release Q → commit. Esc during hold → cancel.
  // The preview lives in the store as `quantizePreview` and the timeline
  // canvas reads it to render ghost ticks.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || ae?.isContentEditable) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useEditorStore.getState();
      if (e.key === "q" || e.key === "Q") {
        if (e.repeat) return;
        e.preventDefault();
        s.buildAndStartQuantizePreview();
      } else if (e.key === "Escape" && s.quantizePreview !== null) {
        e.preventDefault();
        s.cancelQuantizePreview();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "q" || e.key === "Q") {
        const s = useEditorStore.getState();
        if (s.quantizePreview !== null) s.commitQuantizePreview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // While Q is held the user can change the snap-mode (clicking a button
  // in the SnapModeButtons row). The preview should refresh to show the
  // new grid. Subscribe and rebuild whenever snapMode changes during a
  // live preview.
  useEffect(() => {
    const unsub = useEditorStore.subscribe(
      (s) => s.ui.snapMode,
      () => {
        const s = useEditorStore.getState();
        if (s.quantizePreview !== null) {
          s.buildAndStartQuantizePreview();
        }
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let audioUrl: string | null = null;
    // Per-cam URLs are tracked in a single map so cleanup can revoke them all.
    const camUrls: Record<string, CamAssets> = {};

    (async () => {
      const j = await jobsDb.getJob(id);
      if (cancelled || !j) return;
      setJob(j);

      // Resolve audio (singular master).
      audioUrl = await resolveJobAssetUrl(id, "audio");
      if (cancelled || !audioUrl) return;

      // Resolve every cam's video + frames URL up front. The timeline needs
      // each cam's frames; the preview will switch between videos in Schritt 8.
      const videos = j.videos ?? [];
      for (const cam of videos) {
        const videoUrl = await resolveCamAssetUrl(id, cam.id, "video");
        const framesUrl = await resolveCamAssetUrl(id, cam.id, "frames");
        if (cancelled) return;
        if (videoUrl) {
          camUrls[cam.id] = { videoUrl, framesUrl };
        }
      }
      const cam1Url = camUrls[videos[0]?.id]?.videoUrl;
      const cam1Frames = camUrls[videos[0]?.id]?.framesUrl ?? null;
      if (cancelled || !cam1Url) return;

      // Compute waveform peaks locally from the studio audio. Cache the
      // decoded PCM so the audio-analysis fallback below can reuse it
      // without a second decode pass.
      let wave: WaveformData | null = null;
      let studioPcm: Float32Array | null = null;
      let studioSampleRate = 22050;
      try {
        // Read the audio handle directly from OPFS so we don't fetch+blob it
        // a second time over an object URL.
        const ext = audioUrl.split("?")[0].split(".").pop() || "wav";
        let decodeSrc: Blob;
        try {
          decodeSrc = await opfs.readFile(`jobs/${id}/audio.${ext}`);
        } catch {
          decodeSrc = await fetch(audioUrl).then((r) => r.blob());
        }
        const decoded = await decodeAudioToMonoPcm(decodeSrc, 22050);
        studioPcm = decoded.pcm;
        studioSampleRate = decoded.sampleRate;
        const peaks = computeWaveformPeaks(decoded.pcm, decoded.sampleRate, 1500);
        wave = { peaks: peaks.peaks, duration: peaks.duration };
      } catch {
        // Non-fatal — Timeline degrades gracefully without peaks.
      }
      if (cancelled) return;

      setAssets({
        videoUrl: cam1Url,
        audioUrl,
        wave,
        framesUrl: cam1Frames,
        cams: camUrls,
      });

      const clipInits: ClipInit[] = videos.map((v) => assetToClipInit(v));

      // Pull cached audio analysis (BPM / beats / downbeats). If the
      // cache is empty (older job, analysis failed in runSync, version
      // bump) and we have decoded studio PCM in hand, compute it now —
      // otherwise the BPM readout reads "———" and grid-snap modes stay
      // disabled forever for this job.
      let analysis = await getCachedAnalysis(j.id).catch(() => undefined);
      if (!analysis && studioPcm) {
        try {
          analysis = await getOrComputeAnalysis(
            j.id,
            studioPcm,
            studioSampleRate,
          );
        } catch {
          // ignore — leaves BPM null
        }
      }
      if (cancelled) return;
      const persistedBpm = j.bpm;
      const detectedTempo = analysis?.tempo;
      const detectedBpmInfo = detectedTempo
        ? {
            value: detectedTempo.bpm,
            confidence: detectedTempo.confidence,
            phase: detectedTempo.phase,
            manualOverride: false,
          }
        : null;
      // Precedence: a manually-overridden BPM wins (user knows what they
      // want, even after the algorithm changes). Otherwise prefer the
      // fresh detection — auto-persist saves the auto-detected value back
      // into j.bpm too, so an old persisted value would otherwise stick
      // forever once the analysis algorithm changes.
      const bpmInfo =
        persistedBpm?.manualOverride
          ? {
              value: persistedBpm.value,
              confidence: persistedBpm.confidence,
              phase: persistedBpm.phase,
              manualOverride: true,
            }
          : (detectedBpmInfo ?? (persistedBpm
              ? {
                  value: persistedBpm.value,
                  confidence: persistedBpm.confidence,
                  phase: persistedBpm.phase,
                  manualOverride: false,
                }
              : null));

      loadJob(
        {
          id: j.id,
          fps: 30,
          // Master timeline length = master-audio length. Skip-to-out
          // and trim defaults are anchored here, not on cam-1's media
          // duration (which would put trim.out somewhere mid-audio if
          // cam-1 was shorter than the studio track).
          duration: wave?.duration ?? j.durationS ?? 0,
          width: j.width ?? 1920,
          height: j.height ?? 1080,
          algoOffsetMs: j.sync?.offsetMs ?? 0,
          driftRatio: j.sync?.driftRatio ?? 1,
          bpm: bpmInfo,
          detectedBpm: detectedBpmInfo,
          beats: analysis?.beats ?? [],
          downbeats: analysis?.downbeats ?? [],
        },
        {
          lastSyncOverrideMs: null,
          clips: clipInits,
          cuts: j.cuts ?? [],
        },
      );

      // Restore persisted UI state (snap-mode, lanesLocked) and trim. Must
      // happen AFTER loadJob, since loadJob resets ui to defaults.
      if (j.ui) {
        const store = useEditorStore.getState();
        if (j.ui.snapMode) store.setSnapMode(j.ui.snapMode);
        if (typeof j.ui.lanesLocked === "boolean") {
          store.setLanesLocked(j.ui.lanesLocked);
        }
      }
      if (j.trim) {
        // Clamp persisted trim to the current audio range — older jobs
        // were saved with trim values based on the cam-1 media-duration
        // (back when cam-1 was the master clock); under the master-time
        // architecture those are no longer meaningful and would put
        // skip-to-end somewhere mid-audio.
        const audioMax = wave?.duration ?? j.durationS ?? 0;
        const tin = Math.max(0, Math.min(j.trim.in, audioMax));
        const tout = Math.max(tin, Math.min(j.trim.out, audioMax));
        useEditorStore.getState().setTrim({ in: tin, out: tout });
      }
    })().catch((e) => {
      if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load job");
    });

    return () => {
      cancelled = true;
      reset();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      for (const { videoUrl, framesUrl } of Object.values(camUrls)) {
        URL.revokeObjectURL(videoUrl);
        if (framesUrl) URL.revokeObjectURL(framesUrl);
      }
    };
  }, [id, loadJob, reset]);

  // Live job updates — when addVideoToJob / addImageToJob land a new
  // asset, surface it in the editor without re-running the full loadJob
  // (which would reset trim/zoom/snap-mode/playback).
  useEffect(() => {
    if (!id) return;
    const newCamUrls: { videoUrl: string; framesUrl: string | null }[] = [];
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ jobId: string; job: LocalJob }>
      ).detail;
      if (detail.jobId !== id) return;
      const updated = detail.job;
      setJob(updated);
      const store = useEditorStore.getState();
      const known = new Set(store.clips.map((c) => c.id));
      const videos = updated.videos ?? [];

      // Drop store clips for assets that are no longer in videos[] (e.g.
      // user just deleted a cam via the lane-header ×).
      for (const c of store.clips) {
        if (!videos.find((v) => v.id === c.id)) {
          store.removeClip(c.id);
        }
      }
      // Refresh the "preparing" set every event — a cam is preparing when
      // its frames-strip hasn't been written yet (the prep pipeline writes
      // it last). For image cams (no prep) the set never includes them.
      store.setPreparingCamIds(
        videos
          .filter((v) => isVideoAsset(v) && !v.framesPath)
          .map((v) => v.id),
      );

      for (const asset of videos) {
        const init = assetToClipInit(asset);
        if (known.has(asset.id)) {
          // Existing cam — refresh it in case sync results just arrived.
          store.updateClip(init);
          // The thumbnail strip lands AFTER the first event (runCamPrep
          // writes framesPath at the end). If we don't have a framesUrl
          // for this cam yet but the asset now has one, resolve it.
          void (async () => {
            const cur = (await jobsDb.getJob(id))?.videos?.find(
              (v) => v.id === asset.id,
            );
            if (!cur || cur.kind === "image") return;
            if (!cur.framesPath) return;
            // Already have a frames URL? skip.
            // We can't read assets directly here (closure capture); do
            // best-effort by checking whether resolveCamAssetUrl returns
            // something new and updating regardless — duplicate URL
            // generation is harmless, just a minor leak that the unmount
            // cleanup catches.
            const framesUrl = await resolveCamAssetUrl(id, asset.id, "frames");
            if (!framesUrl) return;
            newCamUrls.push({ videoUrl: "", framesUrl });
            setAssets((prev) => {
              if (!prev) return prev;
              const existingCam = prev.cams[asset.id];
              // Skip if we already injected this exact URL.
              if (existingCam?.framesUrl) {
                URL.revokeObjectURL(framesUrl);
                return prev;
              }
              return {
                ...prev,
                cams: {
                  ...prev.cams,
                  [asset.id]: existingCam
                    ? { ...existingCam, framesUrl }
                    : { videoUrl: "", framesUrl },
                },
              };
            });
          })();
          continue;
        }
        // New cam: resolve its URLs and inject into the editor.
        void (async () => {
          const videoUrl = await resolveCamAssetUrl(id, asset.id, "video");
          const framesUrl = await resolveCamAssetUrl(id, asset.id, "frames");
          if (!videoUrl) return;
          newCamUrls.push({ videoUrl, framesUrl });
          setAssets((prev) =>
            prev
              ? {
                  ...prev,
                  cams: {
                    ...prev.cams,
                    [asset.id]: { videoUrl, framesUrl },
                  },
                }
              : prev,
          );
          useEditorStore.getState().addClip(init);
        })();
      }
    };
    jobEvents.addEventListener("update", handler);
    return () => {
      jobEvents.removeEventListener("update", handler);
      // Revoke any object URLs we created for late-added cams.
      for (const { videoUrl, framesUrl } of newCamUrls) {
        URL.revokeObjectURL(videoUrl);
        if (framesUrl) URL.revokeObjectURL(framesUrl);
      }
    };
  }, [id]);

  async function onSubmit() {
    if (!id || !job) return;
    // Pause playback before we navigate away — the player would otherwise
    // keep the audio element alive on the editor page in the background.
    useEditorStore.getState().setPlaying(false);
    setSubmitting(true);
    setErr(null);
    const spec = buildEditSpec();
    const sourceDims = {
      w: job.width ?? 1920,
      h: job.height ?? 1080,
    };
    const exportOpts = spec.export
      ? exportSpecToRenderOpts(spec.export, sourceDims)
      : undefined;
    // Persist the multi-cam state (clips + cuts) into the job record so
    // a refresh / history-page revisit shows the same edit.
    const liveState = useEditorStore.getState();
    const clipOverrides = liveState.clips.map((c) => ({
      id: c.id,
      // Image clips don't have a syncOverrideMs — only video clips do.
      syncOverrideMs: c.kind === "image" ? 0 : c.syncOverrideMs,
      startOffsetS: c.startOffsetS,
    }));
    const cuts = liveState.cuts;
    await jobsDb.updateJob(id, { cuts });
    const local: EditSpecLocal = {
      segments: spec.segments,
      overlays: (spec.overlays ?? []).map((o) => ({
        text: o.text ?? "",
        start: o.start ?? 0,
        end: o.end ?? 0,
        preset: o.preset ?? "plain",
        x: o.x ?? 0.5,
        y: o.y ?? 0.85,
        animation: (o.animation ?? "fade") as EditSpecLocal["overlays"][number]["animation"],
        reactiveBand: o.reactive?.band ?? null,
        reactiveParam: (o.reactive?.param ?? "scale") as EditSpecLocal["overlays"][number]["reactiveParam"],
        reactiveAmount: o.reactive?.amount ?? 0.3,
      })),
      offsetOverrideMs: spec.sync_override_ms ?? 0,
      visualizers: spec.visualizer
        ? [{ type: spec.visualizer.type === "showfreqs" ? "showfreqs" : "showwaves" }]
        : undefined,
      exportOpts,
      outputFilename: spec.export?.filename,
      clipOverrides,
      cuts,
    };
    // Fire-and-forget: the render screen owns the lifecycle from here.
    // Errors are surfaced via jobEvents, so we don't await — and we
    // navigate immediately to free the editor's heap.
    void runEditRender(id, local);
    navigate(`/job/${id}/render`);
  }

  if (err) {
    return (
      <div className="paper-bg min-h-full flex items-center justify-center p-6">
        <div className="border-l-2 border-danger pl-3 py-2 text-sm text-danger font-mono max-w-md">
          {err}
        </div>
      </div>
    );
  }
  if (!job || !assets) {
    return (
      <div className="paper-bg min-h-full flex items-center justify-center">
        <p className="font-mono text-sm text-ink-2 tracking-label uppercase">
          Loading editor…
        </p>
      </div>
    );
  }

  return (
    <>
      <EditorShell
        jobTitle={job.title || job.id}
        jobId={job.id}
        videoArea={
          <MultiCamPreview
            cams={Object.fromEntries(
              Object.entries(assets.cams).map(([id, ca]) => [id, { videoUrl: ca.videoUrl }]),
            )}
            audioUrl={assets.audioUrl}
          />
        }
        transport={<TransportBar />}
        timeline={
          assets.wave ? (
            <Timeline
              cams={Object.fromEntries(
                Object.entries(assets.cams).map(([camId, ca]) => {
                  const cam = job.videos?.find((v) => v.id === camId);
                  const aspect =
                    cam?.width && cam?.height ? cam.width / cam.height : 16 / 9;
                  return [camId, { framesUrl: ca.framesUrl, aspect }];
                }),
              )}
              peaks={assets.wave.peaks}
              audioDuration={assets.wave.duration}
              onDeleteClip={(camId) => {
                void removeCamFromJob(id, camId).catch((e) => {
                  setErr(e instanceof Error ? e.message : "Delete failed");
                });
              }}
            />
          ) : (
            <div className="h-20 flex items-center justify-center text-ink-3 text-xs font-mono">
              Loading timeline…
            </div>
          )
        }
        sidePanel={
          <SidePanel
            sync={<SyncTuner lastSyncOverrideMs={null} />}
            trim={<TrimPanel />}
            overlays={<OverlaysPanel />}
            exportTab={<ExportPanel onSubmit={onSubmit} submitting={submitting} />}
          />
        }
        onSubmit={onSubmit}
        submitting={submitting}
      />
      <NoticeToast />
    </>
  );
}
