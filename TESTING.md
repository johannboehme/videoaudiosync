# Test-Strategie

Diese Datei beschreibt, wo welche Tests leben und welchen Zweck sie haben. Sie wird mitgeführt mit der Migration vom Backend-zentrierten zum Frontend-zentrierten Stack — der Plan ist in `~/.claude/plans/die-aktuelle-app-tut-dreamy-dolphin.md`.

Vorher: Sync und Render lebten in Python und wurden mit pytest gegen reale ffmpeg-Outputs getestet. Nach der Migration läuft beides im Browser. Die Test-Strategie muss explizit verhindern, dass die Aussagekraft sinkt — Tests gegen mocks von Browser-APIs sind wertlos. Wir testen gegen echte Browser-APIs in echten Browsern, mit Goldfile-Snapshots vom alten Backend als Wahrheits-Anker.

## Schichten

| Schicht | Wo | Tool | Geschwindigkeit | Wofür |
|---|---|---|---|---|
| **Pure-Function-Unit-Tests** | `src/**/*.test.ts` mit `environment: jsdom` | vitest (existiert bereits) | <1s pro Datei | Reine Logik ohne Browser-APIs: ASS-Builder, Resample-Math, Drift-Polyfit, Capability-Detection mit Mocks, Strategy-Resolver. |
| **Rust-WASM-Unit-Tests** | `frontend/wasm/sync-core/src/*.rs` | `cargo test` | <2s | FFT-Bausteine, Chroma-Filterbank, DTW, polyfit. Nativ getestet bevor JS-Bindings existieren. |
| **Browser-API-Integration-Tests** | `src/**/*.browser.test.ts` mit `@vitest/browser` (Provider: Playwright + Chromium) | vitest-browser | 5–15s pro Datei | OPFS, IndexedDB, WebCodecs (echte Hardware-Decoder), AudioContext-Decode, Worker-RPC. **Diese Tests sind Pflicht** für jeden Code, der Browser-APIs anfasst — kein Mocking. |
| **Goldfile-Tests** | `tests/goldfiles/*.json` (Inputs + erwartete Outputs aus Python-Backend) und `src/**/*.goldfile.test.ts` | vitest oder vitest-browser, je nach Bedarf | varies | Verhindert, dass die Sync-/Render-Migration semantisch driftet. Backend-Outputs werden vor der Phase als Snapshot eingefroren, Frontend-Tests laufen gegen denselben Snapshot. Tolerant verglichen, nicht bit-genau. |
| **End-to-End** | `e2e/*.spec.ts` | Playwright | 30–120s pro Test | Volle User-Workflows: User wählt zwei Files → Sync läuft → Editor öffnet → Render läuft → Download stimmt. Mit echten Fixture-Files. Pro Phase ein Test. |

## Welche Schicht wann?

Faustregel: **Wenn der Code eine Browser-API anfasst, gehört der Test in vitest-browser.** Mocking-Heuristiken sind erlaubt nur für die Aufrufer dieser APIs (Aufrufer testen wir mit Fakes, die das Port-Interface erfüllen — nicht mit `vi.stubGlobal` auf `AudioDecoder`).

Konkret:

```
codec/webcodecs/audio-decode.ts        → browser test (echtes WebCodecs)
codec/ffmpeg/audio-decode.ts           → browser test (echtes ffmpeg.wasm)
codec/resolve.ts                       → unit test mit gemockten Ports + browser test mit echten Files
sync/sync-worker.ts                    → browser test (echter Worker, echtes WASM)
sync/index.ts                          → unit test (mocked worker) + e2e
render/quick.ts                        → browser test mit Fixture-MP4 + goldfile
render/edit.ts                         → browser test mit Fixture + goldfile + e2e
render/ass-builder.ts                  → unit test (pure) + goldfile (gegen Python-Output)
render/energy.ts                       → unit test (mit fester FFT-Implementation) + goldfile
render/visualizer/*.ts                 → unit test mit Fake-Canvas + Snapshot
storage/opfs.ts                        → browser test
storage/jobs-db.ts                     → browser test (IndexedDB gibt es in jsdom nur via fake-indexeddb, aber wir wollen echtes Verhalten)
capabilities.ts                        → unit test (mocked navigator/globals) — keine Browser-API-Aufrufe nötig
local/jobs.ts                          → unit test (mocked storage) + browser test (e2e Subset)
pages/Upload.tsx                       → component test (unit, jsdom) + e2e (echter File-Drop)
pages/JobPage.tsx                      → component test + e2e
pages/Editor.tsx                       → component test (mit fake job data) + e2e
pages/Settings.tsx                     → component test
```

