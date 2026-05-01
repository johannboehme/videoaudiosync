#!/usr/bin/env bash
# Fetch CC-licensed / public-domain audio clips listed in corpus.tsv,
# convert to raw f32le @ 22050 Hz mono, and cache under bench/cache/.
#
# Idempotent: skips entries whose .f32 file already exists.
# Tab-separated columns in corpus.tsv: name, genre, url, start_s, duration_s
# Lines starting with `#` are skipped.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPUS="$HERE/corpus.tsv"
CACHE="$HERE/cache"
TARGET_SR=22050

mkdir -p "$CACHE"

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "error: yt-dlp not on PATH" >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg not on PATH" >&2
  exit 1
fi

ok=0
skipped=0
failed=0
failures=()

while IFS=$'\t' read -r name genre url start_s duration_s; do
  # Skip blanks and comments.
  case "${name:-}" in ""|\#*) continue ;; esac

  out_pcm="$CACHE/$name.f32"
  out_json="$CACHE/$name.json"

  if [[ -f "$out_pcm" && -f "$out_json" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "→ $name [$genre]  $url  start=${start_s}s dur=${duration_s}s"

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  # Stage 1: yt-dlp downloads best-audio (whatever container/codec the source
  # offers) into a temp dir. -f bestaudio picks the highest-quality audio
  # stream regardless of container.
  if ! yt-dlp \
      --quiet --no-warnings \
      --no-playlist \
      -f 'bestaudio/best' \
      -o "$tmp_dir/%(id)s.%(ext)s" \
      "$url"; then
    echo "  ✗ yt-dlp failed for $name" >&2
    failed=$((failed + 1))
    failures+=("$name")
    rm -rf "$tmp_dir"
    trap - EXIT
    continue
  fi

  src_file="$(find "$tmp_dir" -type f -maxdepth 1 | head -n1)"
  if [[ -z "$src_file" ]]; then
    echo "  ✗ yt-dlp produced no file for $name" >&2
    failed=$((failed + 1))
    failures+=("$name")
    rm -rf "$tmp_dir"
    trap - EXIT
    continue
  fi

  # Stage 2: ffmpeg trims to [start_s, start_s+duration_s], downmixes to mono,
  # resamples to 22050 Hz, and writes raw f32le (no header).
  if ! ffmpeg -hide_banner -loglevel error -y \
      -ss "$start_s" \
      -t "$duration_s" \
      -i "$src_file" \
      -ac 1 \
      -ar "$TARGET_SR" \
      -f f32le \
      "$out_pcm"; then
    echo "  ✗ ffmpeg failed for $name" >&2
    failed=$((failed + 1))
    failures+=("$name")
    rm -rf "$tmp_dir"
    trap - EXIT
    continue
  fi

  # Sidecar manifest: lets the bench loader know SR + length without
  # re-stat'ing the file. Keep it tiny — no jq dependency.
  n_samples=$(( $(wc -c < "$out_pcm") / 4 ))
  cat > "$out_json" <<EOF
{
  "name": "$name",
  "genre": "$genre",
  "source_url": "$url",
  "sr": $TARGET_SR,
  "n_samples": $n_samples,
  "start_s": $start_s,
  "duration_s": $duration_s
}
EOF

  rm -rf "$tmp_dir"
  trap - EXIT

  echo "  ✓ $out_pcm ($(printf '%.1f' "$(echo "$n_samples / $TARGET_SR" | bc -l)")s)"
  ok=$((ok + 1))
done < "$CORPUS"

echo
echo "=== fetch summary ==="
echo "fetched:  $ok"
echo "cached:   $skipped"
echo "failed:   $failed"
if (( failed > 0 )); then
  printf 'failures:\n'
  for n in "${failures[@]}"; do printf '  - %s\n' "$n"; done
  exit 1
fi
