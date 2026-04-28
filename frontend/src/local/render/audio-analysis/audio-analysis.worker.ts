/// <reference lib="webworker" />
/**
 * Audio-analysis worker. Single message-protocol entry: receive a PCM
 * Float32Array + sample rate, return AudioAnalysis. Runs on its own thread
 * so the main thread stays interactive while the analysis (~5–10 s on M1
 * for a 5-min track) computes.
 */
import { analyzeAudio } from "./analyze";
import type { AudioAnalysis } from "./types";

interface AnalyzeRequest {
  type: "analyze";
  id: number;
  pcm: Float32Array;
  sampleRate: number;
}

interface AnalyzeResult {
  type: "result";
  id: number;
  analysis: AudioAnalysis;
}

interface AnalyzeError {
  type: "error";
  id: number;
  message: string;
}

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const msg = e.data;
  if (msg.type !== "analyze") return;
  try {
    const analysis = analyzeAudio(msg.pcm, msg.sampleRate);
    const reply: AnalyzeResult = { type: "result", id: msg.id, analysis };
    (self as DedicatedWorkerGlobalScope).postMessage(reply);
  } catch (err) {
    const reply: AnalyzeError = {
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as DedicatedWorkerGlobalScope).postMessage(reply);
  }
};
