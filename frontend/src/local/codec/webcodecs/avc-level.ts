/**
 * Pick the lowest H.264 (AVC) level that supports a given resolution and
 * frame rate, and assemble a Constrained-Baseline codec string for it.
 *
 * The hardcoded default `avc1.42E01F` (Constrained Baseline @ Level 3.1)
 * caps out at 1280×720; passing anything larger to VideoEncoder.configure
 * throws "coded area exceeds the maximum coded area". Real phone footage
 * is typically 1080p or 1440p, so we need to compute the level per video.
 *
 * Reference: H.264 spec Annex A, Table A-1.
 *   MaxFS  = max frame size in macroblocks
 *   MaxMBPS = max macroblocks per second
 */

interface LevelEntry {
  /** Level identifier byte for the codec string (e.g. 0x1F = 3.1). */
  id: number;
  /** Max frame size in 16x16 macroblocks. */
  maxFs: number;
  /** Max macroblocks per second. */
  maxMbps: number;
}

const LEVELS: LevelEntry[] = [
  { id: 0x0a, maxFs: 99, maxMbps: 1485 },        // 1.0
  { id: 0x0b, maxFs: 396, maxMbps: 3000 },       // 1.1
  { id: 0x0c, maxFs: 396, maxMbps: 6000 },       // 1.2
  { id: 0x0d, maxFs: 396, maxMbps: 11880 },      // 1.3
  { id: 0x14, maxFs: 396, maxMbps: 11880 },      // 2.0
  { id: 0x15, maxFs: 792, maxMbps: 19800 },      // 2.1
  { id: 0x16, maxFs: 1620, maxMbps: 20250 },     // 2.2
  { id: 0x1e, maxFs: 1620, maxMbps: 40500 },     // 3.0
  { id: 0x1f, maxFs: 3600, maxMbps: 108000 },    // 3.1 (1280×720)
  { id: 0x20, maxFs: 5120, maxMbps: 216000 },    // 3.2
  { id: 0x28, maxFs: 8192, maxMbps: 245760 },    // 4.0 (2048×1024)
  { id: 0x29, maxFs: 8192, maxMbps: 245760 },    // 4.1
  { id: 0x2a, maxFs: 8704, maxMbps: 522240 },    // 4.2
  { id: 0x32, maxFs: 22080, maxMbps: 589824 },   // 5.0 (3672×1536)
  { id: 0x33, maxFs: 36864, maxMbps: 983040 },   // 5.1 (4096×2304)
  { id: 0x34, maxFs: 36864, maxMbps: 2073600 },  // 5.2
  { id: 0x3c, maxFs: 139264, maxMbps: 4177920 }, // 6.0 (8192×4352)
  { id: 0x3d, maxFs: 139264, maxMbps: 8355840 }, // 6.1
  { id: 0x3e, maxFs: 139264, maxMbps: 16711680 },// 6.2
];

/**
 * Returns the lowest level id whose MaxFS ≥ frame size and MaxMBPS ≥
 * (frame size × frame rate). Falls back to the highest level if no
 * match (not realistic for any real video but keeps the function total).
 */
export function pickAvcLevel(width: number, height: number, frameRate: number): number {
  const mbW = Math.ceil(width / 16);
  const mbH = Math.ceil(height / 16);
  const fs = mbW * mbH;
  const mbps = fs * Math.max(1, frameRate);
  for (const lvl of LEVELS) {
    if (lvl.maxFs >= fs && lvl.maxMbps >= mbps) return lvl.id;
  }
  return LEVELS[LEVELS.length - 1].id;
}

/**
 * Build a Constrained-Baseline codec string sized for the given
 * resolution + framerate.
 *
 * Format: `avc1.PPCCLL` where
 *   PP = profile_idc (0x42 = Baseline)
 *   CC = constraint_set flags (0xE0 = constrained baseline)
 *   LL = level_idc (lookup result)
 */
export function avcCodecForResolution(
  width: number,
  height: number,
  frameRate: number,
): string {
  const level = pickAvcLevel(width, height, frameRate);
  return `avc1.42E0${level.toString(16).toUpperCase().padStart(2, "0")}`;
}
