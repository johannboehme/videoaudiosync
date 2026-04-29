import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { HelpOverlay } from "./HelpOverlay";
import { useShortcutRegistry, registerShortcut } from "../shortcuts/registry";

function pressKey(key: string, opts: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ...opts });
}

describe("HelpOverlay", () => {
  beforeEach(() => {
    cleanup();
    useShortcutRegistry.setState({ shortcuts: [] });
  });

  it("is hidden by default", () => {
    render(<HelpOverlay />);
    expect(screen.queryByTestId("help-overlay")).toBeNull();
  });

  it("opens on `?` and closes on `?` again", async () => {
    render(<HelpOverlay />);
    pressKey("?");
    expect(await screen.findByTestId("help-overlay")).toBeInTheDocument();
    pressKey("?");
    // Wait for AnimatePresence exit to complete by polling
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId("help-overlay")).toBeNull();
  });

  it("closes on Escape", async () => {
    render(<HelpOverlay />);
    pressKey("?");
    expect(await screen.findByTestId("help-overlay")).toBeInTheDocument();
    pressKey("Escape");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId("help-overlay")).toBeNull();
  });

  it("closes when the close button is clicked", async () => {
    render(<HelpOverlay />);
    pressKey("?");
    const close = await screen.findByTestId("help-overlay-close");
    fireEvent.click(close);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId("help-overlay")).toBeNull();
  });

  it("does not toggle when typing in an INPUT", () => {
    render(
      <>
        <HelpOverlay />
        <input data-testid="text" />
      </>,
    );
    const input = screen.getByTestId("text");
    input.focus();
    fireEvent.keyDown(input, { key: "?" });
    expect(screen.queryByTestId("help-overlay")).toBeNull();
  });

  it("ignores ? when a modifier is held", () => {
    render(<HelpOverlay />);
    pressKey("?", { metaKey: true });
    expect(screen.queryByTestId("help-overlay")).toBeNull();
  });

  it("opens on Shift+/ even when e.key is reported as '/' (US-layout fallback)", async () => {
    render(<HelpOverlay />);
    pressKey("/", { shiftKey: true, code: "Slash" });
    expect(await screen.findByTestId("help-overlay")).toBeInTheDocument();
  });

  it("opens on Shift+ß even when e.key is reported as 'ß' (DE-layout fallback)", async () => {
    render(<HelpOverlay />);
    pressKey("ß", { shiftKey: true, code: "Minus" });
    expect(await screen.findByTestId("help-overlay")).toBeInTheDocument();
  });

  it("renders registered shortcuts grouped, in declared group order", async () => {
    registerShortcut({
      id: "fx.vignette",
      keys: ["F"],
      description: "Hold to record a vignette FX",
      group: "FX",
    });
    registerShortcut({
      id: "transport.play",
      keys: ["Space", "K"],
      description: "Play / pause",
      group: "Transport",
    });
    render(<HelpOverlay />);
    pressKey("?");
    const dialog = await screen.findByTestId("help-overlay");
    const headings = dialog.querySelectorAll("h3");
    expect([...headings].map((h) => h.textContent)).toEqual([
      "Transport",
      "FX",
    ]);
    expect(dialog.textContent).toContain("Play / pause");
    expect(dialog.textContent).toContain("Hold to record a vignette FX");
    // Both keys for the play/pause row should render as keycaps.
    expect(dialog.textContent).toContain("Space");
    expect(dialog.textContent).toContain("K");
  });

  it("shows an empty-state hint when no shortcuts are registered", async () => {
    render(<HelpOverlay />);
    pressKey("?");
    const dialog = await screen.findByTestId("help-overlay");
    expect(dialog.textContent).toContain("No shortcuts registered yet.");
  });
});
