import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, EditSpec, Job, TextOverlay, VisualizerConfig } from "../api";
import { Waveform } from "../editor/Waveform";

const VIS_OPTIONS: { value: VisualizerConfig["type"] | ""; label: string }[] = [
  { value: "", label: "None" },
  { value: "showcqt", label: "Spectrum bars (showcqt)" },
  { value: "showfreqs", label: "Frequency bars" },
  { value: "showwaves", label: "Waveform" },
  { value: "showspectrum", label: "Spectrogram" },
  { value: "avectorscope", label: "Vectorscope" },
];

const PRESETS: TextOverlay["preset"][] = [
  "plain",
  "boxed",
  "outline",
  "glow",
  "gradient",
];
const ANIMATIONS: TextOverlay["animation"][] = [
  "fade",
  "pop",
  "slide_in",
  "word_reveal",
  "wobble",
  "none",
];

interface WaveformData {
  peaks: [number, number][];
  duration: number;
}

export default function Editor() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [wave, setWave] = useState<WaveformData | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const [trimIn, setTrimIn] = useState(0);
  const [trimOut, setTrimOut] = useState(10);
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [visualizer, setVisualizer] = useState<VisualizerConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!id) return;
    api.getJob(id).then((j) => {
      setJob(j);
      const dur = j.duration_s ?? 0;
      setTrimOut(dur);
    });
    fetch(api.waveformUrl(id))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setWave({ peaks: d.peaks, duration: d.duration }))
      .catch(() => {});
  }, [id]);

  function addOverlay() {
    setOverlays((cur) => [
      ...cur,
      {
        type: "text",
        text: "Your text",
        start: currentTime,
        end: Math.min((wave?.duration ?? 10), currentTime + 2),
        preset: "outline",
        x: 0.5,
        y: 0.85,
        animation: "fade",
      },
    ]);
  }

  function updateOverlay(idx: number, patch: Partial<TextOverlay>) {
    setOverlays((cur) => cur.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }

  function removeOverlay(idx: number) {
    setOverlays((cur) => cur.filter((_, i) => i !== idx));
  }

  async function render() {
    if (!id || !job) return;
    setBusy(true);
    setErr(null);
    const spec: EditSpec = {
      version: 1,
      segments: [{ in: trimIn, out: trimOut }],
      overlays,
      visualizer,
    };
    try {
      await api.submitEdit(id, spec);
      navigate(`/job/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Render failed");
      setBusy(false);
    }
  }

  if (!job) return <p className="p-6 text-white/60">Loading…</p>;
  const duration = wave?.duration ?? job.duration_s ?? 0;

  return (
    <main className="min-h-full p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold truncate">{job.title || job.id}</h1>
        <button
          onClick={render}
          disabled={busy}
          className="bg-accent-600 hover:bg-accent-500 disabled:opacity-40 transition rounded-xl px-4 py-2 font-medium"
        >
          {busy ? "Rendering…" : "Render"}
        </button>
      </header>

      <div className="bg-ink-800 rounded-2xl overflow-hidden">
        <video
          ref={videoRef}
          data-testid="preview-video"
          src={api.previewUrl(job.id)}
          controls
          playsInline
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          className="w-full bg-black"
        />
      </div>

      {wave && (
        <div className="bg-ink-800 rounded-2xl p-3">
          <Waveform
            peaks={wave.peaks}
            duration={wave.duration}
            currentTime={currentTime}
            segments={[{ in: trimIn, out: trimOut }]}
            onSeek={(t) => {
              setCurrentTime(t);
              if (videoRef.current) videoRef.current.currentTime = t;
            }}
          />
        </div>
      )}

      <section className="bg-ink-800 rounded-2xl p-4 space-y-3">
        <h2 className="text-sm font-medium text-white/70">Trim</h2>
        <label className="block text-sm">
          <span className="text-white/60">In: {trimIn.toFixed(2)}s</span>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={trimIn}
            onChange={(e) => setTrimIn(Math.min(parseFloat(e.target.value), trimOut - 0.1))}
            className="w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-white/60">Out: {trimOut.toFixed(2)}s</span>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={trimOut}
            onChange={(e) => setTrimOut(Math.max(parseFloat(e.target.value), trimIn + 0.1))}
            className="w-full"
          />
        </label>
      </section>

      <section className="bg-ink-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-white/70">Text overlays</h2>
          <button
            onClick={addOverlay}
            className="text-sm bg-ink-700 hover:bg-ink-600 rounded-lg px-3 py-1"
          >
            Add text overlay
          </button>
        </div>
        {overlays.length === 0 && (
          <p className="text-sm text-white/40">None — add one with the button above.</p>
        )}
        {overlays.map((o, idx) => (
          <div key={idx} className="bg-ink-700 rounded-xl p-3 space-y-2">
            <label className="block text-sm">
              <span className="text-white/60">Text</span>
              <input
                type="text"
                value={o.text}
                onChange={(e) => updateOverlay(idx, { text: e.target.value })}
                className="mt-1 w-full bg-ink-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-accent-500"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs">
                <span className="text-white/60">Start (s)</span>
                <input
                  type="number"
                  step={0.1}
                  value={o.start}
                  onChange={(e) => updateOverlay(idx, { start: parseFloat(e.target.value) })}
                  className="mt-1 w-full bg-ink-600 rounded-lg px-2 py-1 outline-none"
                />
              </label>
              <label className="block text-xs">
                <span className="text-white/60">End (s)</span>
                <input
                  type="number"
                  step={0.1}
                  value={o.end}
                  onChange={(e) => updateOverlay(idx, { end: parseFloat(e.target.value) })}
                  className="mt-1 w-full bg-ink-600 rounded-lg px-2 py-1 outline-none"
                />
              </label>
              <label className="block text-xs">
                <span className="text-white/60">Style</span>
                <select
                  value={o.preset}
                  onChange={(e) =>
                    updateOverlay(idx, { preset: e.target.value as TextOverlay["preset"] })
                  }
                  className="mt-1 w-full bg-ink-600 rounded-lg px-2 py-1 outline-none"
                >
                  {PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                <span className="text-white/60">Animation</span>
                <select
                  value={o.animation}
                  onChange={(e) =>
                    updateOverlay(idx, { animation: e.target.value as TextOverlay["animation"] })
                  }
                  className="mt-1 w-full bg-ink-600 rounded-lg px-2 py-1 outline-none"
                >
                  {ANIMATIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              onClick={() => removeOverlay(idx)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          </div>
        ))}
      </section>

      <section className="bg-ink-800 rounded-2xl p-4 space-y-3">
        <h2 className="text-sm font-medium text-white/70">Visualizer</h2>
        <label className="block text-sm">
          <span className="text-white/60">Visualizer type</span>
          <select
            aria-label="Visualizer type"
            value={visualizer?.type ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setVisualizer(
                v
                  ? { type: v as VisualizerConfig["type"], position: "bottom", height_pct: 0.2, opacity: 0.7 }
                  : null,
              );
            }}
            className="mt-1 w-full bg-ink-700 rounded-lg px-3 py-2 outline-none"
          >
            {VIS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {err && <p className="text-red-400 text-sm">{err}</p>}
    </main>
  );
}
