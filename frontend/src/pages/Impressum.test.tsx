import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
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

const TEST_IMPRINT = {
  name: "Test Person",
  addressLine1: "Teststraße 1",
  addressLine2: "12345 Testhausen",
  country: "Deutschland",
  email: "test@example.org",
};

function configureImprint() {
  vi.stubEnv("VITE_IMPRESSUM_NAME", TEST_IMPRINT.name);
  vi.stubEnv("VITE_IMPRESSUM_ADDRESS_LINE_1", TEST_IMPRINT.addressLine1);
  vi.stubEnv("VITE_IMPRESSUM_ADDRESS_LINE_2", TEST_IMPRINT.addressLine2);
  vi.stubEnv("VITE_IMPRESSUM_COUNTRY", TEST_IMPRINT.country);
  vi.stubEnv("VITE_IMPRESSUM_EMAIL", TEST_IMPRINT.email);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Impressum page (configured)", () => {
  beforeEach(() => {
    configureImprint();
  });

  it("renders the operator's name and postal address from env vars", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toContain(TEST_IMPRINT.name);
    expect(text).toContain(TEST_IMPRINT.addressLine1);
    expect(text).toContain(TEST_IMPRINT.addressLine2);
    expect(text).toContain(TEST_IMPRINT.country);
  });

  it("renders the contact e-mail as a mailto link", () => {
    renderPage();
    const link = screen.getByRole("link", { name: TEST_IMPRINT.email });
    expect(link).toHaveAttribute("href", `mailto:${TEST_IMPRINT.email}`);
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

describe("Impressum page (unconfigured)", () => {
  // No env-var stubbing — every VITE_IMPRESSUM_* is absent.

  it("renders a clearly visible placeholder, not partial details", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/imprint not configured/i);
  });

  it("points the operator at the env-var schema", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/VITE_IMPRESSUM_/);
    expect(text).toMatch(/\.env\.example/);
  });

  it("does not render the test operator's name (no leak from other tests)", () => {
    renderPage();
    expect(document.body.textContent).not.toContain(TEST_IMPRINT.name);
  });
});
