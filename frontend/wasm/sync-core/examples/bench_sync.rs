//! Quality-grade benchmark for the sync algorithm.
//!
//! Builds a deterministic "song-like" signal (a few different notes mixed +
//! a click track) and constructs a series of (ref, query) pairs with KNOWN
//! ground-truth offsets and then asks the algorithm to recover them.
//!
//! Reports per-scenario absolute error (ms) and an overall quality score.
//!
//! Run with:  cargo run --release --example bench_sync
//! (from frontend/wasm/sync-core/)

use std::f32::consts::PI;
use sync_core::sync::{sync_audio_pcm, SyncOptions};

const SR: u32 = 22050;

fn main() {
    let scenarios = build_scenarios();
    println!("\n=== sync-core benchmark ({} scenarios) ===\n", scenarios.len());
    println!(
        "{:<35}  {:>12}  {:>12}  {:>10}  {:>10}",
        "scenario", "expected_ms", "got_ms", "err_ms", "conf"
    );
    println!("{}", "-".repeat(90));

    let mut total_err = 0.0f64;
    let mut total_abs_err = 0.0f64;
    let mut passed = 0;
    let mut failed = 0;
    let mut recall_k_hits = 0;
    let mut failures: Vec<(String, f64, f64, Vec<f64>)> = Vec::new();

    for s in &scenarios {
        let result = sync_audio_pcm(&s.ref_pcm, &s.query_pcm, SyncOptions::default());
        let err = result.offset_ms - s.expected_offset_ms;
        let abs_err = err.abs();
        let pass = abs_err <= s.tolerance_ms;
        // Recall@K: does ANY of {primary} ∪ {alternates} land within tolerance?
        let alt_offsets: Vec<f64> = result.candidates.iter().map(|c| c.offset_ms).collect();
        let recall_hit = alt_offsets
            .iter()
            .any(|&m| (m - s.expected_offset_ms).abs() <= s.tolerance_ms);
        if pass {
            passed += 1;
        } else {
            failed += 1;
            failures.push((s.name.clone(), s.expected_offset_ms, result.offset_ms, alt_offsets.clone()));
        }
        if recall_hit {
            recall_k_hits += 1;
        }
        total_err += err;
        total_abs_err += abs_err;
        println!(
            "{:<35}  {:>12.1}  {:>12.1}  {:>10.1}  {:>9.2}  {}  {}",
            s.name,
            s.expected_offset_ms,
            result.offset_ms,
            err,
            result.confidence,
            if pass { "✓" } else { "✗" },
            if recall_hit { format!("R@{}", result.candidates.len()) } else { "—".to_string() },
        );
    }

    let n = scenarios.len();
    println!("\n=== Summary ===");
    println!("Top-1 pass:     {}/{} ({:.0}%)", passed, n, 100.0 * passed as f64 / n as f64);
    println!("Recall@K:       {}/{} ({:.0}%)  (true offset in primary OR alternates)", recall_k_hits, n, 100.0 * recall_k_hits as f64 / n as f64);
    println!("Failed top-1:   {}", failed);
    println!("Mean error:     {:>+8.2} ms", total_err / n as f64);
    println!("Mean abs error: {:>8.2} ms", total_abs_err / n as f64);

    if !failures.is_empty() {
        println!("\n=== Failures ===");
        for (name, expected, got, alts) in &failures {
            print!("  {}: expected {:+.1} ms, got {:+.1} ms (Δ {:+.1} ms)",
                name, expected, got, got - expected);
            if !alts.is_empty() {
                print!("  alts=[");
                for (i, a) in alts.iter().enumerate() {
                    if i > 0 { print!(", "); }
                    print!("{:+.1}", a);
                }
                print!("]");
            }
            println!();
        }
    }
}

struct Scenario {
    name: String,
    ref_pcm: Vec<f32>,
    query_pcm: Vec<f32>,
    /// True offset in ms — the algorithm should report a value close to this.
    /// Convention: positive means the master/query starts later in the ref
    /// timeline by this many ms (i.e., insert ref[N+offset_samples] = master[N]).
    /// In the existing algorithm, the returned `offset_ms` matches this.
    expected_offset_ms: f64,
    tolerance_ms: f64,
}

