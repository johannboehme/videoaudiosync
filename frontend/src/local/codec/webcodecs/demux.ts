/**
 * mp4box.js demux wrapper.
 *
 * Provides the two operations the rest of the app needs:
 *   * `demuxVideoTrack` — pulls out all encoded video chunks plus the
 *     decoder config required by both VideoDecoder and the muxer (avcC).
 *   * `demuxAudioTrackInfo` — pulls just metadata + decoder config for the
 *     audio track, used when we want to re-mux audio passthrough (rare for
 *     us; we usually re-encode).
 *
 * mp4box.js is callback-based; this module wraps it in promises.
 */

import { createFile, DataStream, type Movie, type Sample, type ISOFile } from "mp4box";

export interface VideoTrackInfo {
  trackId: number;
  codec: string;            // e.g. "avc1.42E01F"
  /** Stored pixel dimensions (codec-level). For rotated phone recordings
   *  this is the recorded landscape size, NOT what the user sees in a
   *  player — see `rotationDeg` for the matrix that transforms stored to
   *  displayed pixels. */
  width: number;
  height: number;
  durationS: number;
  fps: number;
  /** Display rotation in degrees clockwise to apply to stored pixels for
   *  correct display, snapped to {0, 90, 180, 270}. Decoded from the
   *  track's `tkhd` matrix; phone recordings held in portrait carry 90 or
   *  270 here. The render compositor must apply this transform — without
   *  it, portrait recordings come out sideways even though preview (which
   *  renders through the browser's native `<video>`) honours it. */
  rotationDeg: 0 | 90 | 180 | 270;
  /** Avc decoder configuration record (the contents of the `avcC` box). */
  description: Uint8Array;
}

/**
 * Decode a 9-element ISO Base Media transform matrix (16.16 / 2.30 fixed
 * point) into the integer rotation it encodes. Returns 0 when the matrix
 * is missing, identity, or doesn't decode to a clean 90° multiple — in
 * those cases the renderer treats the frames as already-upright.
 */
export function rotationDegFromMatrix(
  matrix: ArrayLike<number> | undefined,
): 0 | 90 | 180 | 270 {
  if (!matrix || matrix.length < 5) return 0;
  // Elements [0,1,3,4] = [a, b, c, d] of the 2D rotation/scale block. For
  // a pure rotation tan(angle) = b/a; atan2 handles every quadrant
  // including the a=0 ones (90°, 270°).
  const a = matrix[0] / 65536;
  const b = matrix[1] / 65536;
  const rad = Math.atan2(b, a);
  // Snap to the nearest 90°. ISO matrices come from a fixed set of
  // rotations (0/90/180/270) so anything else is numerical noise.
  const snapped = Math.round((rad * 180) / Math.PI / 90) * 90;
  const norm = ((snapped % 360) + 360) % 360;
  if (norm === 90 || norm === 180 || norm === 270) return norm;
  return 0;
}

export interface VideoChunk {
  /** Microseconds since start. */
  timestampUs: number;
  durationUs: number;
  isKey: boolean;
  data: Uint8Array;
}

export interface VideoDemuxResult {
  info: VideoTrackInfo;
  chunks: VideoChunk[];
}

interface MP4BoxFileBuffer extends ArrayBuffer {
  fileStart: number;
}

/**
 * Reads an MP4/MOV and returns the first video track's chunks + decoder
 * config. Returns null if there is no video track.
 */
