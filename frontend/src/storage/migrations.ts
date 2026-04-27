import type { LocalJob, VideoAsset } from "./jobs-db";

/**
 * Cam-Color-Palette für Multi-Video-Setups.
 *
 * Wird beim Upload deterministisch über den Lane-Index zugewiesen, damit
 * dieselbe Cam zwischen Sessions konsistent dieselbe Farbe behält.
 */
export const CAM_COLORS = [
  "#3b6dff", // cobalt
  "#ffb020", // amber
  "#ff3366", // hot pink
  "#34d399", // mint
  "#c084fc", // orchid
  "#22d3ee", // cyan
  "#f97316", // tangerine
  "#a3e635", // lime
] as const;

export function camColorAt(index: number): string {
  return CAM_COLORS[index % CAM_COLORS.length];
}

function fileExtensionFromName(name: string, fallback: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return fallback;
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/i.test(ext) ? ext : fallback;
}

/** Legacy-OPFS-Pfad für V1-Jobs (vor der Multi-Video-Umstellung). */
export function legacyVideoOpfsPath(jobId: string, videoFilename: string): string {
  return `jobs/${jobId}/video.${fileExtensionFromName(videoFilename, "mp4")}`;
}

/** Frames-Strip-Pfad nach altem Single-Video-Layout. */
export function legacyFramesOpfsPath(jobId: string): string {
  return `jobs/${jobId}/frames.webp`;
}

/**
 * Migriert einen Single-Video-Job (V1) zum Multi-Video-Schema (V2).
 *
 * Die alten Top-Level-Felder (videoFilename, sync, dimensions) bleiben
 * unangetastet, damit Consumer, die noch nicht auf videos[] umgestellt sind,
 * weiterhin lesen können. Spätere Schritte ziehen die Consumer um, dann
 * können die Legacy-Felder weg.
 */
export function migrateV1ToV2(job: LocalJob): LocalJob {
  if (job.schemaVersion === 2) return job;

  const cam: VideoAsset = {
    id: "cam-1",
    filename: job.videoFilename,
    opfsPath: legacyVideoOpfsPath(job.id, job.videoFilename),
    color: camColorAt(0),
  };
  if (job.sync) cam.sync = job.sync;
  if (job.durationS !== undefined) cam.durationS = job.durationS;
  if (job.width !== undefined) cam.width = job.width;
  if (job.height !== undefined) cam.height = job.height;
  if (job.fps !== undefined) cam.fps = job.fps;
  if (job.hasFrames) cam.framesPath = legacyFramesOpfsPath(job.id);

  return {
    ...job,
    schemaVersion: 2,
    videos: [cam],
    cuts: [],
  };
}
