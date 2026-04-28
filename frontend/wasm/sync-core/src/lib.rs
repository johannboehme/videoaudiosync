//! sync-core: Audio-Sync-Algorithmus, kompiliert zu WASM.
//!
//! Public API surface:
//!   * `version()` — sanity check that the WASM module loaded.
//!   * `sync_audio_pcm_js(ref_pcm, query_pcm, sample_rate)` — runs the full
//!     pipeline (chroma → xcorr → optional DTW → sliding-window drift
//!     refinement) and returns a JS object matching the `SyncResult` shape.

pub mod chroma;
pub mod drift;
pub mod dtw;
pub mod ncc;
pub mod sync;
pub mod util;
pub mod xcorr;

use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn version() -> String {
    "sync-core/0.1.0".to_string()
}

#[derive(Serialize)]
struct SyncResultDto {
    offset_ms: f64,
    confidence: f64,
    drift_ratio: f64,
    method: String,
    warning: Option<String>,
}

impl From<sync::SyncResult> for SyncResultDto {
    fn from(r: sync::SyncResult) -> Self {
        Self {
            offset_ms: r.offset_ms,
            confidence: r.confidence,
            drift_ratio: r.drift_ratio,
            method: r.method,
            warning: r.warning,
        }
    }
}

#[wasm_bindgen(js_name = syncAudioPcm)]
pub fn sync_audio_pcm_js(
    ref_pcm: &[f32],
    query_pcm: &[f32],
    sample_rate: u32,
) -> Result<JsValue, JsValue> {
    let opts = sync::SyncOptions {
        sr: sample_rate,
        ..Default::default()
    };
    let result = sync::sync_audio_pcm(ref_pcm, query_pcm, opts);
    let dto = SyncResultDto::from(result);
    serde_wasm_bindgen::to_value(&dto).map_err(|e| JsValue::from_str(&e.to_string()))
}
