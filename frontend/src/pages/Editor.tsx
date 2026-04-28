import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EditorShell } from "../editor/components/EditorShell";
import { ExportPanel } from "../editor/components/ExportPanel";
import { OverlaysPanel } from "../editor/components/OverlaysPanel";
import { SidePanel } from "../editor/components/SidePanel";
import { SyncTuner } from "../editor/components/SyncTuner";
import { Timeline } from "../editor/components/Timeline";
import { TransportBar } from "../editor/components/TransportBar";
import { TrimPanel } from "../editor/components/TrimPanel";
import { MultiCamPreview } from "../editor/components/MultiCamPreview";
import { useEditorStore } from "../editor/store";
import {
  jobsDb,
  resolveJobAssetUrl,
  resolveCamAssetUrl,
  runEditRender,
  type LocalJob,
  type EditSpecLocal,
} from "../local/jobs";
import { decodeAudioToMonoPcm } from "../local/codec";
import { computeWaveformPeaks } from "../local/waveform-peaks";
import { exportSpecToRenderOpts } from "../editor/exportPresets";
import { opfs } from "../storage/opfs";
import type { ClipInit } from "../editor/store";

interface WaveformData {
  peaks: [number, number][];
  duration: number;
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
  // pushbuttons). Press = insert cut at playhead. Press-and-HOLD = also
  // overwrite any cuts to other cams during the held span — paint the cam
  // over the held window. Ignored when the user is typing in an input.
  useEffect(() => {
    // camId currently held + the master-timeline time the press started at.
    const holds = new Map<string, { camId: string; startS: number }>();

    function isTypingTarget(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      // Ignore browser auto-repeat — we only want the very first keydown.
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      const n = parseInt(e.key, 10);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const s = useEditorStore.getState();
      const clip = s.clips[n - 1];
      if (!clip) return;
      e.preventDefault();
      const startS = s.playback.currentTime;
      s.addCut({ atTimeS: startS, camId: clip.id });
      holds.set(e.key, { camId: clip.id, startS });
    }

    function onKeyUp(e: KeyboardEvent) {
      const hold = holds.get(e.key);
      if (!hold) return;
      holds.delete(e.key);
      const s = useEditorStore.getState();
      const endS = s.playback.currentTime;
      // Only overwrite if the playhead actually moved — a quick tap should
      // just leave the addCut alone (the no-op rule already handles dupes).
      if (Math.abs(endS - hold.startS) > 0.05) {
        s.overwriteCutsRange(hold.camId, hold.startS, endS);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Persist cuts into the job record whenever they change. Lightweight
  // throttle (250 ms) so a hold-overwrite or rapid clicks don't hammer
  // IndexedDB. Cleared on unmount via the unsubscribe + clearTimeout below.
  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSerialized = "";
    const unsub = useEditorStore.subscribe(
      (s) => s.cuts,
      (cuts) => {
        const ser = JSON.stringify(cuts);
        if (ser === lastSerialized) return;
        lastSerialized = ser;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          jobsDb.updateJob(id, { cuts }).catch(() => {
            // Job may have been deleted — non-fatal.
          });
        }, 250);
      },
    );
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [id]);

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

      // Compute waveform peaks locally from the studio audio.
      let wave: WaveformData | null = null;
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

      const clipInits: ClipInit[] = videos.map((v) => ({
        id: v.id,
        filename: v.filename,
        color: v.color,
        sourceDurationS: v.durationS ?? 0,
        syncOffsetMs: v.sync?.offsetMs ?? 0,
      }));

      loadJob(
        {
          id: j.id,
          fps: 30,
          duration: j.durationS ?? wave?.duration ?? 0,
          width: j.width ?? 1920,
          height: j.height ?? 1080,
          algoOffsetMs: j.sync?.offsetMs ?? 0,
          driftRatio: j.sync?.driftRatio ?? 1,
        },
        {
          lastSyncOverrideMs: null,
          clips: clipInits,
          cuts: j.cuts ?? [],
        },
      );
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
      syncOverrideMs: c.syncOverrideMs,
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
    </>
  );
}
