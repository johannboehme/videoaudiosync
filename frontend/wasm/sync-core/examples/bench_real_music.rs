//! Real-music bench. Loads CC-licensed clips cached under `bench/cache/`
//! by `bench/fetch_corpus.sh`, then runs the same offset/recall scenarios
//! we use in `bench_sync.rs` — but on real spectral content (real onsets,
//! real harmonics, real noise floor) instead of the pentatonic-tone
//! synthesis.
//!
//! Reports both per-genre and aggregate stats. The `peak_to_second_ratio`
//! field (added in Tier 1.2) is surfaced as the discrimination metric so
//! we can see whether a "1 % margin" symptom from synthetic-only material
//! reproduces on real signals.
//!
//! Run with:  cargo run --release --example bench_real_music
//! (from frontend/wasm/sync-core/)

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use sync_core::sync::{sync_audio_pcm, SyncOptions};

const SR: u32 = 22050;

struct Clip {
    name: String,
    genre: String,
    pcm: Vec<f32>,
}

#[derive(Default)]
struct GenreStats {
    n: usize,
    pass: usize,
    recall_k: usize,
    sum_abs_err: f64,
}

fn main() {
    let cache = bench_cache_dir();
    let clips = match load_clips(&cache) {
        Ok(c) if !c.is_empty() => c,
        Ok(_) => {
            eprintln!("no .f32 clips in {} — run bench/fetch_corpus.sh first", cache.display());
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("failed to read cache dir {}: {e}", cache.display());
            std::process::exit(1);
        }
    };

    println!("\n=== sync-core real-music bench ({} clips) ===\n", clips.len());

    let scenarios = build_scenarios();

    println!(
        "{:<14} {:<22} {:>11} {:>11} {:>9} {:>6} {:>6} {:>6} {:>4}",
        "genre", "scenario", "expected_ms", "got_ms", "err_ms", "conf", "psr", "pnr", "ok",
    );
    println!("{}", "-".repeat(102));

    let mut total_pass = 0usize;
    let mut total_n = 0usize;
    let mut total_recall_k = 0usize;
    let mut total_abs_err = 0f64;
    let mut total_psr = 0f64;
    let mut total_psr_n = 0usize;
    let mut by_genre: BTreeMap<String, GenreStats> = BTreeMap::new();

    for clip in &clips {
        for s in &scenarios {
            let (ref_pcm, query_pcm, expected_ms) = (s.build)(&clip.pcm);
            let result = sync_audio_pcm(&ref_pcm, &query_pcm, SyncOptions::default());
            let err = result.offset_ms - expected_ms;
            let abs_err = err.abs();
            let pass = abs_err <= s.tolerance_ms;
            let recall_hit = result
                .candidates
                .iter()
                .any(|c| (c.offset_ms - expected_ms).abs() <= s.tolerance_ms);

            let psr = result.peak_to_second_ratio;
            let pnr = result.peak_to_noise;

            total_n += 1;
            total_abs_err += abs_err;
            if pass {
                total_pass += 1;
            }
            if recall_hit {
                total_recall_k += 1;
            }
            if psr.is_finite() && psr < 1e5 {
                total_psr += psr;
                total_psr_n += 1;
            }
            let g = by_genre.entry(clip.genre.clone()).or_default();
            g.n += 1;
            g.sum_abs_err += abs_err;
            if pass { g.pass += 1; }
            if recall_hit { g.recall_k += 1; }

            println!(
                "{:<14} {:<22} {:>11.1} {:>11.1} {:>+9.1} {:>6.2} {:>6} {:>6} {:>4}",
                clip.genre,
                s.name,
                expected_ms,
                result.offset_ms,
                err,
                result.confidence,
                fmt_ratio(psr),
                fmt_ratio(pnr),
                if pass { "✓" } else { "✗" },
            );
        }
    }

    println!("\n=== Per-genre ===");
    println!("{:<14} {:>4} {:>5} {:>7} {:>11}", "genre", "n", "pass", "recall@K", "mean_abs_ms");
    println!("{}", "-".repeat(50));
    for (g, s) in &by_genre {
        println!(
            "{:<14} {:>4} {:>5} {:>7} {:>11.1}",
            g,
            s.n,
            format!("{}/{}", s.pass, s.n),
            format!("{}/{}", s.recall_k, s.n),
            s.sum_abs_err / s.n as f64,
        );
    }

    println!("\n=== Aggregate ===");
    println!(
        "Top-1 pass:   {}/{} ({:.0}%)",
        total_pass, total_n, 100.0 * total_pass as f64 / total_n as f64,
    );
    println!(
        "Recall@K:     {}/{} ({:.0}%)",
        total_recall_k, total_n, 100.0 * total_recall_k as f64 / total_n as f64,
    );
    println!("Mean abs err: {:.2} ms", total_abs_err / total_n as f64);
    if total_psr_n > 0 {
        println!(
            "Mean PSR:     {:.2}× (peak / 2nd peak; >1.5 ≈ comfortable margin)",
            total_psr / total_psr_n as f64,
        );
    }
}

