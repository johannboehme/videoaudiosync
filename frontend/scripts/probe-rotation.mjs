// Inspect mp4box's track metadata to find the rotation matrix.
import { readFileSync } from "node:fs";
import MP4Box from "mp4box";

const path = process.argv[2] ?? "/Users/devien/Downloads/20260428_173111.mp4";
const buf = readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
ab.fileStart = 0;

const file = MP4Box.createFile();
file.onReady = (info) => {
  for (const t of info.videoTracks ?? []) {
    console.log("track id:", t.id);
    console.log("  codec:", t.codec);
    console.log("  width × height:", t.video?.width, "×", t.video?.height);
    console.log("  fps:", t.nb_samples, "samples /", t.duration / t.timescale, "s");
    console.log("  ALL keys:", Object.keys(t).join(", "));
    if (t.matrix) {
      console.log("  matrix:", JSON.stringify(t.matrix));
      // 9-element matrix in [a,b,u,c,d,v,x,y,w] order, 16.16 fixed
      // (or 2.30 for u,v,w). Rotation comes from a,b,c,d.
      const a = t.matrix[0] / 65536;
      const b = t.matrix[1] / 65536;
      const c = t.matrix[3] / 65536;
      const d = t.matrix[4] / 65536;
      console.log(`    a=${a.toFixed(3)} b=${b.toFixed(3)} c=${c.toFixed(3)} d=${d.toFixed(3)}`);
      // The rotation angle is atan2(b, a) — for a pure rotation this is the
      // counter-clockwise angle the source would be rotated to display upright.
      const rotRad = Math.atan2(b, a);
      const rotDeg = (rotRad * 180) / Math.PI;
      console.log(`    rotation (atan2 b,a): ${rotDeg.toFixed(1)}°`);
    } else {
      console.log("  matrix: <none on track>");
    }
  }
  // Also look at the trak box directly
  const traks = file.moov?.boxes?.filter?.((b) => b.type === "trak") ?? [];
  console.log("\ntrak count:", traks.length);
  for (const trak of traks) {
    const tkhd = trak.boxes?.find?.((b) => b.type === "tkhd");
    if (tkhd) {
      console.log("  tkhd matrix:", JSON.stringify(tkhd.matrix));
    }
  }
};
file.appendBuffer(ab);
file.flush();
