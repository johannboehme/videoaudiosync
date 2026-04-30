import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readScale } from "./feature-flag";

const origSearch = window.location.search;

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/" + (origSearch ?? ""));
});

function setSearch(s: string): void {
  window.history.replaceState({}, "", "/" + s);
}

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
    setSearch("?compositorScale=0.05");
    expect(readScale()).toBe(1);
    setSearch("?compositorScale=3");
    expect(readScale()).toBe(1);
  });
});
