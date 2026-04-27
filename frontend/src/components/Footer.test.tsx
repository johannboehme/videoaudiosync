import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Footer } from "./Footer";

function renderFooter() {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
}

describe("Footer", () => {
  it("links to the Impressum page", () => {
    renderFooter();
    const link = screen.getByRole("link", { name: /impressum/i });
    expect(link).toHaveAttribute("href", "/impressum");
  });

  it("links to the Datenschutz page", () => {
    renderFooter();
    const link = screen.getByRole("link", { name: /datenschutz/i });
    expect(link).toHaveAttribute("href", "/datenschutz");
  });
});
