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
import { VideoCanvas } from "../editor/components/VideoCanvas";
import { useEditorStore } from "../editor/store";
import {
  jobsDb,
  resolveJobAssetUrl,
  runEditRender,
  type LocalJob,
  type EditSpecLocal,
} from "../local/jobs";
import { decodeAudioToMonoPcm } from "../local/codec";
import { computeWaveformPeaks } from "../local/waveform-peaks";
import { exportSpecToRenderOpts } from "../editor/exportPresets";
import { opfs } from "../storage/opfs";

interface WaveformData {
  peaks: [number, number][];
  duration: number;
}

interface EditorAssets {
  videoUrl: string;
  audioUrl: string;
  wave: WaveformData | null;
  framesUrl: string | null;
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

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let videoUrl: string | null = null;
    let audioUrl: string | null = null;
    let framesUrl: string | null = null;

    (async () => {
      const j = await jobsDb.getJob(id);
      if (cancelled || !j) return;
      setJob(j);

      videoUrl = await resolveJobAssetUrl(id, "video");
      audioUrl = await resolveJobAssetUrl(id, "audio");
      framesUrl = await resolveJobAssetUrl(id, "frames");
      if (cancelled || !videoUrl || !audioUrl) return;

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

      setAssets({ videoUrl, audioUrl, wave, framesUrl });

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
        { lastSyncOverrideMs: null },
      );
    })().catch((e) => {
      if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load job");
    });

    return () => {
      cancelled = true;
      reset();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (framesUrl) URL.revokeObjectURL(framesUrl);
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
          <VideoCanvas videoUrl={assets.videoUrl} audioUrl={assets.audioUrl} />
        }
        transport={<TransportBar />}
        timeline={
          assets.wave ? (
            <Timeline
              thumbnailsUrl={assets.framesUrl}
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
