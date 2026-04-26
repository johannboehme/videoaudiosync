# VideoAudioSync

Auto-sync a clean studio audio file (MP3/WAV) onto a phone-recorded performance video.
Optional editor: cuts, animated text overlays, audio-reactive visualizers.

Built for self-hosting on a small VPS. One container. SQLite. No Redis. No Whisper.

## Run locally

```bash
docker compose up --build
# then add a user
docker compose exec app vasync add-user you@example.com
```

App: http://localhost:8000

## Deploy

Reverse-proxy `sync.johannboehme.de` → `127.0.0.1:8000`. Set `SECRET_KEY` and `BASE_URL` in `.env`. Persist `./data`.
