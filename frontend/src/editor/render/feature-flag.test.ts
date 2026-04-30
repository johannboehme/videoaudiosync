/**
 * Tests for the V2 feature flag readers. The exported `_ENABLED` /
 * `_INITIAL_SCALE` constants are evaluated at module-load time; the
 * underlying `readEnabled` / `readScale` functions are exported so we
 * can drive them with controlled URL / localStorage state and assert
 * the parsing rules without re-importing the module.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEnabled, readScale } from "./feature-flag";

const origSearch = window.location.search;

beforeEach(() => {
  window.localStorage.clear();
  // jsdom lets us overwrite location.search via this trick.
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/" + (origSearch ?? ""));
});

function setSearch(s: string): void {
  window.history.replaceState({}, "", "/" + s);
}

describe("readEnabled — V2 flag", () => {
  it("returns false when no URL param and no localStorage entry", () => {
    expect(readEnabled()).toBe(false);
  });

  it("returns true when URL param ?compositor=v2 is present", () => {
    setSearch("?compositor=v2");
    expect(readEnabled()).toBe(true);
  });

  it("returns true when localStorage vasCompositor === 'v2'", () => {
    window.localStorage.setItem("vasCompositor", "v2");
    expect(readEnabled()).toBe(true);
  });

  it("returns false for any other URL or localStorage value", () => {
    setSearch("?compositor=v3");
    expect(readEnabled()).toBe(false);
    window.localStorage.setItem("vasCompositor", "true");
    expect(readEnabled()).toBe(false);
  });
});

describe("readScale — initial backbuffer scale dial", () => {
  it("defaults to 1 with no override", () => {
    expect(readScale()).toBe(1);
  });

  it("reads URL param compositorScale", () => {
    setSearch("?compositorScale=0.75");
    expect(readScale()).toBe(0.75);
  });

  it("reads localStorage vasCompositorScale", () => {
    window.localStorage.setItem("vasCompositorScale", "0.5");
    expect(readScale()).toBe(0.5);
  });

  it("URL param wins over localStorage", () => {
    setSearch("?compositorScale=0.6");
    window.localStorage.setItem("vasCompositorScale", "0.9");
    expect(readScale()).toBe(0.6);
  });

  it("returns 1 (safe default) for non-numeric values", () => {
    setSearch("?compositorScale=abc");
    expect(readScale()).toBe(1);
  });

  it("returns 1 for out-of-range values to keep the preview usable", () => {
    setSearch("?compositorScale=0.05"); // < 0.1
    expect(readScale()).toBe(1);
    setSearch("?compositorScale=3"); // > 2
    expect(readScale()).toBe(1);
  });
});
