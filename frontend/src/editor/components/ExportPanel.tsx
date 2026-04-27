// Output preset selector with pinch-yourself custom mode.
import { ExportPreset, ExportSpec } from "../types";
import { useEditorStore } from "../store";
import { ChunkyButton } from "./ChunkyButton";
import { MonoReadout } from "./MonoReadout";
import { SegmentedControl } from "./SegmentedControl";
import { DownloadIcon } from "./icons";

const PRESETS: Record<Exclude<ExportPreset, "custom">, ExportSpec> = {
  web: {
    preset: "web",
    format: "mp4",
    resolution: "source",
    video_codec: "h264",
    video_bitrate_kbps: 5000,
    audio_bitrate_kbps: 128,
  },
  archive: {
    preset: "archive",
    format: "mp4",
    resolution: "source",
    video_codec: "h265",
    video_bitrate_kbps: 8000,
    audio_bitrate_kbps: 192,
  },
  mobile: {
    preset: "mobile",
    format: "mp4",
    resolution: { w: 1280, h: 720 },
    video_codec: "h264",
    video_bitrate_kbps: 3000,
    audio_bitrate_kbps: 96,
  },
};

interface Props {
  onSubmit: () => void;
  submitting: boolean;
}

export function ExportPanel({ onSubmit, submitting }: Props) {
  const exportSpec = useEditorStore((s) => s.exportSpec);
  const setExport = useEditorStore((s) => s.setExport);

  function selectPreset(p: ExportPreset) {
    if (p === "custom") {
      setExport({ preset: "custom" });
    } else {
      setExport(PRESETS[p]);
    }
  }

  const isCustom = exportSpec.preset === "custom";

  const resLabel =
    exportSpec.resolution === "source"
      ? "SOURCE"
      : typeof exportSpec.resolution === "object"
        ? `${exportSpec.resolution.w}×${exportSpec.resolution.h}`
        : "—";

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h2 className="font-display text-lg leading-none">Export</h2>
        <p className="text-xs text-ink-2 mt-1">Pick a preset, then render.</p>
      </header>

      <SegmentedControl
        label="Preset"
        value={exportSpec.preset}
        options={[
          { value: "web", label: "WEB" },
          { value: "archive", label: "ARCHIVE" },
          { value: "mobile", label: "MOBILE" },
          { value: "custom", label: "CUSTOM" },
        ]}
        onChange={selectPreset}
        fullWidth
      />

      <div className="grid grid-cols-2 gap-2">
        <MonoReadout
          label="RESOLUTION"
          tone="default"
          size="sm"
          value={resLabel}
        />
        <MonoReadout
          label="VIDEO"
          tone="default"
          size="sm"
          value={`${exportSpec.video_codec?.toUpperCase()} ${exportSpec.video_bitrate_kbps ?? 0} kbps`}
        />
        <MonoReadout
          label="AUDIO"
          tone="default"
          size="sm"
          value={`AAC ${exportSpec.audio_bitrate_kbps ?? 0} kbps`}
        />
        <MonoReadout
          label="FORMAT"
          tone="default"
          size="sm"
          value={exportSpec.format?.toUpperCase() ?? "MP4"}
        />
      </div>

      {isCustom && (
        <div className="flex flex-col gap-3 rounded-md bg-paper-deep p-3 shadow-pressed">
          <FormField label="Format">
            <select
              value={exportSpec.format ?? "mp4"}
              onChange={(e) => setExport({ format: e.target.value as "mp4" | "mov" })}
              className="bg-paper-hi border border-rule rounded-md h-10 px-2 font-mono text-sm"
            >
              <option value="mp4">MP4</option>
              <option value="mov">MOV</option>
            </select>
          </FormField>

          <FormField label="Video codec">
            <SegmentedControl
              value={exportSpec.video_codec ?? "h264"}
              options={[
                { value: "h264", label: "H.264" },
                { value: "h265", label: "H.265" },
              ]}
              onChange={(v) => setExport({ video_codec: v as "h264" | "h265" })}
              size="sm"
              fullWidth
            />
          </FormField>

          <FormField label={`Video bitrate · ${exportSpec.video_bitrate_kbps ?? 0} kbps`}>
            <input
              type="range"
              min={500}
              max={20000}
              step={100}
              value={exportSpec.video_bitrate_kbps ?? 5000}
              onChange={(e) =>
                setExport({ video_bitrate_kbps: parseInt(e.target.value, 10) })
              }
              className="w-full accent-hot"
            />
          </FormField>

          <FormField label={`Audio bitrate · ${exportSpec.audio_bitrate_kbps ?? 0} kbps`}>
            <input
              type="range"
              min={64}
              max={320}
              step={16}
              value={exportSpec.audio_bitrate_kbps ?? 128}
              onChange={(e) =>
                setExport({ audio_bitrate_kbps: parseInt(e.target.value, 10) })
              }
              className="w-full accent-hot"
            />
          </FormField>
        </div>
      )}

      <ChunkyButton
        variant="primary"
        size="lg"
        fullWidth
        disabled={submitting}
        iconLeft={<DownloadIcon />}
        onClick={onSubmit}
      >
        {submitting ? "Submitting…" : "Render"}
      </ChunkyButton>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
