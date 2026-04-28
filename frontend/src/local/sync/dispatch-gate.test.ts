import { describe, it, expect, beforeEach } from "vitest";
import { pauseSync, resumeSync, isSyncPaused } from "./index";

describe("sync dispatch gate", () => {
  beforeEach(() => {
    // Ensure each test starts with the gate open.
    resumeSync();
  });

  it("starts open", () => {
    expect(isSyncPaused()).toBe(false);
  });

  it("pauseSync closes the gate", () => {
    pauseSync();
    expect(isSyncPaused()).toBe(true);
    resumeSync();
  });

  it("resumeSync re-opens the gate", () => {
    pauseSync();
    resumeSync();
    expect(isSyncPaused()).toBe(false);
  });

  it("pauseSync is idempotent (no second deferred created)", () => {
    pauseSync();
    pauseSync();
    expect(isSyncPaused()).toBe(true);
    resumeSync();
    expect(isSyncPaused()).toBe(false);
  });

  it("resumeSync is a no-op when already open", () => {
    expect(() => resumeSync()).not.toThrow();
    expect(isSyncPaused()).toBe(false);
  });
});
