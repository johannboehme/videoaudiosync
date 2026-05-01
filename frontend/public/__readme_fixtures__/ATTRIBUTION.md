# README screenshot fixtures

These files are used only by `frontend/scripts/readme-screenshots.mjs`
to generate the screenshots in `.github/screenshots/`. They're not
referenced by the application or the test suite.

## studio.mp3

Trimmed first 30 s of "Acid Jazz Groove" by alex-morgan, downloaded
from <https://pixabay.com/music/cafe-acid-jazz-groove-517096/>.

Pixabay Content License — free for commercial use, no attribution
required: <https://pixabay.com/service/license-summary/>.

## take-1.mp4, take-2.mp4, take-3.mp4

Each is a 12 s 720p clip cut from a Pixabay stock video, with the
original audio replaced by an offset segment of `studio.mp3` so the
sync algorithm has something to align against.

- `take-1.mp4`: <https://pixabay.com/videos/guitarist-music-playing-1651/>
  (audio = master 0–12 s)
- `take-2.mp4`: <https://pixabay.com/videos/drums-music-instrument-45444/>
  (audio = master 6–18 s)
- `take-3.mp4`: <https://pixabay.com/videos/girl-singer-band-performance-238854/>
  (audio = master 12–24 s)

All three are Pixabay Content License.
