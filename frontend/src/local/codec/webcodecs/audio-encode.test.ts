// Unit-level coverage for `encodeAudioFromPcm`'s codec-fallback +
// failure-mode handling. We mock WebCodecs in jsdom so this runs in the
// fast unit suite — the real-codec roundtrip still lives in the
// `.browser.test.ts` sibling.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeAudioFromPcm,
  isAudioCodecSupported,
} from "./audio-encode";

interface MockEncoderState {
  emitChunks: number;
  description?: Uint8Array;
  /** When set, fire the error callback with this on the first encode(). */
  errorOnFirstEncode?: Error;
}

function installMockWebCodecs(state: MockEncoderState, supportedCodecs: Set<string>) {
  // AudioData stand-in — we only need close().
  (globalThis as unknown as { AudioData: unknown }).AudioData = class {
    constructor(_init: unknown) {}
    close() {}
  };

  class MockAudioEncoder {
    static isConfigSupported = vi.fn(async (cfg: { codec: string }) => ({
      supported: supportedCodecs.has(cfg.codec),
      config: cfg,
    }));
    private out: (chunk: { byteLength: number; copyTo: (b: Uint8Array) => void; type: string; timestamp: number; duration?: number }, meta: unknown) => void;
    private err: (e: Error) => void;
    private firedFirst = false;
    private firedDescription = false;
    constructor(init: { output: MockAudioEncoder["out"]; error: MockAudioEncoder["err"] }) {
      this.out = init.output;
      this.err = init.error;
    }
    configure(_cfg: unknown) {
      /* noop */
    }
    encode(_d: unknown) {
      if (state.errorOnFirstEncode && !this.firedFirst) {
        this.firedFirst = true;
        this.err(state.errorOnFirstEncode);
        return;
      }
      this.firedFirst = true;
      // Don't actually emit on every encode — emit a fixed number of
      // chunks matching `state.emitChunks` total.
    }
    async flush() {
      for (let i = 0; i < state.emitChunks; i++) {
        const meta = !this.firedDescription
          ? {
              decoderConfig: {
                description: state.description ?? new Uint8Array([1, 2, 3, 4]),
              },
            }
          : undefined;
        this.firedDescription = true;
        this.out(
          {
            byteLength: 4,
            copyTo: (b: Uint8Array) => {
              b[0] = 0xaa;
              b[1] = 0xbb;
              b[2] = 0xcc;
              b[3] = 0xdd;
            },
            type: "key",
            timestamp: i * 21333,
            duration: 21333,
          },
          meta,
        );
      }
    }
    close() {}
  }
  (globalThis as unknown as { AudioEncoder: unknown }).AudioEncoder = MockAudioEncoder;
  return MockAudioEncoder;
}

const ORIGINAL = {
  AudioEncoder: (globalThis as { AudioEncoder?: unknown }).AudioEncoder,
  AudioData: (globalThis as { AudioData?: unknown }).AudioData,
};

afterEach(() => {
  if (ORIGINAL.AudioEncoder === undefined) {
    delete (globalThis as { AudioEncoder?: unknown }).AudioEncoder;
  } else {
    (globalThis as unknown as { AudioEncoder: unknown }).AudioEncoder = ORIGINAL.AudioEncoder;
  }
  if (ORIGINAL.AudioData === undefined) {
    delete (globalThis as { AudioData?: unknown }).AudioData;
  } else {
    (globalThis as unknown as { AudioData: unknown }).AudioData = ORIGINAL.AudioData;
  }
});

describe("isAudioCodecSupported", () => {
  it("returns false when AudioEncoder is unavailable", async () => {
    delete (globalThis as { AudioEncoder?: unknown }).AudioEncoder;
    const ok = await isAudioCodecSupported("aac", 48000, 2);
    expect(ok).toBe(false);
  });

  it("delegates to AudioEncoder.isConfigSupported", async () => {
    installMockWebCodecs({ emitChunks: 1 }, new Set(["mp4a.40.2"]));
    expect(await isAudioCodecSupported("aac", 48000, 2)).toBe(true);
    expect(await isAudioCodecSupported("opus", 48000, 2)).toBe(false);
  });
});

describe("encodeAudioFromPcm — failure modes that used to ship a silent track", () => {
  beforeEach(() => {
    // 200 samples mono — encoder receives a few frames, emits per-frame.
    // The encode() mock ignores input and we control chunk count via
    // state.emitChunks, so the actual PCM length only affects the loop.
  });

  it("falls back to Opus when AAC is unsupported (iOS-Safari sim)", async () => {
    installMockWebCodecs({ emitChunks: 3 }, new Set(["opus"]));
    const pcm = new Float32Array(48000); // 1 s mono
    const result = await encodeAudioFromPcm(pcm, {
      numberOfChannels: 1,
      sampleRate: 48000,
      codec: "aac",
    });
    expect(result.muxerCodec).toBe("opus");
    expect(result.codec).toBe("opus");
    expect(result.chunks.length).toBe(3);
  });

  it("throws clearly when neither codec is supported", async () => {
    installMockWebCodecs({ emitChunks: 1 }, new Set());
    const pcm = new Float32Array(48000);
    await expect(
      encodeAudioFromPcm(pcm, {
        numberOfChannels: 1,
        sampleRate: 48000,
        codec: "aac",
      }),
    ).rejects.toThrow(/cannot encode AAC or Opus/);
  });

  it("throws when the encoder fires an async error mid-stream", async () => {
    // Same regression we just fixed: the old code's `error: (e) => { throw e }`
    // was a no-op and produced an under-filled chunks array silently.
    installMockWebCodecs(
      {
        emitChunks: 1,
        errorOnFirstEncode: new Error("simulated platform failure"),
      },
      new Set(["mp4a.40.2"]),
    );
    const pcm = new Float32Array(48000);
    await expect(
      encodeAudioFromPcm(pcm, {
        numberOfChannels: 1,
        sampleRate: 48000,
        codec: "aac",
      }),
    ).rejects.toThrow(/simulated platform failure/);
  });

  it("throws when the encoder configures but produces 0 chunks", async () => {
    // The literal "exported file has no audio" symptom: encoder seemed
    // OK but never emitted data.
    installMockWebCodecs({ emitChunks: 0 }, new Set(["mp4a.40.2"]));
    const pcm = new Float32Array(48000);
    await expect(
      encodeAudioFromPcm(pcm, {
        numberOfChannels: 1,
        sampleRate: 48000,
        codec: "aac",
      }),
    ).rejects.toThrow(/produced 0 chunks/);
  });

  it("returns the AAC chunks when AAC IS supported (desktop happy path)", async () => {
    installMockWebCodecs(
      { emitChunks: 5 },
      new Set(["mp4a.40.2", "opus"]),
    );
    const pcm = new Float32Array(48000);
    const result = await encodeAudioFromPcm(pcm, {
      numberOfChannels: 1,
      sampleRate: 48000,
      codec: "aac",
    });
    expect(result.muxerCodec).toBe("aac");
    expect(result.codec).toBe("mp4a.40.2");
    expect(result.chunks.length).toBe(5);
    expect(result.description).toBeDefined();
  });
});
