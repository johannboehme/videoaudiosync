import { type Capabilities, describeCapability, meetsMinRequirements } from "../local/capabilities";

const ALL_KEYS: ReadonlyArray<keyof Capabilities> = [
  "webAssembly",
  "sharedArrayBuffer",
  "crossOriginIsolated",
  "opfs",
  "audioDecoder",
  "videoDecoder",
  "audioEncoder",
  "videoEncoder",
  "fileSystemAccess",
];

interface RenderPath {
  label: string;
  detail: string;
}

function pickRenderPath(caps: Capabilities): RenderPath {
  if (caps.videoEncoder && caps.audioEncoder) {
    return {
      label: "WebCodecs (HW)",
      detail: "Hardware-accelerated H.264 + AAC via the browser's native codecs.",
    };
  }
  if (caps.audioDecoder && caps.videoDecoder) {
    return {
      label: "ffmpeg.wasm encode + WebCodecs decode",
      detail:
        "The browser cannot encode video natively yet, so encoding falls back to ffmpeg.wasm in the browser.",
    };
  }
  return {
    label: "ffmpeg.wasm",
    detail:
      "Both decode and encode run via ffmpeg.wasm in the browser. Slower than WebCodecs, still upload-free.",
  };
}

interface SettingsProps {
  caps: Capabilities;
}

export function Settings({ caps }: SettingsProps) {
  const min = meetsMinRequirements(caps);
  const renderPath = pickRenderPath(caps);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <header>
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="text-sm opacity-70">
          What this browser can do, and how this app will use it.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Status</h2>
        <div data-testid="min-status" className="rounded-lg border p-4">
          {min.ok ? (
            <>
              <strong>Ready.</strong> All minimum requirements are met.
            </>
          ) : (
            <>
              <strong>Not ready.</strong> Missing:{" "}
              {min.missing.map(describeCapability).join(", ")}.
            </>
          )}
        </div>
        <div data-testid="render-path" className="rounded-lg border p-4">
          <div className="text-sm uppercase opacity-70">Render path</div>
          <div className="font-mono text-base">{renderPath.label}</div>
          <p className="mt-1 text-sm opacity-80">{renderPath.detail}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Browser capabilities</h2>
        <ul className="divide-y rounded-lg border">
          {ALL_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-center justify-between px-4 py-2 text-sm"
              data-testid={`cap-${key}`}
            >
              <span>{describeCapability(key)}</span>
              <span className="font-mono">{caps[key] ? "✓" : "✗"}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
