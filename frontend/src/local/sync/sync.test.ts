import { describe, it, expect } from "vitest";
import { mapWasmResult } from "./index";

describe("mapWasmResult — sync-core DTO mapping", () => {
  it("maps the primary fields from snake_case to camelCase", () => {
    const result = mapWasmResult({
      offset_ms: 250.5,
      confidence: 0.87,
      drift_ratio: 1.0001,
      method: "chroma+onset",
      warning: null,
      candidates: [],
    });
    expect(result.offsetMs).toBe(250.5);
    expect(result.confidence).toBe(0.87);
    expect(result.driftRatio).toBe(1.0001);
    expect(result.method).toBe("chroma+onset");
    expect(result.warning).toBeNull();
  });

  it("maps the candidates array (snake_case → camelCase) preserving order", () => {
    const result = mapWasmResult({
      offset_ms: 100,
      confidence: 0.9,
      drift_ratio: 1.0,
      method: "chroma",
      warning: null,
      candidates: [
        { offset_ms: 100, confidence: 0.9, overlap_frames: 1024 },
        { offset_ms: 600, confidence: 0.6, overlap_frames: 900 },
        { offset_ms: -200, confidence: 0.3, overlap_frames: 500 },
      ],
    });
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]).toEqual({
      offsetMs: 100,
      confidence: 0.9,
      overlapFrames: 1024,
    });
    expect(result.candidates[1]).toEqual({
      offsetMs: 600,
      confidence: 0.6,
      overlapFrames: 900,
    });
    expect(result.candidates[2].offsetMs).toBe(-200);
  });

  it("defaults candidates to an empty array if absent (legacy WASM)", () => {
    const result = mapWasmResult({
      offset_ms: 0,
      confidence: 0.5,
      drift_ratio: 1.0,
      method: "fallback",
      warning: "low confidence",
      // candidates intentionally omitted
    } as Parameters<typeof mapWasmResult>[0]);
    expect(result.candidates).toEqual([]);
  });

  it("maps Tier 1.2 discrimination metrics (PSR / PNR) when present", () => {
    const result = mapWasmResult({
      offset_ms: 0,
      confidence: 0.9,
      drift_ratio: 1.0,
      method: "ncc+onset",
      warning: null,
      candidates: [],
      peak_to_second_ratio: 3.4,
      peak_to_noise: 12.5,
    });
    expect(result.peakToSecondRatio).toBe(3.4);
    expect(result.peakToNoise).toBe(12.5);
  });

  it("falls back to +Infinity when Tier 1.2 fields are missing (legacy WASM)", () => {
    const result = mapWasmResult({
      offset_ms: 0,
      confidence: 0.9,
      drift_ratio: 1.0,
      method: "ncc+onset",
      warning: null,
      candidates: [],
      // peak_to_second_ratio + peak_to_noise omitted
    });
    expect(result.peakToSecondRatio).toBe(Number.POSITIVE_INFINITY);
    expect(result.peakToNoise).toBe(Number.POSITIVE_INFINITY);
  });
});
