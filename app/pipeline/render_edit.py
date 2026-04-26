"""Editor-mode render: cuts + audio replace + ASS overlays + visualizer overlay."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from app.pipeline.ass import overlays_from_spec, write_ass_file
from app.pipeline.energy import compute_energy_curves
from app.pipeline.ffmpeg_util import duration_s, ffmpeg, ffmpeg_with_progress, ffprobe, video_dims


_VISUALIZER_FILTERS: dict[str, Callable[[int, int], str]] = {
    "showcqt": lambda w, h: f"showcqt=s={w}x{h}:fps=30:axis=0:bar_g=2:cscheme=1|0.5|0|0|0.5|1",
    "showfreqs": lambda w, h: f"showfreqs=s={w}x{h}:mode=bar:ascale=log:fscale=log",
    "showwaves": lambda w, h: f"showwaves=s={w}x{h}:mode=cline:rate=30:colors=white",
    "showspectrum": lambda w, h: f"showspectrum=s={w}x{h}:slide=scroll:mode=combined:scale=log",
    "avectorscope": lambda w, h: f"avectorscope=s={w}x{h}:mode=lissajous:rate=30:rc=2:gc=200:bc=80",
}


def _build_cut_chains(
    segments: list[dict[str, Any]], v_in: str, a_in: str, prefix: str = "seg"
) -> tuple[list[str], str, str]:
    """For each {in, out} segment, build a trim chain for video + audio, then concat them.

    Returns (filter_chunks, last_v_label, last_a_label). If `segments` is empty, returns
    ([], v_in, a_in) — caller can pass through unchanged.
    """
    if not segments:
        return [], v_in, a_in

    chunks: list[str] = []
    pair_labels: list[str] = []
    for i, seg in enumerate(segments):
        s_in = float(seg["in"])
        s_out = float(seg["out"])
        if s_out <= s_in:
            continue
        v_lbl = f"[{prefix}v{i}]"
        a_lbl = f"[{prefix}a{i}]"
        chunks.append(f"{v_in}trim={s_in:.4f}:{s_out:.4f},setpts=PTS-STARTPTS{v_lbl}")
        chunks.append(f"{a_in}atrim={s_in:.4f}:{s_out:.4f},asetpts=PTS-STARTPTS{a_lbl}")
        pair_labels.append(v_lbl + a_lbl)

    if not pair_labels:
        return [], v_in, a_in

    if len(pair_labels) == 1:
        # single segment — no concat needed
        v_lbl = f"[{prefix}v0]"
        a_lbl = f"[{prefix}a0]"
        return chunks, v_lbl, a_lbl

    # concat them all
    n = len(pair_labels)
    v_out = f"[{prefix}v_concat]"
    a_out = f"[{prefix}a_concat]"
    chunks.append(f"{''.join(pair_labels)}concat=n={n}:v=1:a=1{v_out}{a_out}")
    return chunks, v_out, a_out


async def edit_render(
    *,
    video_path: Path,
    studio_audio_path: Path,
    offset_ms: float,
    drift_ratio: float,
    edit_spec: dict[str, Any],
    out_path: Path,
    cache_dir: Path,
    progress_cb: Callable[[float], None] | None = None,
) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    probe = await ffprobe(video_path)
    dims = video_dims(probe) or (1280, 720)
    width, height = dims

    if progress_cb:
        progress_cb(15)

    segments = edit_spec.get("segments") or []
    overlays = overlays_from_spec(edit_spec.get("overlays") or [])
    visualizer = edit_spec.get("visualizer") or {}

    # === audio energy curves (only if any overlay is reactive OR visualizer present) ===
    energy: dict[str, Any] | None = None
    needs_energy = any(o.reactive_band for o in overlays)
    if needs_energy:
        energy_path = cache_dir / "energy.json"
        if not energy_path.exists():
            compute_energy_curves(studio_audio_path, energy_path)
        energy = json.loads(energy_path.read_text())

    if progress_cb:
        progress_cb(30)

    # === Build filter graph ===
    # Inputs:
    #   [0:v] video, [1:a] studio audio
    # Optional [1:a] also as visualizer source.
    filter_chains: list[str] = []
    last_v = "[0:v]"
    last_a = "[1:a]"

    # Audio chain: drift + offset
    audio_chain: list[str] = []
    if abs(drift_ratio - 1.0) > 0.001:
        target = drift_ratio
        while target < 0.5:
            audio_chain.append("atempo=0.5")
            target /= 0.5
        while target > 2.0:
            audio_chain.append("atempo=2.0")
            target /= 2.0
        audio_chain.append(f"atempo={target:.6f}")
    if offset_ms > 0:
        audio_chain.append(f"adelay={int(round(offset_ms))}|{int(round(offset_ms))}:all=1")
    elif offset_ms < 0:
        audio_chain.append(f"atrim=start={abs(offset_ms) / 1000.0:.3f},asetpts=PTS-STARTPTS")

    if audio_chain:
        filter_chains.append(f"{last_a}{','.join(audio_chain)}[a1]")
        last_a = "[a1]"

    # Video segment selection (cuts) via trim + concat
    cut_chunks, last_v, last_a = _build_cut_chains(segments, last_v, last_a)
    filter_chains.extend(cut_chunks)

    # Visualizer overlay
    viz_type = visualizer.get("type")
    if viz_type and viz_type in _VISUALIZER_FILTERS:
        viz_h_pct = float(visualizer.get("height_pct", 0.2))
        viz_h = max(40, int(height * viz_h_pct))
        viz_w = width
        position = visualizer.get("position", "bottom")
        opacity = float(visualizer.get("opacity", 0.7))

        viz_filter = _VISUALIZER_FILTERS[viz_type](viz_w, viz_h)
        filter_chains.append(
            # Use a copy of the (already shifted) audio for visualization.
            f"{last_a}asplit=2[aout][aviz];[aviz]{viz_filter}[viz_raw]"
        )
        last_a = "[aout]"
        # add alpha
        filter_chains.append(
            f"[viz_raw]format=yuva420p,colorchannelmixer=aa={opacity}[viz]"
        )
        if position == "top":
            ovl = "0:0"
        elif position == "center":
            ovl = f"0:(H-h)/2"
        else:
            ovl = f"0:H-h"
        filter_chains.append(f"{last_v}[viz]overlay={ovl}[v_viz]")
        last_v = "[v_viz]"

    # ASS subtitles overlay (text)
    if overlays:
        ass_path = cache_dir / "overlays.ass"
        write_ass_file(overlays, width, height, ass_path, energy=energy)
        # Escape `\`, `:`, `'` in path so the filter parser treats it as one filename arg.
        escaped = (
            str(ass_path)
            .replace("\\", "\\\\")
            .replace(":", "\\:")
            .replace("'", "\\'")
        )
        filter_chains.append(f"{last_v}ass=filename={escaped}[v_ass]")
        last_v = "[v_ass]"

    # If we did nothing to v/a, alias them
    if last_v == "[0:v]":
        filter_chains.append("[0:v]copy[vf]")
        last_v = "[vf]"
    if last_a == "[1:a]":
        filter_chains.append("[1:a]anull[af]")
        last_a = "[af]"
    else:
        # rename last to af for predictable -map
        filter_chains.append(f"{last_a}anull[af]")
        last_a = "[af]"

    if last_v != "[vf]":
        filter_chains.append(f"{last_v}null[vf]")
        last_v = "[vf]"

    filter_complex = ";".join(filter_chains)

    if progress_cb:
        progress_cb(45)

    args = [
        "-i", str(video_path),
        "-i", str(studio_audio_path),
        "-filter_complex", filter_complex,
        "-map", "[vf]",
        "-map", "[af]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        str(out_path),
    ]
    # Output duration: sum of segments, or full input duration if no cuts.
    out_dur = sum(
        max(0.0, float(s.get("out", 0)) - float(s.get("in", 0))) for s in segments
    )
    if out_dur <= 0:
        out_dur = duration_s(probe) or 0.0

    if progress_cb is not None and out_dur > 0:
        # Map ffmpeg's 0..1 fraction into the sub-range [45, 95].
        async def _cb(fraction: float, _eta: float | None) -> None:
            progress_cb(45.0 + 50.0 * max(0.0, min(1.0, fraction)))
        await ffmpeg_with_progress(args, expected_duration_s=out_dur, on_progress=_cb)
    else:
        await ffmpeg(args)
    if progress_cb:
        progress_cb(95)
    return out_path