struct Scenario {
    name: &'static str,
    tolerance_ms: f64,
    /// Returns `(ref_pcm, query_pcm, expected_offset_ms)`.
    build: fn(&[f32]) -> (Vec<f32>, Vec<f32>, f64),
}

fn build_scenarios() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "identity",
            tolerance_ms: 50.0,
            build: |y| (y.to_vec(), y.to_vec(), 0.0),
        },
        Scenario {
            name: "+100ms",
            tolerance_ms: 50.0,
            build: |y| (silence_then(0.1, y), y.to_vec(), 100.0),
        },
        Scenario {
            name: "+500ms",
            tolerance_ms: 50.0,
            build: |y| (silence_then(0.5, y), y.to_vec(), 500.0),
        },
        Scenario {
            name: "+2000ms",
            tolerance_ms: 100.0,
            build: |y| (silence_then(2.0, y), y.to_vec(), 2000.0),
        },
        Scenario {
            name: "-2000ms",
            tolerance_ms: 100.0,
            build: |y| (y.to_vec(), silence_then(2.0, y), -2000.0),
        },
        Scenario {
            name: "noise+200ms",
            tolerance_ms: 100.0,
            build: |y| {
                let r = silence_then(0.2, y);
                let n = noise(r.len() as f32 / SR as f32, 0.04, 33);
                let mut mixed = r.clone();
                for i in 0..mixed.len() { mixed[i] += n[i]; }
                (mixed, y.to_vec(), 200.0)
            },
        },
        Scenario {
            name: "quiet+800ms",
            tolerance_ms: 100.0,
            build: |y| {
                let r: Vec<f32> = silence_then(0.8, y).into_iter().map(|s| s * 0.2).collect();
                (r, y.to_vec(), 800.0)
            },
        },
    ]
}

/// Format a discrimination ratio. `f64::INFINITY` and the saturation
/// sentinel render as "∞" so the column stays at a fixed width.
fn fmt_ratio(r: f64) -> String {
    if !r.is_finite() || r > 1e5 {
        "  ∞".to_string()
    } else if r >= 100.0 {
        format!("{:.0}", r)
    } else {
        format!("{:.2}", r)
    }
}

fn silence_then(secs: f32, then: &[f32]) -> Vec<f32> {
    let pad = (secs * SR as f32) as usize;
    let mut out = vec![0.0f32; pad];
    out.extend_from_slice(then);
    out
}

fn noise(secs: f32, amp: f32, seed: u64) -> Vec<f32> {
    let n = (secs * SR as f32) as usize;
    let mut out = vec![0.0f32; n];
    let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    for v in out.iter_mut() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let u = (state as f32 / u64::MAX as f32) * 2.0 - 1.0;
        *v = u * amp;
    }
    out
}

// ---------------------------------------------------------------------------
// Cache loading

fn bench_cache_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR is the dir containing Cargo.toml when this example
    // was compiled — the canonical anchor for "this crate's resources".
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bench/cache")
}

fn load_clips(cache: &Path) -> io::Result<Vec<Clip>> {
    let mut clips = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(cache)?.collect::<Result<_, _>>()?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("f32") {
            continue;
        }
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        let json_path = path.with_extension("json");
        let genre = read_genre(&json_path).unwrap_or_else(|| name.clone());
        let pcm = read_f32le(&path)?;
        if pcm.is_empty() {
            eprintln!("skipping empty clip: {name}");
            continue;
        }
        clips.push(Clip { name, genre, pcm });
    }
    Ok(clips)
}

fn read_f32le(path: &Path) -> io::Result<Vec<f32>> {
    let mut f = fs::File::open(path)?;
    let mut bytes = Vec::new();
    f.read_to_end(&mut bytes)?;
    if bytes.len() % 4 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("file {} is not a multiple of 4 bytes", path.display()),
        ));
    }
    let mut samples = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(samples)
}

/// Tiny JSON-genre extractor — avoids a serde_json dep just to read one field.
fn read_genre(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let key = "\"genre\"";
    let i = text.find(key)?;
    let rest = &text[i + key.len()..];
    let colon = rest.find(':')?;
    let after_colon = &rest[colon + 1..];
    let q1 = after_colon.find('"')?;
    let after_q1 = &after_colon[q1 + 1..];
    let q2 = after_q1.find('"')?;
    Some(after_q1[..q2].to_string())
}
