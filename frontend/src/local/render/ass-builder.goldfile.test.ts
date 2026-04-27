import { describe, it, expect } from "vitest";
import { buildAss, type TextOverlay, type EnergyCurves } from "./ass-builder";

/**
 * Regression snapshot tests for the ASS builder.
 *
 * Earlier in development the goldfiles were produced by running the
 * Python backend's `app/pipeline/ass.py` and comparing bit-for-bit. The
 * backend has since been deleted (Phase 6) — these snapshots now serve
 * as a regression net for the TS-only code: any change to the builder
 * has to be deliberate enough to update the snapshot.
 */

const FIXTURES: Array<{
  name: string;
  width: number;
  height: number;
  overlays: TextOverlay[];
  energy?: EnergyCurves | null;
}> = [
  {
    name: "single-fade",
    width: 1280,
    height: 720,
    overlays: [
      {
        text: "Hello world",
        start: 1.5,
        end: 4.0,
        preset: "plain",
        x: 0.5,
        y: 0.85,
        animation: "fade",
        reactiveBand: null,
        reactiveParam: "scale",
        reactiveAmount: 0.3,
      },
    ],
  },
  {
    name: "wobble-and-pop",
    width: 1920,
    height: 1080,
    overlays: [
      {
        text: "LIVE!",
        start: 0.0,
        end: 2.0,
        preset: "glow",
        x: 0.2,
        y: 0.1,
        animation: "wobble",
        reactiveBand: null,
        reactiveParam: "scale",
        reactiveAmount: 0.3,
      },
      {
        text: "POP",
        start: 2.0,
        end: 3.5,
        preset: "boxed",
        x: 0.8,
        y: 0.5,
        animation: "pop",
        reactiveBand: null,
        reactiveParam: "scale",
        reactiveAmount: 0.3,
      },
    ],
  },
];

describe("ass-builder regression snapshots", () => {
  for (const fx of FIXTURES) {
    it(`${fx.name}: builder output is stable`, () => {
      const out = buildAss(fx.overlays, fx.width, fx.height, fx.energy ?? null);
      expect(out).toMatchSnapshot();
    });
  }

  it("reactive scale modulation produces banker-rounded scale tags", () => {
    const energy: EnergyCurves = {
      fps: 30,
      frames: 90,
      bands: {
        bass: Array.from({ length: 90 }, (_, i) =>
          Math.round((Math.min(i, 89 - i) / 45) * 10000) / 10000,
        ),
      },
    };
    const out = buildAss(
      [
        {
          text: "React",
          start: 0,
          end: 3,
          preset: "gradient",
          x: 0.5,
          y: 0.5,
          animation: "fade",
          reactiveBand: "bass",
          reactiveParam: "scale",
          reactiveAmount: 0.4,
        },
      ],
      1280,
      720,
      energy,
    );
    expect(out).toMatchSnapshot();
  });
});
