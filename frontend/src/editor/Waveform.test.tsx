import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Waveform } from "./Waveform";

const peaks = Array.from({ length: 20 }, (_, i) => [-i / 20, i / 20] as [number, number]);

describe("Waveform", () => {
  it("renders an SVG with one rect per peak bucket plus a playhead", () => {
    const { container } = render(<Waveform peaks={peaks} duration={10} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    // peak bars + 1 playhead rect
    expect(svg!.querySelectorAll("rect").length).toBe(peaks.length + 1);
  });

  it("draws a playhead at the right position based on currentTime", () => {
    const { container } = render(
      <Waveform peaks={peaks} duration={10} currentTime={5} />,
    );
    const playhead = container.querySelector('[data-testid="playhead"]');
    expect(playhead).toBeTruthy();
    // x should be at 50% of width
    expect(playhead!.getAttribute("x")).toBeTruthy();
  });

  it("calls onSeek with the time when clicked", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <Waveform peaks={peaks} duration={10} onSeek={onSeek} />,
    );
    const svg = container.querySelector("svg")!;
    // jsdom returns getBoundingClientRect width=0; mock it
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 200, bottom: 50, width: 200, height: 50 }),
      writable: true,
    });
    fireEvent.click(svg, { clientX: 100, clientY: 25 });
    expect(onSeek).toHaveBeenCalledWith(5); // 100/200 * 10s = 5s
  });

  it("renders a kept-segment shaded region when segments prop is given", () => {
    const { container } = render(
      <Waveform
        peaks={peaks}
        duration={10}
        segments={[{ in: 2, out: 7 }]}
      />,
    );
    const region = container.querySelector('[data-testid="segment-0"]');
    expect(region).toBeTruthy();
  });
});
