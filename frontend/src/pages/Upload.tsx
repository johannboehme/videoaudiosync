import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChunkyButton } from "../editor/components/ChunkyButton";
import { RuleStrip } from "../editor/components/RuleStrip";
import { formatBytes } from "../components/ProgressBar";
import { createJob } from "../local/jobs";

export default function Upload() {
  const navigate = useNavigate();
  const [video, setVideo] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = video !== null && audio !== null && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!video || !audio) return;
    setBusy(true);
    setErr(null);
    try {
      const jobId = await createJob(video, audio, { title: title || null });
      navigate(`/job/${jobId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the job");
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="grid lg:grid-cols-[1.4fr_1fr] gap-6 lg:gap-12 mb-8 lg:mb-12">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-xs tracking-label uppercase text-ink-2">
              NEW · JOB · LOCAL
            </span>
            <RuleStrip count={32} className="text-rule flex-1 max-w-[220px]" />
          </div>
          <h1 className="font-display font-semibold text-[clamp(40px,6vw,80px)] leading-[0.95] tracking-tight text-ink">
            Drop video.<br />
            Drop audio.<br />
            <span className="text-hot">Get sync.</span>
          </h1>
        </div>
        <aside className="lg:pt-12 flex flex-col gap-3 text-sm text-ink-2 lg:max-w-xs">
          <p className="leading-relaxed">
            Everything runs in your browser — your files never leave the device.
            We align the studio audio to the video and let you fine-tune in
            the editor.
          </p>
          <p className="leading-relaxed">
            Tip: any modern Chromium browser (Chrome, Edge, Brave, Arc) works
            best. Firefox + Safari fall back to ffmpeg.wasm for some codecs.
          </p>
        </aside>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-3">
          <DropZone
            step="01"
            label="Video"
            accept="video/*"
            file={video}
            onChange={setVideo}
            tall
          />
          <DropZone
            step="02"
            label="Audio"
            accept="audio/*"
            file={audio}
            onChange={setAudio}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-1">
          <label htmlFor="job-title" className="label sm:w-32 sm:shrink-0 sm:pt-0">
            03 / Title <span className="text-ink-3 normal-case tracking-normal">(opt.)</span>
          </label>
          <input
            id="job-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Take 1, B-side rehearsal, …"
            className="h-11 flex-1 bg-paper-hi border border-rule rounded-md px-3 font-mono text-sm focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/30"
          />
        </div>

        {err && (
          <div className="border-l-2 border-danger pl-3 py-2 text-sm text-danger font-mono">
            {err}
          </div>
        )}

        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-stretch border-t border-rule pt-5 mt-2">
          <ReadinessStatus video={video} audio={audio} busy={busy} />
          <ChunkyButton
            type="submit"
            variant="primary"
            size="lg"
            disabled={!ready}
            className="sm:min-w-[200px]"
          >
            {busy ? "Preparing…" : "Sync locally"}
          </ChunkyButton>
        </div>
      </form>
    </main>
  );
}

function DropZone({
  step,
  label,
  accept,
  file,
  onChange,
  tall = false,
}: {
  step: string;
  label: string;
  accept: string;
  file: File | null;
  onChange: (f: File | null) => void;
  tall?: boolean;
}) {
  const id = `picker-${label.toLowerCase()}`;
  const filled = file !== null;
  return (
    <label
      htmlFor={id}
      className={[
        "relative block rounded-lg cursor-pointer transition-colors group",
        "border-2 border-dashed",
        filled
          ? "bg-hot/10 border-hot text-ink"
          : "bg-paper-hi border-rule hover:border-ink-2 hover:bg-paper-deep",
        tall ? "min-h-[180px] sm:min-h-[220px]" : "min-h-[140px] sm:min-h-[180px]",
      ].join(" ")}
    >
      <div className="absolute top-4 left-5 right-5 flex items-center justify-between">
        <span className="font-display tracking-label uppercase text-[11px] text-ink-2">
          {step} · {label}
        </span>
        {filled && (
          <span className="font-mono text-[10px] tracking-label uppercase text-hot">
            ● READY
          </span>
        )}
      </div>
      <div className="absolute inset-0 flex items-end justify-between p-5">
        <div className="min-w-0 flex-1">
          {filled ? (
            <>
              <div className="font-mono text-base sm:text-lg text-ink truncate">
                {file!.name}
              </div>
              <div className="mt-1 font-mono text-xs text-ink-2 tabular">
                {formatBytes(file!.size)}
              </div>
            </>
          ) : (
            <div className="font-display text-2xl sm:text-3xl font-semibold text-ink-3 leading-tight">
              Drop {label.toLowerCase()}
              <br />
              <span className="text-base sm:text-lg font-normal text-ink-3">
                or tap to pick
              </span>
            </div>
          )}
        </div>
        <BigStepDigit n={step} muted={!filled} />
      </div>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </label>
  );
}

function BigStepDigit({ n, muted }: { n: string; muted: boolean }) {
  return (
    <span
      aria-hidden
      className={[
        "select-none font-display font-semibold leading-none",
        "text-[64px] sm:text-[88px]",
        muted ? "text-rule" : "text-hot",
      ].join(" ")}
      style={{ letterSpacing: "-0.04em" }}
    >
      {n}
    </span>
  );
}

function ReadinessStatus({
  video,
  audio,
  busy,
}: {
  video: File | null;
  audio: File | null;
  busy: boolean;
}) {
  return (
    <div className="bg-paper-hi border border-rule rounded-md px-4 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Dot ok={video !== null} label="VIDEO" />
        <Dot ok={audio !== null} label="AUDIO" />
      </div>
      <span className="font-mono text-[10px] tracking-label uppercase text-ink-3">
        {busy ? "PREPARING" : video && audio ? "READY → SYNC" : "WAITING"}
      </span>
    </div>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-label uppercase">
      <span
        className={[
          "inline-block w-2 h-2 rounded-full",
          ok ? "bg-hot" : "bg-rule",
        ].join(" ")}
      />
      <span className={ok ? "text-ink" : "text-ink-3"}>{label}</span>
    </span>
  );
}
