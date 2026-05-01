# TK-1 — Take One

**Take 1.** A small, opinionated multi-cam music video editor for
musicians who want to *play the edit*, not configure one.

You record yourself playing along on whatever you have: phone,
Ray-Bans, three GoPros on tripods. You also have the clean studio
mix as MP3 or WAV. Drop both in the browser. TK-1 aligns every
camera angle to the studio audio, opens a multi-track editor, and
renders an MP4 you can post.

Nothing leaves your laptop. No upload, no account; the editor and
the render both run in the browser tab.

**Live demo:** <https://tk-1.app>

<p align="center">
  <img src=".github/screenshots/01-upload.png" alt="Drop the song. Drop your videos. Build the cut." width="900">
</p>

## Played, not edited

The visual language and the workflow are both shamelessly inspired
by Teenage Engineering. The OP-1, the OP-Z, the Pocket Operators:
devices that pick one job and design every surface around being
*operated*, not configured. The brass-plate LCDs, the chunky cam-pad
keys, the tap-or-hold semantics, the quantize-on-hold preview. They're
here because this editor should feel like a sampler.

The expected loop is: hit `Space`, watch the song play, tap
`1`/`2`/`3` to switch cams in real-time like you're punching pads,
hold a pad over the chorus to drop a vignette, hit `Q` to glance at
how everything looks quantized to the beat grid, release. Then play
it back and adjust.

Most "shortform video tools" are timeline editors with a phone
preset. Most "pro NLEs" put a six-pane workspace, a project file,
an asset bin and a render queue between you and a 22-second clip.
This sits between those: *"that song, those phone takes, one
finished video,"* designed to be played live.

## How it plays

### Lining up the takes

Drop the studio audio plus however many video angles you have. The
app pulls 12-bin chroma features out of the phone audio and the
studio audio, cross-correlates them, refines the result with a
sliding-window drift pass, and falls back to chroma-DTW when
confidence is low. Each cam ends up with an algorithmic offset and
a confidence number. Bad takes are flagged; good takes are usable
on the first try.

Written in Rust, compiled to WASM, runs inside the page.

### Snap to the bar, or to where the take actually is

Beat detection runs on the master audio and you get a real beat
grid: 4/4 by default, configurable, with a bar-1 pickup so the grid
lines up with the *song* and not with sample 0.

When you drag a clip on the timeline, snap goes to the grid (whole,
half, quarter, eighth, sixteenth) or to the audio-match positions
where the take itself plays a downbeat. So you're not snapping to
"the nearest beat"; you're snapping to "the place where the take
actually plays the downbeat."

Hold `Q` to live-preview the whole timeline quantized to the active
grid. Release to commit, `Esc` to cancel. You can re-time a whole
edit in about a second.

<p align="center">
  <img src=".github/screenshots/04-editor-sync.png" alt="Editor with sync tuner, match lane, multi-cam timeline" width="900">
</p>

### Cam keys: tap to cut, hold to paint

`1`–`9` are your cam pads. Tapping a number drops a single cut at
the playhead to that cam. Holding it paints that cam over the lane
while the song plays under your finger. Cuts are exclusive: one cam
at a time, by design — that's what a cut *is* — and they live on a
dedicated CUTS rail you can solo with the `BOTH` / `CUTS` / `FX`
mode picker.

There's no asset bin, no nested timelines, no "create a sequence."
There's a **MASTER · AUDIO** track at the bottom, one lane per cam
above it, and number keys.

### Punch-in FX, on a pad bank

A separate FX rail above the cam lanes, with seven pads: vignette,
wear, echo, rgb, tape, zoom, uv. Tap a pad to stamp a one-beat FX
at the playhead; hold it to paint under your finger as the song
plays. FX stack — they don't replace each other.

`X` is the eraser. Hold it to wipe FX under the playhead; combine
with a pad key (`X+V`, `X+W`, ...) to wipe only that kind. The same
eraser also splits and trims clips on the cam lanes.

Vignette has the shipping renderer right now. The other six pads
are placeholder visuals while their renderers come online; the pad
mechanics, the timeline model and the eraser already work on every
kind today.

### Output frame is whatever you brought

The output frame grows to fit whatever cams are active. Drop a
portrait phone clip next to a landscape one and the canvas widens
to hold both; rotate one of them 90° and the frame snaps to the new
shape. There's no master video and no resolution dialog, just a
long-side cap from your output preset (Web, Archive, Mobile, Custom).

### Browser is the runtime

WebCodecs does the heavy lifting. ffmpeg.wasm sits in the back of
the cupboard for codecs WebCodecs doesn't reach. OPFS holds the raw
media, IndexedDB holds the edit spec. There's no server-side state.
Closing the tab takes nothing with it, and re-opening picks the
project back up.

The render path has two stages:

- **Quick render** re-muxes your phone video with the studio audio
  at the computed offset. Seconds, not minutes.
- **Edit render** does the full pipeline: decode, composite (cuts,
  FX, text, audio-viz), encode. WebGL2 if your browser has it,
  Canvas2D fallback if it doesn't. About realtime on a recent
  laptop.

