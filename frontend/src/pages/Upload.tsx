import { FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { ProgressBar, formatBytes, formatDuration } from "../components/ProgressBar";

export interface UploadProgress {
  loaded: number;
  total: number;
  startedAt: number;
}

export default function Upload() {
  const navigate = useNavigate();
  const [video, setVideo] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const startedRef = useRef<number | null>(null);

  const ready = video !== null && audio !== null && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!video || !audio) return;
    setBusy(true);
    setErr(null);
    startedRef.current = Date.now();
    setProgress({ loaded: 0, total: video.size + audio.size, startedAt: startedRef.current });
    try {
      const job = await api.uploadJob({
        video,
        audio,
        title: title || undefined,
        onProgress: (loaded, total) =>
          setProgress({ loaded, total, startedAt: startedRef.current! }),
      });
      navigate(`/job/${job.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <main className="min-h-full p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Sync your performance</h1>
      <p className="text-white/60 mb-6 text-sm">
        Drop your phone video + the studio audio. We'll align them and render
        the final clip.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <FilePicker
          label="Video"
          file={video}
          accept="video/*"
          capture="environment"
          onChange={setVideo}
        />
        <FilePicker label="Audio" file={audio} accept="audio/*" onChange={setAudio} />

        <label className="block text-sm">
          <span className="text-white/70">Title (optional)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full bg-ink-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-accent-500"
          />
        </label>

        {err && <p className="text-sm text-red-400">{err}</p>}

        {progress && <UploadProgressCard progress={progress} />}

        <button
          type="submit"
          disabled={!ready}
          className="w-full bg-accent-600 hover:bg-accent-500 disabled:opacity-40 transition rounded-xl px-3 py-3 font-medium"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>
    </main>
  );
}

export function UploadProgressCard({ progress }: { progress: UploadProgress }) {
  const pct = progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0;
  const elapsedS = (Date.now() - progress.startedAt) / 1000;
  const bps = elapsedS > 0.5 ? progress.loaded / elapsedS : 0;
  const remaining = bps > 0 ? (progress.total - progress.loaded) / bps : NaN;

  return (
    <section className="bg-ink-800 rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-white/70">Uploading</span>
        <span className="tabular-nums">{Math.round(pct)}%</span>
      </div>
      <ProgressBar value={pct} />
      <div className="flex items-center justify-between text-xs text-white/50 tabular-nums">
        <span>
          {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
        </span>
        <span>
          {bps > 0 && `${formatBytes(bps)}/s`}
          {bps > 0 && isFinite(remaining) && ` · ETA ${formatDuration(remaining)}`}
        </span>
      </div>
    </section>
  );
}

function FilePicker(props: {
  label: string;
  file: File | null;
  accept: string;
  capture?: "environment" | "user";
  onChange: (f: File | null) => void;
}) {
  const id = `picker-${props.label.toLowerCase()}`;
  return (
    <label
      htmlFor={id}
      className="block bg-ink-800 hover:bg-ink-700 transition rounded-2xl p-5 border-2 border-dashed border-ink-600 cursor-pointer"
    >
      <span className="text-white/70 text-sm">{props.label}</span>
      <div className="mt-2 text-base">
        {props.file ? (
          <span className="font-medium text-accent-400">{props.file.name}</span>
        ) : (
          <span className="text-white/40">Tap to pick a file</span>
        )}
      </div>
      <input
        id={id}
        type="file"
        accept={props.accept}
        capture={props.capture}
        className="hidden"
        onChange={(e) => props.onChange(e.target.files?.[0] || null)}
      />
    </label>
  );
}