## Goldfile-Strategie

**Bevor** die Sync-Migration anfängt, wird ein Setup-Skript ausgeführt das gegen das aktuelle Python-Backend läuft und für jedes Fixture-Pair die Outputs als JSON-Snapshot schreibt:

```
tests/goldfiles/
├── fixtures/
│   ├── pair-01/
│   │   ├── video.mp4
│   │   ├── studio-audio.wav
│   │   └── snapshot.json          # { syncResult: {...}, energyBands: {...}, asExample: "..." }
│   ├── pair-02/...
│   └── pair-05/...
└── snapshot-current-backend.sh    # erzeugt snapshot.json aus aktuellem Backend
```

Die Frontend-Tests vergleichen ihre Outputs gegen `snapshot.json`. Toleranzen sind explizit definiert pro Feld:

| Feld | Toleranz | Begründung |
|---|---|---|
| `syncResult.offset_ms` | ±50 ms | Chroma-Pseudo-CQT vs. echte CQT |
| `syncResult.drift_ratio` | ±0.001 | Polyfit-Numerik |
| `syncResult.confidence` | nicht verglichen | Heuristisch, nicht load-bearing |
| `energyBands.*` | ±1% relative | FFT-Library-Unterschiede |
| `assString` | exakt | Pure String-Generierung, muss bit-gleich sein |
| `renderOutput.duration_s` | ±0.04 s | Frame-Genauigkeit |
| `renderOutput.audio_offset_in_output` | ±20 ms | AAC-Encoder-Frame-Boundaries |

Wenn ein Goldfile-Test rot wird, ist das ein Signal für eine Regression — nicht für ein veraltetes Snapshot. Snapshots werden nur aktualisiert nach manueller Verifikation, dass die neue Variante besser ist (z.B. präziser, nicht nur anders).

## Was wir NICHT testen

- **Visualizer-Bit-Identität gegen ffmpeg**: Visualizer werden im Frontend neu implementiert, eine Implementierung. Output sieht anders aus als ffmpeg's `showcqt`/`showfreqs`. Wir testen Snapshot-Identität gegen unseren eigenen letzten Output (Snapshot-Test pro Visualizer), nicht gegen ffmpeg.
- **Encoder-Bit-Identität**: WebCodecs-H.264 vs. libx264 vs. ffmpeg.wasm-libx264 produzieren unterschiedliche Bytes für dasselbe Eingabe-Material. Wir testen Container-Properties (Dauer, Sample-Rate, Codec, Track-Count) und visuell-relevante Metriken (PSNR ≥ 35 dB gegen Reference), nicht Bytes.
- **Mocked WebCodecs**: Nie. Wenn ein Test WebCodecs braucht, läuft er in vitest-browser.

## Coverage-Anspruch

Wir tracken keine globale Coverage-Prozentzahl. Stattdessen:

- **Jede Pure-Function** hat mindestens einen Unit-Test mit Edge-Cases.
- **Jede Browser-API-Integration** hat mindestens einen Browser-Test mit echtem Setup (kein Mock).
- **Jede Goldfile-Pipeline** hat mindestens 5 Fixture-Pairs (drei "normale" Realfälle, einer mit drift, einer mit niedrigem confidence).
- **Jede Phase** hat mindestens einen Playwright-E2E-Test, der den User-Workflow von vorne bis hinten durchgeht.

## Setup-Status

- [x] vitest mit jsdom (existiert)
- [x] Pure-Function-Tests für `capabilities.ts` (8 unit tests)
- [x] `@vitest/browser` mit Chromium-Provider (vitest.workspace.ts, project=browser)
- [x] OPFS-Wrapper (15 browser tests gegen echtes Chromium-OPFS)
- [x] IndexedDB jobs-db (9 browser tests gegen echtes IndexedDB)
- [x] Rust-WASM-Pipeline mit `cargo test` + Browser-Smoke-Test (sync-core lädt im Browser)
- [x] Goldfile-Snapshot-Skript: `tests/goldfiles/snapshot.py` produziert 5 Pair-Snapshots aus dem aktuellen Backend
- [ ] Playwright-E2E-Setup (vor Phase 1-Abschluss)
- [ ] CI-Konfiguration: unit bei jedem Commit, browser bei jedem PR, goldfile + e2e bei Release

## Wenn etwas vergessen wurde

Wenn beim Implementieren auffällt, dass ein Bereich nicht abgedeckt ist: zuerst Test schreiben (rot), dann die Lücke schließen. Nicht still nachholen — sichtbar machen, damit die Strategie ehrlich bleibt.