export async function demuxVideoTrack(
  source: Blob | ArrayBuffer,
): Promise<VideoDemuxResult | null> {
  const ab = source instanceof ArrayBuffer ? source : await source.arrayBuffer();

  return await new Promise<VideoDemuxResult | null>((resolve, reject) => {
    const file = createFile();
    let info: VideoTrackInfo | null = null;
    const chunks: VideoChunk[] = [];

    file.onError = (err: string) => reject(new Error(`mp4box: ${err}`));

    file.onReady = (movie: Movie) => {
      const videoTrack = movie.videoTracks?.[0] ?? null;
      if (!videoTrack) {
        resolve(null);
        return;
      }
      const desc = extractDecoderDescription(file, videoTrack.id);
      if (!desc) {
        reject(new Error("Could not extract video decoder description (avcC)."));
        return;
      }

      const videoMeta = videoTrack.video;
      if (!videoMeta) {
        reject(new Error("Video track has no `video` metadata."));
        return;
      }
      info = {
        trackId: videoTrack.id,
        codec: videoTrack.codec,
        width: videoMeta.width,
        height: videoMeta.height,
        durationS: videoTrack.duration / videoTrack.timescale,
        fps:
          videoTrack.nb_samples /
          (videoTrack.duration / videoTrack.timescale || 1),
        rotationDeg: rotationDegFromMatrix(
          (videoTrack as { matrix?: ArrayLike<number> }).matrix,
        ),
        description: desc,
      };

      file.setExtractionOptions(videoTrack.id, null, { nbSamples: 1000 });
      file.start();
    };

    file.onSamples = (_id: number, _user: unknown, samples: Sample[]) => {
      for (const s of samples) {
        chunks.push({
          timestampUs: (s.cts * 1_000_000) / s.timescale,
          durationUs: (s.duration * 1_000_000) / s.timescale,
          isKey: s.is_sync,
          data: new Uint8Array(s.data as unknown as ArrayBufferLike),
        });
      }
    };

    // mp4box requires the appended buffer to expose a fileStart property.
    const buf = ab as MP4BoxFileBuffer;
    buf.fileStart = 0;
    file.appendBuffer(buf as never);
    file.flush();

    // Resolve once we've received onReady AND processed all samples.
    // mp4box delivers samples synchronously after start() in our flow
    // (entire file is in memory), so we can resolve at the end of the
    // microtask queue.
    queueMicrotask(() => {
      if (info === null) {
        // onReady never fired — file had no parsable moov.
        resolve(null);
      } else {
        resolve({ info, chunks });
      }
    });
  });
}

/**
 * Extracts the decoder configuration (avcC for AVC, hvcC for HEVC) by
 * walking the box tree directly. Returns the inner box payload bytes
 * (not the 8-byte box header), which is exactly what WebCodecs and
 * mp4-muxer expect as the `description`.
 */
function extractDecoderDescription(file: ISOFile, trackId: number): Uint8Array | null {
  const trakBox = file.getTrackById(trackId) as unknown as TrakBox | undefined;
  if (!trakBox) return null;
  const stsd = trakBox.mdia?.minf?.stbl?.stsd;
  if (!stsd) return null;
  const entry = stsd.entries?.[0] as unknown as SampleEntryBox | undefined;
  if (!entry) return null;

  const candidate =
    entry.avcC ?? entry.hvcC ?? entry.av1C ?? entry.vpcC ?? null;
  if (!candidate) return null;

  // mp4box doesn't keep raw `.data` for these boxes by default; we serialise
  // the box back to bytes via DataStream then strip the 8-byte box header
  // (size + type). The remaining payload is exactly the
  // AVCDecoderConfigurationRecord (or HEVCDecoderConfigurationRecord, etc.)
  // that WebCodecs and mp4-muxer expect as `description`.
  const stream = new (DataStream as unknown as new (
    arr?: ArrayBufferLike,
    offset?: number,
    endianness?: number,
  ) => DataStreamLike)(undefined, 0, 1 /* BIG_ENDIAN */);
  (candidate as { write: (s: DataStreamLike) => void }).write(stream);
  return new Uint8Array(stream.buffer, 8);
}

/* ---- mp4box internal types we depend on (declared loosely) ---- */
interface TrakBox {
  mdia?: { minf?: { stbl?: { stsd?: { entries?: SampleEntryBox[] } } } };
}
interface ConfigBox {
  data?: Uint8Array;
  write: (s: DataStreamLike) => void;
}
interface SampleEntryBox {
  avcC?: ConfigBox;
  hvcC?: ConfigBox;
  av1C?: ConfigBox;
  vpcC?: ConfigBox;
}
interface DataStreamLike {
  buffer: ArrayBuffer;
}
