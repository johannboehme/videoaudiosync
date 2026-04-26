"""ASS subtitle generation: presets, animations, audio-reactive modulation."""
from __future__ import annotations

import re

import pytest

from app.pipeline.ass import (
    PRESETS,
    TextOverlay,
    build_ass,
    overlays_from_spec,
    write_ass_file,
)


def test_build_ass_returns_valid_skeleton():
    ass = build_ass([], 1280, 720)
    assert "[Script Info]" in ass
    assert "PlayResX: 1280" in ass
    assert "PlayResY: 720" in ass
    assert "[V4+ Styles]" in ass
    assert "[Events]" in ass


def test_dialog_uses_correct_timestamps_for_overlay():
    o = TextOverlay(text="Hi", start=1.5, end=2.75, animation="none", preset="plain")
    ass = build_ass([o], 1280, 720)
    # ASS uses H:MM:SS.cs
    assert re.search(r"Dialogue:\s*0,0:00:01\.50,0:00:02\.75,plain", ass)


def test_text_appears_in_event_body():
    o = TextOverlay(text="Drop the beat", start=0.0, end=2.0, animation="none", preset="plain")
    ass = build_ass([o], 1280, 720)
    # body comes after the closing brace of the override block
    assert "}Drop the beat" in ass


def test_each_preset_emits_its_own_style_definition():
    overlays = [
        TextOverlay(text=p, start=0.0, end=1.0, preset=p, animation="none")
        for p in ("plain", "boxed", "outline", "glow", "gradient")
    ]
    ass = build_ass(overlays, 1280, 720)
    for p in PRESETS:
        assert f"Style: {p}," in ass, f"missing style block for preset {p}"


def test_position_is_normalized_to_video_dimensions():
    # x=0.25 with 1000px width → 250
    o = TextOverlay(text="x", start=0.0, end=1.0, x=0.25, y=0.5, animation="none")
    ass = build_ass([o], 1000, 800)
    assert "\\pos(250,400)" in ass


def test_word_reveal_splits_words_with_alpha_keyframes():
    o = TextOverlay(text="one two three", start=0.0, end=3.0, animation="word_reveal")
    ass = build_ass([o], 1280, 720)
    # one \alpha keyframe per word
    assert ass.count("\\alpha") >= 6  # 2 alpha tags per word (initial + transition)
    assert "one" in ass
    assert "two" in ass
    assert "three" in ass


def test_reactive_band_inserts_keyframes_proportional_to_amount():
    energy = {
        "fps": 30.0,
        "frames": 120,
        "bands": {"bass": [0.0] * 30 + [1.0] * 30 + [0.0] * 60},
    }
    o = TextOverlay(
        text="boom",
        start=0.0,
        end=2.0,
        animation="fade",
        reactive_band="bass",
        reactive_param="scale",
        reactive_amount=0.5,
    )
    ass = build_ass([o], 1280, 720, energy=energy)
    # at peak (band=1.0, amount=0.5) we expect scale ≈ 150
    assert "\\fscx150\\fscy150" in ass
    # baseline 100 (band=0.0) should also appear
    assert "\\fscx100\\fscy100" in ass


def test_reactive_param_rotate_emits_frz_tags():
    energy = {"fps": 30.0, "bands": {"highs": [0.5] * 60}}
    o = TextOverlay(
        text="x", start=0.0, end=2.0, reactive_band="highs",
        reactive_param="rotate", reactive_amount=1.0,
    )
    ass = build_ass([o], 1280, 720, energy=energy)
    assert "\\frz" in ass


def test_overlays_from_spec_filters_non_text_items():
    spec = [
        {"type": "text", "text": "hi", "start": 0, "end": 1},
        {"type": "shape", "x": 0.5, "y": 0.5},
        {"type": "text", "text": "bye", "start": 1, "end": 2, "preset": "boxed"},
    ]
    out = overlays_from_spec(spec)
    assert [o.text for o in out] == ["hi", "bye"]
    assert out[1].preset == "boxed"


def test_overlays_from_spec_picks_up_reactive_block():
    spec = [{
        "type": "text",
        "text": "react",
        "start": 0,
        "end": 1,
        "reactive": {"band": "mids", "param": "y", "amount": 0.7},
    }]
    out = overlays_from_spec(spec)
    assert out[0].reactive_band == "mids"
    assert out[0].reactive_param == "y"
    assert out[0].reactive_amount == pytest.approx(0.7)


def test_write_ass_file_writes_to_disk(tmp_path):
    o = TextOverlay(text="hello", start=0.0, end=1.0, animation="none")
    out = write_ass_file([o], 320, 240, tmp_path / "sub.ass")
    assert out.exists()
    content = out.read_text(encoding="utf-8")
    assert "hello" in content
    assert "PlayResX: 320" in content


def test_negative_start_time_clamped_to_zero():
    """Defensive: an overlay with start<0 shouldn't crash and should emit 0:00:00.00."""
    o = TextOverlay(text="x", start=-1.0, end=1.0, animation="none")
    ass = build_ass([o], 1280, 720)
    assert "0:00:00.00" in ass
