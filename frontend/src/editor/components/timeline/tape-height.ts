/** Strip-height per ProgramStrip mode. Same in every mode now: in `both`
 *  the cuts and fx halves split this height vertically, so the timeline
 *  layout never shifts when the user toggles the program-strip view. */
export function tapeHeightForMode(_mode: "cuts" | "fx" | "both"): number {
  return 36;
}
