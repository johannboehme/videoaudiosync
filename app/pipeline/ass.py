"""Generate ASS (Advanced SubStation Alpha) subtitles for animated text overlays.

Supports:
  - Style presets (plain, boxed, outline, glow, gradient)
  - Animations (fade, pop, slide_in, word_reveal, wobble)
  - Audio-reactive modulation: per-frame scale/rotation/y-shift driven by energy curves
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


def _ts(t: float) -> str:
    """Convert seconds to ASS timestamp H:MM:SS.cs"""
    if t < 0:
        t = 0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _ass_color(rgb: str, alpha: int = 0) -> str:
    """rgb '#RRGGBB' or 'RRGGBB' → ASS &HAABBGGRR"""
    rgb = rgb.lstrip("#")
    r, g, b = int(rgb[0:2], 16), int(rgb[2:4], 16), int(rgb[4:6], 16)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


PRESETS: dict[str, dict[str, Any]] = {
    "plain": {
        "font": "Arial", "size": 64, "primary": "#FFFFFF", "outline": "#000000",
        "outline_w": 2, "shadow": 0, "bold": -1,
    },
    "boxed": {
        "font": "Arial Black", "size": 56, "primary": "#000000", "outline": "#FFFFFF",
        "outline_w": 0, "shadow": 0, "bold": -1, "border_style": 4,
        "back_color": "#FFFFFF",
    },
    "outline": {
        "font": "Arial Black", "size": 64, "primary": "#FFFFFF", "outline": "#000000",
        "outline_w": 4, "shadow": 0, "bold": -1,
    },
    "glow": {
        "font": "Arial Black", "size": 64, "primary": "#FFFFFF", "outline": "#FF00FF",
        "outline_w": 2, "shadow": 4, "bold": -1,
    },
    "gradient": {
        # ASS doesn't do real gradients without VSFilter mod; use bright color + heavy outline
        "font": "Arial Black", "size": 72, "primary": "#FFD93D", "outline": "#6BCB77",
        "outline_w": 3, "shadow": 0, "bold": -1,
    },
}


@dataclass(slots=True)
class TextOverlay:
    text: str
    start: float  # seconds
    end: float
    preset: str = "plain"
    x: float = 0.5  # 0..1 normalized
    y: float = 0.85
    animation: str = "fade"  # fade | pop | slide_in | word_reveal | wobble | none
    reactive_band: str | None = None  # e.g. "bass"
    reactive_param: str = "scale"  # scale | y | rotate
    reactive_amount: float = 0.3


def _style_block(name: str, p: dict[str, Any]) -> str:
    primary = _ass_color(p["primary"])
    outline = _ass_color(p["outline"])
    back = _ass_color(p.get("back_color", "#000000"))
    border_style = p.get("border_style", 1)  # 1 = outline+drop shadow, 4 = opaque box
    return (
        f"Style: {name},{p['font']},{p['size']},{primary},&H000000FF,{outline},{back},"
        f"{p.get('bold', 0)},0,0,0,100,100,0,0,{border_style},{p.get('outline_w',2)},"
        f"{p.get('shadow',0)},5,30,30,30,1"
    )


def _animation_tags(o: TextOverlay, w: int, h: int) -> tuple[str, str]:
    """Returns (open_tags, body_text). Coordinates: pos via \\pos."""
    px = int(round(o.x * w))
    py = int(round(o.y * h))
    dur_ms = max(1, int((o.end - o.start) * 1000))
    tags = [f"\\pos({px},{py})", "\\an5"]

    if o.animation == "fade":
        tags.append(f"\\fad(200,200)")
    elif o.animation == "pop":
        # scale from 0% to 100% in first 250ms (overshoot-ish)
        tags.append(f"\\fscx0\\fscy0\\t(0,150,\\fscx115\\fscy115)\\t(150,250,\\fscx100\\fscy100)\\fad(0,200)")
    elif o.animation == "slide_in":
        tags.append(f"\\move({px - 200},{py},{px},{py},0,250)\\fad(0,200)")
    elif o.animation == "wobble":
        tags.append(f"\\t(0,{dur_ms},\\frz3)\\t({dur_ms // 2},{dur_ms},\\frz-3)\\fad(150,150)")
    elif o.animation == "word_reveal":
        # handled below: split per word
        pass

    open_tags = "{" + "".join(tags) + "}"

    if o.animation == "word_reveal":
        words = o.text.split()
        if not words:
            return open_tags, o.text
        per = dur_ms // max(1, len(words))
        parts = []
        for i, w_ in enumerate(words):
            t1 = i * per
            t2 = t1 + min(120, per)
            parts.append(f"{{\\alpha&HFF&\\t({t1},{t2},\\alpha&H00&)}}{w_} ")
        body = "".join(parts).rstrip()
        return open_tags, body

    return open_tags, o.text


def _reactive_keyframes(
    o: TextOverlay,
    energy: dict[str, Any] | None,
    duration_s: float,
) -> str:
    """Render reactive modulation as a series of \\t() segments referencing the band curve.

    Sampled at 'sample_fps' (lower than render fps to keep ASS small).
    """
    if not energy or not o.reactive_band:
        return ""
    band = energy.get("bands", {}).get(o.reactive_band)
    if not band:
        return ""
    energy_fps = float(energy.get("fps") or 30.0)

    sample_fps = 12.0  # 12 keyframes/sec is plenty for visual modulation
    n = max(1, int(round(duration_s * sample_fps)))
    step_ms = int(1000 / sample_fps)

    parts = []
    for i in range(n):
        t_ms = i * step_ms
        t_seconds = o.start + i / sample_fps
        idx = int(round(t_seconds * energy_fps))
        v = float(band[idx]) if 0 <= idx < len(band) else 0.0
        amt = o.reactive_amount * v
        if o.reactive_param == "scale":
            scale = int(round(100 * (1 + amt)))
            parts.append(f"\\t({t_ms},{t_ms + step_ms},\\fscx{scale}\\fscy{scale})")
        elif o.reactive_param == "y":
            dy = int(round(-amt * 30))
            parts.append(f"\\t({t_ms},{t_ms + step_ms},\\move(0,0,0,{dy}))")
        elif o.reactive_param == "rotate":
            ang = round(amt * 8, 2)
            parts.append(f"\\t({t_ms},{t_ms + step_ms},\\frz{ang})")
    return "".join(parts)


def build_ass(
    overlays: list[TextOverlay],
    width: int,
    height: int,
    energy: dict[str, Any] | None = None,
) -> str:
    presets_used = {o.preset for o in overlays if o.preset in PRESETS}
    if not presets_used:
        presets_used = {"plain"}

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
    )
    styles = "\n".join(_style_block(p, PRESETS[p]) for p in presets_used)

    events_header = (
        "\n\n[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    lines = []
    for o in overlays:
        preset = o.preset if o.preset in PRESETS else "plain"
        open_tags, body = _animation_tags(o, width, height)
        # Insert reactive segments inside the same tag block — append before closing brace.
        reactive = _reactive_keyframes(o, energy, duration_s=o.end - o.start)
        if reactive:
            open_tags = open_tags[:-1] + reactive + "}"
        lines.append(
            f"Dialogue: 0,{_ts(o.start)},{_ts(o.end)},{preset},,0,0,0,,{open_tags}{body}"
        )

    return header + styles + events_header + "\n".join(lines) + "\n"


def overlays_from_spec(items: list[dict[str, Any]]) -> list[TextOverlay]:
    out: list[TextOverlay] = []
    for it in items:
        if it.get("type") != "text":
            continue
        reactive = it.get("reactive") or {}
        out.append(
            TextOverlay(
                text=str(it.get("text", "")),
                start=float(it.get("start", 0.0)),
                end=float(it.get("end", 0.0)),
                preset=str(it.get("preset", "plain")),
                x=float(it.get("x", 0.5)),
                y=float(it.get("y", 0.85)),
                animation=str(it.get("animation", "fade")),
                reactive_band=reactive.get("band"),
                reactive_param=str(reactive.get("param", "scale")),
                reactive_amount=float(reactive.get("amount", 0.3)),
            )
        )
    return out


def write_ass_file(
    overlays: list[TextOverlay],
    width: int,
    height: int,
    out_path: Path,
    energy: dict[str, Any] | None = None,
) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(build_ass(overlays, width, height, energy), encoding="utf-8")
    return out_path
