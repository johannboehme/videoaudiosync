// Source → Output dimension comparison. The hero element of the export
// dialog: at-a-glance answer to "what shape is this video going to be".
import { MonoReadout } from "./MonoReadout";

interface Dim {
  w: number;
  h: number;
}

interface Props {
  source: Dim;
  output: Dim;
}

function aspectLabel(d: Dim): string {
  if (d.w === 0 || d.h === 0) return "—";
  const r = greatestCommon(d.w, d.h);
  const aw = d.w / r;
  const ah = d.h / r;
  // Common aspects: prefer the canonical names users recognise.
  if (aw === 16 && ah === 9) return "16:9";
  if (aw === 9 && ah === 16) return "9:16";
  if (aw === 4 && ah === 3) return "4:3";
  if (aw === 3 && ah === 4) return "3:4";
  if (aw === 1 && ah === 1) return "1:1";
  if (aw === 21 && ah === 9) return "21:9";
  // Fall back to the simplified ratio when it's a small number, otherwise
  // a decimal — 1.50 reads better than 3:2 to most non-photographers.
  if (aw <= 32 && ah <= 32) return `${aw}:${ah}`;
  return (d.w / d.h).toFixed(2);
}

function greatestCommon(a: number, b: number): number {
  return b === 0 ? a : greatestCommon(b, a % b);
}

export function IOReadout({ source, output }: Props) {
  const matches =
    source.w === output.w && source.h === output.h;
  return (
    <div className="flex items-stretch gap-3">
      <Box label="SOURCE" w={source.w} h={source.h} aspect={aspectLabel(source)} />
      <div className="flex flex-col items-center justify-center gap-1 text-ink-3">
        <span className="font-mono text-[10px] tracking-label uppercase">{matches ? "PASS" : "SCALE"}</span>
        <span aria-hidden className="text-2xl leading-none">→</span>
      </div>
      <Box
        label="OUTPUT"
        w={output.w}
        h={output.h}
        aspect={aspectLabel(output)}
        accent
      />
    </div>
  );
}

function Box({
  label,
  w,
  h,
  aspect,
  accent = false,
}: {
  label: string;
  w: number;
  h: number;
  aspect: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <span className="label">{label}</span>
      <div
        className={[
          "rounded-md p-2.5 flex flex-col gap-1.5 border",
          accent ? "bg-paper-hi border-rule shadow-emboss" : "bg-paper-deep border-rule shadow-pressed",
        ].join(" ")}
      >
        <MonoReadout
          value={`${w}×${h}`}
          tone={accent ? "hot" : "default"}
          size="md"
          align="center"
          className="w-full"
        />
        <span className="font-mono text-[10px] tracking-label uppercase text-ink-3 text-center">
          {aspect}
        </span>
      </div>
    </div>
  );
}
