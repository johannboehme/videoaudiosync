// Studio-Console export dialog. Source → Output is the hero element; the
// rest are modifiers.
//
// Three orthogonal axes a user might want to touch:
//   1. WHERE — destination preset (Web / Archive / Mobile / Custom).
//   2. HOW MUCH — Quality slider, mapped to bitrate via `qualityToBitrates`.
//   3. WHAT KIND — Advanced drawer: resolution, codec, bitrate, audio codec.
//
// Everything reads/writes through the editor store's `exportSpec`. The
// onSubmit handler in `Editor.tsx` translates the spec to the renderer's
// raw options via `exportSpecToRenderOpts`.

import { useEffect, useMemo } from "react";
import {
  applyPreset,
  estimateFileSizeBytes,
  qualityToBitrates,
  resolveResolution,
} from "../exportPresets";
import { useEditorStore } from "../store";
import type { ExportPreset, ExportSpec, QualityStep } from "../types";
import { AdvancedDrawer } from "./AdvancedDrawer";
import { ChunkyButton } from "./ChunkyButton";
import { FilenameInput } from "./FilenameInput";
import { IOReadout } from "./IOReadout";
import { QualitySlider } from "./QualitySlider";
import { ResolutionPicker } from "./ResolutionPicker";
import { SegmentedControl } from "./SegmentedControl";
import { SizeEstimate } from "./SizeEstimate";
import { DownloadIcon, HelpIcon } from "./icons";

interface Props {
  onSubmit: () => void;
  submitting: boolean;
}

export function ExportPanel({ onSubmit, submitting }: Props) {
  const exportSpec = useEditorStore((s) => s.exportSpec);
  const setExport = useEditorStore((s) => s.setExport);
  const jobMeta = useEditorStore((s) => s.jobMeta);

  const source = useMemo(
    () => ({
      w: jobMeta?.width ?? 1920,
      h: jobMeta?.height ?? 1080,
      durationS: jobMeta?.duration ?? 0,
    }),
    [jobMeta?.width, jobMeta?.height, jobMeta?.duration],
  );

  const output = useMemo(
    () => resolveResolution(exportSpec.resolution, source),
    [exportSpec.resolution, source],
  );

  // Re-derive bitrates from the quality step whenever the output resolution
  // changes — otherwise picking a new preset / resolution would leave bitrate
  // unchanged and break the "what Quality means at this resolution" promise.
  // We skip when quality is "custom", because then the user has set bitrate
  // explicitly and we must not overwrite their choice.
  useEffect(() => {
    if (exportSpec.quality === "custom") return;
    if (!exportSpec.quality) return;
    const { videoKbps, audioKbps } = qualityToBitrates(exportSpec.quality, output);
    if (
      exportSpec.video_bitrate_kbps === videoKbps &&
      exportSpec.audio_bitrate_kbps === audioKbps
    ) {
      return;
    }
    setExport({
      video_bitrate_kbps: videoKbps,
      audio_bitrate_kbps: audioKbps,
    });
  }, [
    exportSpec.quality,
    output.w,
    output.h,
    exportSpec.video_bitrate_kbps,
    exportSpec.audio_bitrate_kbps,
    output,
    setExport,
  ]);

  const sizeBytes = estimateFileSizeBytes({
    videoKbps: exportSpec.video_bitrate_kbps ?? 0,
    audioKbps: exportSpec.audio_bitrate_kbps ?? 0,
    durationS: source.durationS,
  });

  function selectPreset(p: ExportPreset) {
    setExport(applyPreset(p, source));
  }

  function selectQuality(q: Exclude<QualityStep, "custom">) {
    const { videoKbps, audioKbps } = qualityToBitrates(q, output);
    setExport({
      quality: q,
      video_bitrate_kbps: videoKbps,
      audio_bitrate_kbps: audioKbps,
    });
  }

  function setResolution(dims: { w: number; h: number }) {
    setExport({ resolution: dims, preset: "custom" });
  }

  function setVideoCodec(c: ExportSpec["video_codec"]) {
    setExport({ video_codec: c, preset: "custom" });
  }

  function setAudioCodec(c: ExportSpec["audio_codec"]) {
    setExport({ audio_codec: c, preset: "custom" });
  }

  function setVideoBitrate(kbps: number) {
    setExport({ video_bitrate_kbps: kbps, quality: "custom" });
  }

  function setAudioBitrate(kbps: number) {
    setExport({ audio_bitrate_kbps: kbps, quality: "custom" });
  }

  function setFilename(name: string) {
    setExport({ filename: name });
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h2 className="font-display text-lg leading-none">Export</h2>
        <p className="text-xs text-ink-2 mt-1">
          Pick a destination, dial in the quality, hit render.
        </p>
      </header>

      <IOReadout source={source} output={output} />

      <SegmentedControl
        label="Destination"
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

      <QualitySlider
        value={exportSpec.quality ?? "good"}
        onChange={selectQuality}
      />

      <SizeEstimate
        bytes={sizeBytes}
        durationS={source.durationS}
        format={exportSpec.format ?? "mp4"}
        videoCodec={exportSpec.video_codec ?? "h264"}
        audioCodec={exportSpec.audio_codec ?? "aac"}
      />

      <AdvancedDrawer>
        <ResolutionPicker
          source={source}
          value={output}
          onChange={setResolution}
        />

        <FormField label="Video codec">
          <SegmentedControl
            value={exportSpec.video_codec ?? "h264"}
            options={[
              { value: "h264", label: "H.264" },
              { value: "h265", label: "H.265" },
            ]}
            onChange={(v) => setVideoCodec(v as "h264" | "h265")}
            size="sm"
            fullWidth
          />
        </FormField>

        <FormField label="Audio codec">
          <SegmentedControl
            value={exportSpec.audio_codec ?? "aac"}
            options={[
              { value: "aac", label: "AAC" },
              { value: "opus", label: "Opus" },
            ]}
            onChange={(v) => setAudioCodec(v as "aac" | "opus")}
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
            value={exportSpec.video_bitrate_kbps ?? 3500}
            onChange={(e) => setVideoBitrate(parseInt(e.target.value, 10))}
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
            onChange={(e) => setAudioBitrate(parseInt(e.target.value, 10))}
            className="w-full accent-hot"
          />
        </FormField>

        <FilenameInput
          value={exportSpec.filename ?? ""}
          onChange={setFilename}
          extension={exportSpec.format ?? "mp4"}
        />
      </AdvancedDrawer>

      <div className="flex gap-2">
        <ChunkyButton
          variant="secondary"
          size="lg"
          className="aspect-square"
          aria-label="Help"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }))
          }
        >
          <HelpIcon />
        </ChunkyButton>
        <ChunkyButton
          variant="primary"
          size="lg"
          className="flex-1"
          disabled={submitting}
          iconLeft={<DownloadIcon />}
          onClick={onSubmit}
        >
          {submitting ? "Submitting…" : "Render"}
        </ChunkyButton>
      </div>
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