## Workflow, in pictures

**1. Drop everything in.** One master audio, one or more videos. No
project files, no settings dialog.

<p align="center">
  <img src=".github/screenshots/01-upload.png" alt="Upload page" width="800">
</p>

**2. Sync runs.** Each cam gets an offset and a confidence number.
From the job page you can hit *Quick render* to ship a single-angle
video right now, or *Open editor* to multi-cam.

<p align="center">
  <img src=".github/screenshots/03-job-detail.png" alt="Job detail with per-cam sync results" width="800">
</p>

**3. Play the edit.** SYNC tab keeps the algorithmic alignment plus
a fine-tune knob; the timeline below has the master audio waveform,
the cam lanes, the beat grid, the snap controls, the program-strip
mode picker (`BOTH` / `CUTS` / `FX`) and the FX rail.

<p align="center">
  <img src=".github/screenshots/04-editor-sync.png" alt="Editor – sync tab and timeline" width="900">
</p>

**4. Per-clip options.** Rotate or flip per clip so portrait phone
takes line up with landscape ones; source vs. output resolution
readout sits next to the clip.

<p align="center">
  <img src=".github/screenshots/05-editor-options.png" alt="Options panel" width="900">
</p>

**5. Overlays.** Audio-reactive visualizers (showwaves, showfreqs,
others) plus text overlays rendered through a Canvas2D ASS-subset
engine: same font, same positioning, same fades you'd write in a
`.ass` file, but applied inline.

<p align="center">
  <img src=".github/screenshots/06-editor-overlays.png" alt="Overlays panel" width="900">
</p>

**6. Render.** Pick a destination preset (Web, Archive, Mobile,
Custom), slide a single quality slider, hit *Render*. Live size
estimate, live duration, live codec readout.

<p align="center">
  <img src=".github/screenshots/07-editor-export.png" alt="Export panel" width="900">
</p>

**7. Tap `?` for the cheat sheet.** Every keyboard shortcut in the
app auto-registers itself in the overlay, so the list never lies to
you.

<p align="center">
  <img src=".github/screenshots/08-editor-help.png" alt="Keyboard help overlay" width="900">
</p>

## Privacy

There's no backend. The host nginx terminates TLS, the container's
nginx serves the static SPA bundle, and that's the entire server.
Phone video, studio audio, and your edits all live in your
browser's OPFS and IndexedDB. To wipe a job, click its trash icon.
There's nothing to delete server-side.

Nothing leaves the browser, and nothing third-party gets loaded
into it. No analytics in the bundle, no cookies, no fonts pulled
from a CDN — `@fontsource-variable/*` bundles them locally.

## Browser support

- **Chrome, Edge, Brave, Arc:** fully native via WebCodecs.
- **Firefox, Safari:** falls back to ffmpeg.wasm where needed.

The app needs cross-origin isolation (COOP/COEP) for
SharedArrayBuffer and threaded codecs.

## Architecture

```
Browser (everything runs here)
├── Sync algorithm        Rust → WASM (frontend/wasm/sync-core)
├── Codec layer           WebCodecs primary, ffmpeg.wasm fallback
├── Render
│   ├── Quick (audio re-encode + video pass-through)
│   └── Edit  (decoder → compositor → encoder)
├── FX                    Canvas2D + WebGL2 backends, per-kind drawers
├── Subtitle burn-in      Custom Canvas2D ASS-subset renderer
├── Visualizers           showwaves, showfreqs, others
├── Storage
│   ├── OPFS              Raw video, raw audio, render output
│   └── IndexedDB         Job metadata, sync results, edit specs
└── UI                    React + Zustand + Canvas timeline

Server (just hosting)
└── nginx + static SPA bundle (Dockerfile + deploy/nginx.conf)
```

## Local development

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev               # http://localhost:5173 with COOP/COEP headers
```

Production bundle:

```bash
cd frontend
npm run build             # → dist/
npm run preview           # serve dist/
```

You need:

- Node 20+
- Rust stable plus the `wasm32-unknown-unknown` target and
  `wasm-pack`
- A modern Chromium (Chrome, Edge, Brave, Arc) for the browser
  tests

## Tests

Three runners; see [TESTING.md](TESTING.md) for the strategy:

```bash
cd frontend
npm run test              # vitest in jsdom (pure functions, components)
npm run test:browser      # vitest in real Chromium via Playwright
                          # (WebCodecs, OPFS, ffmpeg.wasm, end-to-end
                          #  render + ASS overlay verification)
npm run wasm:test         # cargo test on the Rust sync-core
```

## Self-hosting

Imprint config, nginx setup and DE compliance notes live in
[DEPLOY.md](DEPLOY.md).

## License

[MIT](LICENSE), do whatever, no warranty.

The browser-side ffmpeg.wasm fallback is loaded under LGPL v2.1+
(<https://ffmpeg.org>, <https://github.com/ffmpegwasm/ffmpeg.wasm>);
the unmodified source is available at those upstream links.
