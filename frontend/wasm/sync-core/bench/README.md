# Real-Music Bench Corpus

Curated 30-second clips of CC-licensed / public-domain music across genres,
fetched on demand from public sources. Used by `examples/bench_real_music.rs`
to stress-test the matching engine on real spectral content (instead of the
synthetic pentatonic scale in `bench_sync.rs`).

The actual audio is **never committed** — the [cache/](cache/) directory is
gitignored. Each developer/CI fetches once via [fetch_corpus.sh](fetch_corpus.sh)
and reuses the local copy thereafter.

## Layout

- [corpus.tsv](corpus.tsv) — TSV: `name TAB genre TAB url TAB start_s TAB duration_s`
- [fetch_corpus.sh](fetch_corpus.sh) — `yt-dlp + ffmpeg` pipeline. Produces
  `cache/{name}.f32` (raw `f32le @ 22050 Hz mono`, no header) and
  `cache/{name}.json` (sidecar manifest: `{ sr, n_samples, genre, source_url }`).
- `cache/` — gitignored, populated by the fetch script.

## Usage

```bash
# Fetch the whole corpus (idempotent — skips already-cached entries)
bench/fetch_corpus.sh

# Run the real-music bench
cargo run --release --example bench_real_music
```

## Adding sources

Drop a new line into [corpus.tsv](corpus.tsv) — any source `yt-dlp` can resolve
(YouTube, Vimeo, archive.org, Free Music Archive, Bandcamp, direct file URLs)
plus a `start_s` window. Re-run `fetch_corpus.sh`.

**Licensing**: only add Creative Commons or public domain material. No
copyrighted commercial recordings — even for "internal benchmarking only" the
fetched bytes still live on developer machines and CI runners. The seed
corpus is exclusively CC-BY / CC0 / public-domain.

## Why these genres

Each stresses a different part of the pipeline:

| Genre | Stress |
|-------|--------|
| Classical / piano / sustained orchestral | Weak onset envelopes — exposes whether `chroma`-only tracking holds when the onset-fusion path has nothing to contribute. |
| Techno / house / minimal loops | Strong periodic onsets every quarter note — classic false-beat-aligned-match failure mode for chroma+onset; PHAT is the only stage that can distinguish the true alignment. |
| Hip-hop / kick-heavy / metal | Onset dominates over harmonic content — checks the inverse of classical. |
| Reggae / funk / salsa / world | Off-beat / polyrhythmic patterns — checks that beat-grid-aligned alternates don't fool the matcher. |
| Vocal / spoken / folk / jazz | Fast spectral changes, formant-driven — checks time resolution. |
| Drone / ambient | Near-flat envelope — low-confidence stress test, should warn rather than fabricate a match. |
| Country / rock / punk | "Normal" production references — should always be in the high-confidence regime. |

## Known edge cases

The bench has two scenarios that the matcher legitimately cannot resolve:

- **`drone + noise+200ms`** — drone music has near-zero phase coherence
  (continuous tones over a flat correlation surface), and adding white
  noise to the reference further obliterates the only signal PHAT can
  latch onto. PHAT correctly *rejects* this case (PNR < 6) and the
  fallback path finds lag 0 because that's where the noise self-
  correlates. This is the exact behavior we want — better to fail loudly
  than fabricate a match — but the bench counts it as a top-1 miss.
- **`house-loop +500ms`** — pure 4-on-the-floor DJ-set material whose
  bar-level pattern is mathematically near-identical at every-bar
  shifts; the PSR is 1.01 (knife-edge tie). PHAT picks one of several
  equally-phase-coherent loop-aligned candidates, sometimes the wrong
  one. Real multi-cam material almost never hits this — performances
  vary at the second-to-second level even when the music is loopy.

Both scenarios surface as low confidence (PSR ≈ 1.0, phat_pnr near
the rejection floor), so the UI has all the information it needs to
flag them as ambiguous.