fn build_scenarios() -> Vec<Scenario> {
    let mut out: Vec<Scenario> = Vec::new();

    // Build a 30s song-like master once. Reuse for many scenarios.
    let master_30s = make_song(30.0, 17, false);
    let master_60s = make_song(60.0, 17, false);
    let master_short = make_song(8.0, 17, false);

    // 1. Identity
    out.push(Scenario {
        name: "identity-30s".into(),
        ref_pcm: master_30s.clone(),
        query_pcm: master_30s.clone(),
        expected_offset_ms: 0.0,
        tolerance_ms: 50.0,
    });

    // 2-5. Pure positive offsets (master appears LATER in ref).
    // ref = silence(off) + master, query = master → expected offset = +off (ms)
    for &off_ms in &[100.0_f64, 500.0, 2000.0, 8000.0] {
        let ref_pcm = silence_then((off_ms / 1000.0) as f32, &master_30s);
        out.push(Scenario {
            name: format!("pos-offset-{}ms", off_ms as i64),
            ref_pcm,
            query_pcm: master_30s.clone(),
            expected_offset_ms: off_ms,
            tolerance_ms: 100.0,
        });
    }

    // 6-9. Pure negative offsets (query appears later in ref → master skipped).
    for &off_ms in &[100.0_f64, 500.0, 2000.0, 8000.0] {
        let query_pcm = silence_then((off_ms / 1000.0) as f32, &master_30s);
        out.push(Scenario {
            name: format!("neg-offset-{}ms", off_ms as i64),
            ref_pcm: master_30s.clone(),
            query_pcm,
            expected_offset_ms: -off_ms,
            tolerance_ms: 100.0,
        });
    }

    // 6-9. Pure negative offsets (query appears later in ref → master skipped).
    // ref = master, query = silence(off) + master → expected offset = -off
    for &off_ms in &[100.0_f64, 500.0, 2000.0, 8000.0] {
        let query_pcm = silence_then((off_ms / 1000.0) as f32, &master_30s);
        out.push(Scenario {
            name: format!("neg-offset-{}ms", off_ms as i64),
            ref_pcm: master_30s.clone(),
            query_pcm,
            expected_offset_ms: -off_ms,
            tolerance_ms: 100.0,
        });
    }

    // 10-12. Long silence prefix in ref + master starts somewhere inside.
    //        e.g. ref = sil(5s) + master(short), query = master(short)
    //        expected offset = +5000 ms
    for &(prefix_s, name) in &[(5.0_f32, "silence-5s-then-master"),
                                (10.0_f32, "silence-10s-then-master"),
                                (20.0_f32, "silence-20s-then-master")] {
        let ref_pcm = silence_then(prefix_s, &master_short);
        out.push(Scenario {
            name: name.into(),
            ref_pcm,
            query_pcm: master_short.clone(),
            expected_offset_ms: (prefix_s * 1000.0) as f64,
            tolerance_ms: 200.0,
        });
    }

    // 13. Long silence suffix in ref (does not affect alignment)
    {
        let mut ref_pcm = silence_then(2.0, &master_30s);
        ref_pcm.extend(vec![0.0; SR as usize * 5]);
        out.push(Scenario {
            name: "silence-2s-then-master-then-silence-5s".into(),
            ref_pcm,
            query_pcm: master_30s.clone(),
            expected_offset_ms: 2000.0,
            tolerance_ms: 100.0,
        });
    }

    // 14. Silence + noise + master (simulates a phone recording with chatter
    //     before the song starts).
    {
        let mut ref_pcm = silence_then(1.0, &[]);
        ref_pcm.extend(noise(2.0, 0.05, 42));
        ref_pcm.extend_from_slice(&master_30s);
        out.push(Scenario {
            name: "silence+noise-then-master".into(),
            ref_pcm,
            query_pcm: master_30s.clone(),
            expected_offset_ms: 3000.0,
            tolerance_ms: 200.0,
        });
    }

    // 15. Master + master (query appears twice in ref) — algo should find one.
    {
        let mut ref_pcm = master_30s.clone();
        ref_pcm.extend(silence_then(2.0, &[]));
        ref_pcm.extend_from_slice(&master_30s);
        out.push(Scenario {
            name: "master-twice-in-ref".into(),
            ref_pcm,
            query_pcm: master_30s.clone(),
            // Either occurrence is acceptable — pick the closer one.
            expected_offset_ms: 0.0,
            // Generous: either 0 or 32_000ms is acceptable.
            tolerance_ms: 35_000.0,
        });
    }

    // 16. Short query inside long ref.
    {
        let inner = make_song(5.0, 99, false);
        let mut ref_pcm = silence_then(7.0, &[]);
        ref_pcm.extend_from_slice(&inner);
        ref_pcm.extend(silence_then(8.0, &[]));
        out.push(Scenario {
            name: "short-query-inside-long-ref".into(),
            ref_pcm,
            query_pcm: inner,
            expected_offset_ms: 7000.0,
            tolerance_ms: 200.0,
        });
    }

    // 17. Master with light noise added to the ref (phone mic noise).
    {
        let mut ref_pcm = master_30s.clone();
        let n = noise(ref_pcm.len() as f32 / SR as f32, 0.03, 33);
        for i in 0..ref_pcm.len() {
            ref_pcm[i] += n[i];
        }
        out.push(Scenario {
            name: "master-with-noise-overlay".into(),
            ref_pcm,
            query_pcm: master_30s.clone(),
            expected_offset_ms: 0.0,
            tolerance_ms: 100.0,
        });
    }

    // 18. Lower amplitude in ref (quiet phone recording).
    {
        let ref_pcm: Vec<f32> = master_30s.iter().map(|x| x * 0.2).collect();
        out.push(Scenario {
            name: "master-quiet".into(),
            ref_pcm,
            query_pcm: master_30s.clone(),
            expected_offset_ms: 0.0,
            tolerance_ms: 100.0,
        });
    }

    // 19. Long ref (60s) with master in the middle.
    {
        let ref_pcm = silence_then(15.0, &master_30s);
        out.push(Scenario {
            name: "long-ref-master-in-middle".into(),
            ref_pcm,
            query_pcm: master_30s.clone(),
            expected_offset_ms: 15_000.0,
            tolerance_ms: 200.0,
        });
    }

    // 20. Master starts at t=0 of query but ref is much longer with extra music after.
    //     ref = master + different music, query = master
    {
        let other = make_song(10.0, 7777, false);
        let mut ref_pcm = master_30s.clone();
        ref_pcm.extend_from_slice(&other);
        out.push(Scenario {
            name: "ref-has-extra-music-after-master".into(),
            ref_pcm,
            query_pcm: master_30s.clone(),
            expected_offset_ms: 0.0,
            tolerance_ms: 200.0,
        });
    }

    // 21. Master appears after another music section.
    {
        let intro = make_song(8.0, 1234, false);
        let mut ref_pcm = intro;
        ref_pcm.extend_from_slice(&master_30s);
        out.push(Scenario {
            name: "intro-then-master".into(),
            ref_pcm,
            query_pcm: master_30s.clone(),
            expected_offset_ms: 8_000.0,
            tolerance_ms: 200.0,
        });
    }

    // 22. Short query, large negative offset.
    {
        let inner = make_song(5.0, 555, false);
        let query = silence_then(3.0, &inner);
        out.push(Scenario {
            name: "short-master-with-3s-prefix-silence".into(),
            ref_pcm: inner.clone(),
            query_pcm: query,
            expected_offset_ms: -3000.0,
            tolerance_ms: 200.0,
        });
    }

    // 23. Identity but 60s
    out.push(Scenario {
        name: "identity-60s".into(),
        ref_pcm: master_60s.clone(),
        query_pcm: master_60s.clone(),
        expected_offset_ms: 0.0,
        tolerance_ms: 50.0,
    });

    out
}

