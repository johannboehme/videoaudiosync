#!/usr/bin/env bash
# Generate synthetic test fixtures with KNOWN sync offsets so the e2e
# can grade the sync algorithm against ground truth.
#
# Master audio: 30s of band-limited noise + click track at 1Hz (loud
# transient every second so the sync algorithm has clear features).
#
# Then several "phone recordings" of that same audio with deliberate
# offsets — each video has the master audio starting at a specific
# time inside its own track:
#
#   cam-on-time.mp4   — master audio starts at video t=0    (offset 0)
#   cam-late-2s.mp4   — master audio starts at video t=2s   (offset +2000)
#   cam-early-1s.mp4  — master audio starts at video t=-1s  (-1000)
#                       (i.e. the video is missing the first 1s of master)
#   cam-overlap.mp4   — master audio starts at video t=5s, video is 15s
#                       (covers master t=-5..10 only — useful for cuts)

set -euo pipefail
cd "$(dirname "$0")"

DUR_MASTER=30
SR=44100

# 1. Master audio: noise + 1Hz click track, mono, 30s
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -t ${DUR_MASTER} -i "anoisesrc=color=pink:sample_rate=${SR}:amplitude=0.10" \
  -f lavfi -t ${DUR_MASTER} -i "aevalsrc=if(lt(mod(t\,1)\,0.05)\,sin(2*PI*1500*t)\,0):s=${SR}" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest:weights='1 1.5'" \
  -ac 1 -ar ${SR} master.wav

# 2. Helper: make a "phone recording" where the master audio appears at
#    video time `audio_start_in_video`. The video is `video_dur` seconds.
#    Pixels: 320x240 testsrc, just so we have a real H.264 track.
make_cam() {
  local name=$1 audio_start_in_video=$2 video_dur=$3

  # Build the cam audio: silence before audio_start_in_video, then master,
  # truncated/extended to video_dur.
  if (( $(echo "$audio_start_in_video > 0" | bc -l) )); then
    # silence + master
    ffmpeg -y -hide_banner -loglevel error \
      -f lavfi -t ${audio_start_in_video} -i "anullsrc=r=${SR}:cl=mono" \
      -i master.wav \
      -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1,atrim=0:${video_dur}" \
      -ac 1 -ar ${SR} _cam_${name}_audio.wav
  else
    # master starts BEFORE video t=0 (skip first |audio_start_in_video|s)
    local skip=${audio_start_in_video#-}
    ffmpeg -y -hide_banner -loglevel error \
      -i master.wav -ss ${skip} -t ${video_dur} \
      -ac 1 -ar ${SR} _cam_${name}_audio.wav
  fi

  # Build the video track (testsrc — has built-in counter) and mux audio.
  ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -t ${video_dur} -i "testsrc=size=320x240:rate=24" \
    -i _cam_${name}_audio.wav \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
    -c:a aac -b:a 128k -shortest \
    cam-${name}.mp4

  rm -f _cam_${name}_audio.wav
}

make_cam on-time   0    30
make_cam late-2s   2    32
make_cam early-1s  -1   29
make_cam overlap   5    20

ls -la *.wav *.mp4
