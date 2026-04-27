import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Impressum } from "./Impressum";

function renderPage() {
  return render(
    <MemoryRouter>
      <Impressum />
    </MemoryRouter>,
  );
}

describe("Impressum page", () => {
  it("names the responsible person and a postal address", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Johann Böhme/);
    expect(text).toMatch(/Haibacher Straße 2A/);
    expect(text).toMatch(/63768/);
    expect(text).toMatch(/Hösbach/);
  });

  it("provides a contact e-mail address", () => {
    renderPage();
    expect(document.body.textContent).toMatch(/johann\.boehme@web\.de/);
  });

  it("cites the legal basis (DDG / MStV)", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/§\s*5\s*DDG/);
    expect(text).toMatch(/§\s*18\s*(?:Abs\.\s*2\s*)?MStV/);
  });

  it("lists the FFmpeg LGPL attribution with a source link", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/FFmpeg/);
    expect(text).toMatch(/LGPL/);
    const ffmpegLink = screen.getByRole("link", { name: /ffmpeg\.org/i });
    expect(ffmpegLink).toHaveAttribute("href", "https://ffmpeg.org");
  });

  it("includes a liability disclaimer", () => {
    renderPage();
    expect(document.body.textContent).toMatch(/Haftung/);
  });
});
