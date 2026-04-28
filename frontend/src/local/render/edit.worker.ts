/// <reference lib="webworker" />

/**
 * Edit-render worker.
 *
 * Owns the entire video pipeline (demux → decode → composite → encode →
 * mux) so the main thread stays responsive: the render screen can animate,
 * and the cancel button stays clickable. Audio decode happens on the main
 * thread before the worker is spawned (AudioContext is unavailable in
 * workers); the resulting Float32Array is transferred in.
 *
 * Cancel = `worker.terminate()` from the main thread. The orchestrator in
 * jobs.ts is responsible for cleaning up the partially-written OPFS file.
 *
 * Message protocol:
 *   in:  { type: "start", input: WorkerInput } — sent once
 *   out: { type: "progress", progress: EditRenderProgress }
 *        { type: "done" }
 *        { type: "error", message: string }
 */

import {
  editRender,
  editRenderMulti,
  type EditRenderProgress,
  type Segment,
} from "./edit";
import { opfs } from "../../storage/opfs";
import { ShowwavesVisualizer } from "./visualizer/showwaves";
import { ShowfreqsVisualizer } from "./visualizer/showfreqs";
import type { Visualizer } from "./visualizer/types";
import type { TextOverlay, EnergyCurves } from "./ass-builder";
import type { Cut } from "../../storage/jobs-db";

export type VisualizerWorkerDescriptor =
  | { type: "showwaves"; pcm: Float32Array; sampleRate: number }
  | { type: "showfreqs"; energy: EnergyCurves };

/** Per-cam input descriptor for the multi-source render path. */
export interface CamWorkerInput {
  id: string;
  opfsPath: string;
  /** Cam start position on the master timeline (seconds). */
  masterStartS: number;
  sourceDurationS: number;
  /** Per-cam drift vs. master audio. Default 1 = no drift. */
  driftRatio?: number;
}

export interface EditWorkerInput {
  /** Legacy single-cam path. Used when `cams` is omitted (or has length 1
   *  and `cuts` is empty — the renderer fast-paths to the simpler pipeline). */
  videoPath?: string;
  /** Multi-cam path. When present and (cams.length > 1 || cuts.length > 0)
   *  the worker dispatches to `editRenderMulti`. */
  cams?: CamWorkerInput[];
  cuts?: Cut[];
  /** Master-timeline duration; defaults to longest cam's end. */
  masterDurationS?: number;

  outputPath: string;
  audioPcm: { pcm: Float32Array; sampleRate: number; channels: number };
  segments: Segment[];
  overlays: TextOverlay[];
  visualizers: VisualizerWorkerDescriptor[];
  energy: EnergyCurves | null;
  offsetMs: number;
  driftRatio: number;
  /** Output codec/dimension/bitrate overrides. Optional — the renderer
   *  defaults to "source dimensions, H.264, AAC, 4 Mbps" when omitted. */
  outputWidth?: number;
  outputHeight?: number;
  videoCodec?: "h264" | "h265";
  audioCodec?: "aac" | "opus";
  videoBitrateBps?: number;
  audioBitrateBps?: number;
  /** Output framerate (defaults to 30). Independent from any cam's source fps. */
  outputFps?: number;
}

export type EditWorkerMessage =
  | { type: "start"; input: EditWorkerInput }
  ;

export type EditWorkerEvent =
  | { type: "progress"; progress: EditRenderProgress }
  | { type: "done" }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", async (e: MessageEvent<EditWorkerMessage>) => {
  const msg = e.data;
  if (msg.type !== "start") return;
  const input = msg.input;

  let writable: FileSystemWritableFileStream | null = null;
  try {
    writable = await opfs.createWritable(input.outputPath);

    const visualizers: Visualizer[] = [];
    for (const d of input.visualizers) {
      if (d.type === "showwaves") {
        visualizers.push(new ShowwavesVisualizer({ pcm: d.pcm, sampleRate: d.sampleRate }));
      } else if (d.type === "showfreqs") {
        visualizers.push(new ShowfreqsVisualizer({ energy: d.energy }));
      }
    }

    const onProgress = (p: EditRenderProgress) => {
      const evt: EditWorkerEvent = { type: "progress", progress: p };
      ctx.postMessage(evt);
    };

    const useMultiCam =
      input.cams !== undefined &&
      (input.cams.length > 1 || (input.cuts ?? []).length > 0);

    if (useMultiCam) {
      const cams = input.cams!;
      const camFiles = await Promise.all(
        cams.map(async (c) => ({
          ...c,
          file: await opfs.readFile(c.opfsPath),
        })),
      );
      await editRenderMulti({
        cams: camFiles.map((c) => ({
          id: c.id,
          file: c.file,
          masterStartS: c.masterStartS,
          sourceDurationS: c.sourceDurationS,
          driftRatio: c.driftRatio ?? 1,
        })),
        cuts: input.cuts ?? [],
        masterDurationS: input.masterDurationS,
        audioPcm: input.audioPcm,
        segments: input.segments,
        overlays: input.overlays,
        energy: input.energy,
        visualizers,
        offsetMs: input.offsetMs,
        driftRatio: input.driftRatio,
        outputFps: input.outputFps,
        outputWidth: input.outputWidth,
        outputHeight: input.outputHeight,
        videoCodec: input.videoCodec,
        audioCodec: input.audioCodec,
        videoBitrateBps: input.videoBitrateBps,
        audioBitrateBps: input.audioBitrateBps,
        output: writable,
        onProgress,
      });
    } else {
      // Single-cam fast path. Either `videoPath` (legacy) or the only entry
      // in `cams` provides the source.
      const path = input.videoPath ?? input.cams?.[0]?.opfsPath;
      if (!path) throw new Error("editWorker: no video source provided");
      const videoFile = await opfs.readFile(path);
      await editRender({
        videoFile,
        audioPcm: input.audioPcm,
        segments: input.segments,
        overlays: input.overlays,
        energy: input.energy,
        visualizers,
        offsetMs: input.offsetMs,
        driftRatio: input.driftRatio,
        outputWidth: input.outputWidth,
        outputHeight: input.outputHeight,
        videoCodec: input.videoCodec,
        audioCodec: input.audioCodec,
        videoBitrateBps: input.videoBitrateBps,
        audioBitrateBps: input.audioBitrateBps,
        output: writable,
        onProgress,
      });
    }

    await writable.close();
    writable = null;
    const done: EditWorkerEvent = { type: "done" };
    ctx.postMessage(done);
  } catch (err) {
    if (writable) {
      try {
        await writable.abort();
      } catch {
        // best-effort
      }
    }
    const evt: EditWorkerEvent = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(evt);
  }
});