// ---------------------------------------------------------------------------
// Signal generators

fn make_song(duration_s: f32, seed: u64, _percussive: bool) -> Vec<f32> {
    // Random walk through a pentatonic scale, with light click on every beat.
    let n = (duration_s * SR as f32) as usize;
    let mut y = vec![0.0f32; n];
    let scale = [220.0_f32, 277.18, 329.63, 392.0, 466.16];
    let note_dur = 0.4_f32;
    let click_period = 0.5_f32;
    let mut state = seed.wrapping_mul(0x9E3779B97F4A7C15);
    let mut rand_u32 = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state as u32
    };
    let mut t_cursor = 0.0f32;
    while t_cursor < duration_s {
        let f = scale[(rand_u32() as usize) % scale.len()];
        let start = (t_cursor * SR as f32) as usize;
        let end = ((t_cursor + note_dur) * SR as f32) as usize;
        let end = end.min(n);
        for i in start..end {
            let t = i as f32 / SR as f32;
            let env = (1.0 - (t - t_cursor) / note_dur).max(0.0);
            // Tone + 2nd harmonic for spectral richness.
            let s = 0.4 * (2.0 * PI * f * t).sin() + 0.15 * (2.0 * PI * 2.0 * f * t).sin();
            y[i] += s * env;
        }
        t_cursor += note_dur;
    }
    // Click track on top.
    let mut t = click_period;
    while t < duration_s {
        let click_start = (t * SR as f32) as usize;
        let click_len = (0.005 * SR as f32) as usize;
        for i in 0..click_len {
            let idx = click_start + i;
            if idx >= n {
                break;
            }
            let env = (1.0 - i as f32 / click_len as f32).max(0.0);
            y[idx] += env * 0.6 * (2.0 * PI * 2000.0 * (i as f32 / SR as f32)).sin();
        }
        t += click_period;
    }
    y
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
    let mut state = seed.wrapping_mul(0x9E3779B97F4A7C15);
    for v in out.iter_mut() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let u = (state as f32 / u64::MAX as f32) * 2.0 - 1.0;
        *v = u * amp;
    }
    out
}
