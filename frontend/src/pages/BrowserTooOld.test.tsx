import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserTooOld } from "./BrowserTooOld";

describe("BrowserTooOld page", () => {
  it("lists every missing capability with a human-readable name", () => {
    render(<BrowserTooOld missing={["opfs", "sharedArrayBuffer"]} />);
    expect(screen.getByText(/Origin Private File System/)).toBeInTheDocument();
    expect(screen.getByText(/SharedArrayBuffer/)).toBeInTheDocument();
  });

  it("recommends Chrome / Edge / Firefox / Safari with concrete versions", () => {
    render(<BrowserTooOld missing={["opfs"]} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Chrome/);
    expect(text).toMatch(/Edge/);
    expect(text).toMatch(/Firefox/);
    expect(text).toMatch(/Safari/);
  });
});
