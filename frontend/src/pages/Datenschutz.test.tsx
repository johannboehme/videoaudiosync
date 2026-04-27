import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Datenschutz } from "./Datenschutz";

function renderPage() {
  return render(
    <MemoryRouter>
      <Datenschutz />
    </MemoryRouter>,
  );
}

describe("Datenschutz page", () => {
  it("links back to the Impressum for the responsible-party details", () => {
    renderPage();
    const link = screen.getByRole("link", { name: /impressum/i });
    expect(link).toHaveAttribute("href", "/impressum");
  });

  it("explains server-log handling: IP, anonymisation, retention", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/IP-Adresse/);
    expect(text).toMatch(/anonymisiert/i);
    expect(text).toMatch(/14\s*Tage/);
  });

  it("makes clear that media files never leave the browser", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Browser/);
    expect(text).toMatch(/(verlassen|kein\s+Upload|nicht\s+übertragen)/i);
  });

  it("discloses local storage (OPFS / IndexedDB) and absence of cookies/tracking", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/OPFS/);
    expect(text).toMatch(/IndexedDB/);
    expect(text).toMatch(/(keine\s+Cookies|kein\s+Tracking)/i);
  });

  it("affirms that web fonts are served from the own domain (no third parties)", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/(Schrift|Font)/i);
    // No live reference to Google Fonts or any other third-party CDN.
    expect(text).not.toMatch(/fonts\.googleapis\.com/i);
    expect(text).not.toMatch(/fonts\.gstatic\.com/i);
  });

  it("informs about DSGVO data-subject rights and supervisory authority", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/DSGVO/);
    expect(text).toMatch(/Aufsichtsbehörde/);
  });
});
