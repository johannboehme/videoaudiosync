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
| Classical / sustained orchestral | Weak onset envelopes — exposes whether `chroma`-only tracking holds when the onset-fusion path has nothing to contribute. |
| Electronic / techno / loop-driven | Strong periodic onsets every quarter note — classic false-beat-aligned-match failure mode. |
| Hip-hop / kick-heavy | Onset dominates over harmonic content — checks the inverse of classical. |
| Vocal / jazz | Fast spectral changes, formant-driven — checks time resolution. |
| Drone / ambient | Near-flat envelope — low-confidence stress test, should warn rather than fabricate a match. |
