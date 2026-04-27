# VideoAudioSync

Self-hosted web app that takes a phone-recorded performance video and a clean
studio audio render, automatically aligns them, and produces a finished video.
Optional editor: cuts, animated text overlays, audio-reactive visualizers.

**Production**: <https://sync.johannboehme.de>

Everything — sync algorithm, render, codec work — runs **in the browser**.
The server only ships static files; user files never leave the device.

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Local development](#local-development)
- [Tests](#tests)
- [Production deployment](#production-deployment)
- [Operations](#operations)

---

## What it does

You film yourself playing a song on your phone (or Ray-Ban). Phone audio is bad
— bad mic, room reverb, background noise. The actual song was rendered cleanly
from your DAW (e.g. Teenage Engineering OP-1) as MP3/WAV.

Drag both files into the page. The browser:

1. Decodes both audios (WebCodecs / `decodeAudioData`).
2. Computes 12-bin chroma features and cross-correlates to find the alignment
   (Rust → WASM, `wasm/sync-core`). Falls back to chroma-DTW if confidence is
   low; always runs a sliding-window drift refinement on top.
3. Stores the inputs in OPFS and the sync result in IndexedDB.
4. Re-muxes the video with the studio audio at the right offset (WebCodecs →
   `mp4-muxer`); for the edit path it also re-encodes video frames through a
   compositor that paints text overlays + audio-reactive visualizers.

You get back a finished MP4 you can save with the File System Access API.
Phone-uploaded videos never traverse the network.

## Architecture

```
Browser (everything runs here)
├── Sync algorithm        Rust → WASM (frontend/wasm/sync-core)
├── Codec layer           WebCodecs primary, ffmpeg.wasm fallback
│                         (frontend/src/local/codec/)
├── Render
│   ├── Quick (audio re-encode + video pass-through)
│   └── Edit  (decoder → compositor → encoder)
├── Subtitle burn-in      Custom Canvas2D ASS-subset renderer
│                         (frontend/src/local/render/ass-renderer.ts)
├── Visualizers           showwaves, showfreqs, …
│                         (frontend/src/local/render/visualizer/)
├── Storage
│   ├── OPFS              Roh-Video, Roh-Audio, Render-Output
│   └── IndexedDB         Job metadata, sync results, edit specs
└── UI                    React + Zustand + Canvas timeline

Server (just hosting)
└── nginx + static SPA bundle (Dockerfile + deploy/nginx.conf)
```

There is no backend. The host nginx (`deploy/nginx-vhost.conf`) terminates
TLS and proxies into the container's static nginx, which serves the build
with the COOP/COEP headers cross-origin isolation requires.

## Local development

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev               # http://localhost:5173 with COOP/COEP headers
```

Building the production bundle (compiles the Rust WASM core too):

```bash
cd frontend
npm run build             # → dist/
npm run preview           # serve dist/
```

You need:

- Node 20+
- Rust stable + `wasm32-unknown-unknown` target + `wasm-pack`
- A modern Chromium (Chrome / Edge / Brave) for browser tests

## Tests

Three workspaces (see [TESTING.md](TESTING.md) for the full strategy):

```bash
cd frontend

npm run test              # vitest in jsdom (pure functions, components)
npm run test:browser      # vitest in real Chromium via Playwright
                          # (WebCodecs, OPFS, IndexedDB, WASM, real ffmpeg.wasm)
npm run wasm:test         # cargo test on the Rust sync-core
```

Current totals:

- 78 unit tests (jsdom)
- 48 browser tests (real Chromium with COOP/COEP, WebCodecs, OPFS, ffmpeg.wasm,
  end-to-end render + ASS overlay verification)
- 16 cargo tests on the sync algorithm

## Production deployment

The container is two stages:

1. Build the React app + the Rust → WASM sync core (Node 20 + Rust toolchain).
2. Copy `dist/` into an nginx:1.27-alpine image and serve it on port 80 with
   `deploy/nginx.conf` setting COOP/COEP.

Bootstrap on a fresh server (Debian / Ubuntu):

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
git clone https://github.com/<you>/videoaudiosync.git ~/videoaudiosync
cd ~/videoaudiosync
sudo cp deploy/nginx-vhost.conf /etc/nginx/sites-available/sync.johannboehme.de
sudo ln -s /etc/nginx/sites-available/sync.johannboehme.de /etc/nginx/sites-enabled/
sudo certbot --nginx -d sync.johannboehme.de
docker compose up -d --build
```

Continuous deployment: run `deploy/deploy.sh` from a cron / push hook on the
server. It pulls main, rebuilds the image, rolls the container, and rolls back
on a failed readiness check.

## Operations

- **No data dir, no database, no secrets.** All user state lives in the
  browser (OPFS + IndexedDB). To delete a user's data, the user clicks the
  trash icon on their job — there is nothing to delete server-side.
- **Updating** is `git pull && docker compose up -d --build`, or just
  `bash deploy/deploy.sh`.
- **Diagnostics** for the user: `/settings` shows the full browser
  capability report and the chosen render path (WebCodecs vs ffmpeg.wasm).
- **Cross-origin isolation**: if the production page logs
  `crossOriginIsolated === false`, check that both the host nginx vhost and
  the container's `nginx.conf` keep `Cross-Origin-Opener-Policy: same-origin`
  and `Cross-Origin-Embedder-Policy: require-corp` intact.

## Hosting in Germany — compliance checklist

The published instance ships with what a private, non-commercial tool
in DE typically needs. If you fork and host your own:

- **Edit the imprint** — `frontend/src/pages/Impressum.tsx` hardcodes
  the operator's name, postal address and e-mail. Replace before
  deploying. The address must be capable of receiving registered mail.
- **Update the supervisory authority** in
  `frontend/src/pages/Datenschutz.tsx` to the data-protection authority
  of *your* federal state if you are not in Bavaria.
- **Anonymise nginx logs.** `deploy/nginx-vhost.conf` enables an `anon`
  log format; the matching `map` and `log_format` directives must live
  at `http {}` scope in the host `/etc/nginx/nginx.conf` — see the
  comment block at the top of the vhost file.
- **Log retention** — configure logrotate to drop
  `/var/log/nginx/sync.access.log` after 7 days.
- **Web fonts are bundled locally** via `@fontsource-variable/*` — do
  not re-introduce a `fonts.googleapis.com` import.
- **No analytics, no tracking, no cookies.** Keep it that way; if you
  add any, the privacy policy must change accordingly.

Not legal advice. For a forked deployment that goes beyond a personal
hobby project, have a lawyer review the imprint and privacy policy
texts.
