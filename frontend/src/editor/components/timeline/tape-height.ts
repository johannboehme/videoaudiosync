/** Strip-height per ProgramStrip mode. Lives in its own module so Vite's
 *  fast-refresh can keep treating ProgramStrip.tsx as a pure component
 *  file (only-component-exports). cuts mode is unchanged so existing
 *  layouts don't shift when the user has no FX in the project. */
export function tapeHeightForMode(mode: "cuts" | "fx" | "both"): number {
  if (mode === "fx") return 36;
  if (mode === "both") return 50;
  return 32;
}
