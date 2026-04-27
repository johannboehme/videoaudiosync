/**
 * Pick the lowest HEVC (H.265) level that supports a given resolution and
 * frame rate, and assemble a Main-profile, Main-tier codec string for it.
 *
 * Symmetric to `avc-level.ts`. The codec-string format for HEVC is more
 * elaborate than AVC because the WebCodecs spec inherits the ISO/IEC
 * notation: `hev1.<profile_space.profile_idc>.<compat_flags>.<tier+level>.<constraints>`.
 *
 * Reference: ITU-T H.265 Annex A, Table A.6 / A.7 (max luma picture size,
 * max luma sample rate per second).
 */

interface LevelEntry {
  /** WebCodecs level marker — 30 × level (e.g. 3.1 → 93). */
  marker: number;
  /** Max luma sample count per picture (MaxLumaPS). */
  maxLumaPs: number;
  /** Max luma samples per second (MaxLumaSR). */
  maxLumaSr: number;
}

const LEVELS: LevelEntry[] = [
  { marker: 30,  maxLumaPs: 36_864,     maxLumaSr: 552_960 },        // 1.0
  { marker: 60,  maxLumaPs: 122_880,    maxLumaSr: 3_686_400 },      // 2.0
  { marker: 63,  maxLumaPs: 245_760,    maxLumaSr: 7_372_800 },      // 2.1
  { marker: 90,  maxLumaPs: 552_960,    maxLumaSr: 16_588_800 },     // 3.0
  { marker: 93,  maxLumaPs: 983_040,    maxLumaSr: 33_177_600 },     // 3.1 (1280×720)
  { marker: 120, maxLumaPs: 2_228_224,  maxLumaSr: 66_846_720 },     // 4.0 (1920×1080)
  { marker: 123, maxLumaPs: 2_228_224,  maxLumaSr: 133_693_440 },    // 4.1
  { marker: 150, maxLumaPs: 8_912_896,  maxLumaSr: 267_386_880 },    // 5.0 (3840×2160)
  { marker: 153, maxLumaPs: 8_912_896,  maxLumaSr: 534_773_760 },    // 5.1 (4096×2160)
  { marker: 156, maxLumaPs: 8_912_896,  maxLumaSr: 1_069_547_520 },  // 5.2
  { marker: 180, maxLumaPs: 35_651_584, maxLumaSr: 1_069_547_520 },  // 6.0
];

/**
 * Returns the lowest level whose constraints cover the given resolution +
 * framerate. Falls back to the highest level on overshoot.
 */
export function pickHevcLevel(
  width: number,
  height: number,
  frameRate: number,
): number {
  const lumaPs = width * height;
  const lumaSr = lumaPs * Math.max(1, frameRate);
  for (const lvl of LEVELS) {
    if (lvl.maxLumaPs >= lumaPs && lvl.maxLumaSr >= lumaSr) return lvl.marker;
  }
  return LEVELS[LEVELS.length - 1].marker;
}

/**
 * Build a Main-profile, Main-tier HEVC codec string for the given output
 * resolution + framerate.
 *
 * Format: `hev1.<ps>.<compat_flags>.L<level>.B0`
 *   ps           = profile space (0) × 32 + profile_idc (1 = Main) → "1"
 *   compat_flags = profile_compatibility_flags reversed-bit hex → "6" for Main
 *   L<level>     = "L" + level marker (Main tier; "H" would be High tier)
 *   B0           = 6 constraint flag bytes; "B0" = 0xB0 first byte, rest zero
 */
export function hevcCodecForResolution(
  width: number,
  height: number,
  frameRate: number,
): string {
  const level = pickHevcLevel(width, height, frameRate);
  return `hev1.1.6.L${level}.B0`;
}
