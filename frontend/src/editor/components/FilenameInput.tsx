// Inline editable output filename. The container extension is fixed (driven
// by the format setting), so we render it as a static suffix the user can't
// accidentally clobber.

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** File extension (without dot). Default: mp4. */
  extension?: string;
}

const ILLEGAL = /[\\/:*?"<>|]/g;

export function FilenameInput({ value, onChange, extension = "mp4" }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">Filename</span>
      <div className="flex items-stretch h-10 rounded-md border border-rule bg-paper-hi overflow-hidden focus-within:ring-2 focus-within:ring-hot/40">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(ILLEGAL, ""))}
          spellCheck={false}
          className="flex-1 px-3 bg-transparent font-mono text-sm text-ink outline-none"
          placeholder="my-edit"
        />
        <span className="px-3 flex items-center font-mono text-sm tabular text-ink-3 bg-paper-deep border-l border-rule">
          .{extension}
        </span>
      </div>
    </div>
  );
}
