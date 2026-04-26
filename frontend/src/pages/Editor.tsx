import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Job } from "../api";
import { useAuth } from "../auth-context";
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

interface WaveformData {
  peaks: [number, number][];
  duration: number;
}

export default function Editor() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const loadJob = useEditorStore((s) => s.loadJob);
  const reset = useEditorStore((s) => s.reset);
  const buildEditSpec = useEditorStore((s) => s.buildEditSpec);

  const [job, setJob] = useState<Job | null>(null);
  const [wave, setWave] = useState<WaveformData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      api.getJob(id),
      fetch(api.waveformUrl(id), { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([j, w]) => {
      if (cancelled) return;
      setJob(j);
      if (w) setWave({ peaks: w.peaks, duration: w.duration });
      loadJob(
        {
          id: j.id,
          fps: j.fps && j.fps > 0 ? j.fps : 30,
          duration: j.duration_s ?? w?.duration ?? 0,
          width: j.width ?? 1920,
          height: j.height ?? 1080,
          algoOffsetMs: j.sync_offset_ms ?? 0,
          driftRatio: j.sync_drift_ratio ?? 1,
        },
        { lastSyncOverrideMs: user?.last_sync_override_ms ?? null },
      );
    });
    return () => {
      cancelled = true;
      reset();
    };
  }, [id, loadJob, reset, user]);

  async function onSubmit() {
    if (!id || !job) return;
    setSubmitting(true);
    setErr(null);
    const spec = buildEditSpec();
    try {
      await api.submitEdit(id, spec);
      navigate(`/job/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Render failed");
      setSubmitting(false);
    }
  }

  if (!job) {
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
          <VideoCanvas
            videoUrl={api.rawVideoUrl(job.id)}
            audioUrl={api.rawAudioUrl(job.id)}
          />
        }
        transport={<TransportBar />}
        timeline={
          wave ? (
            <Timeline
              thumbnailsUrl={api.thumbnailsUrl(job.id)}
              peaks={wave.peaks}
              audioDuration={wave.duration}
            />
          ) : (
            <div className="h-20 flex items-center justify-center text-ink-3 text-xs font-mono">
              Loading timeline…
            </div>
          )
        }
        sidePanel={
          <SidePanel
            sync={
              <SyncTuner
                lastSyncOverrideMs={user?.last_sync_override_ms ?? null}
              />
            }
            trim={<TrimPanel />}
            overlays={<OverlaysPanel />}
            exportTab={<ExportPanel onSubmit={onSubmit} submitting={submitting} />}
          />
        }
        onSubmit={onSubmit}
        submitting={submitting}
      />
      {err && (
        <div className="fixed bottom-4 right-4 bg-danger text-paper-hi rounded-md px-3 py-2 shadow-panel text-sm font-mono">
          {err}
        </div>
      )}
    </>
  );
}
