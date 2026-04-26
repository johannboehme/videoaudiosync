# VideoAudioSync

Self-hosted web app that takes a phone-recorded performance video and a clean
studio audio render, automatically aligns them, and produces a finished video.
Optional editor: cuts, animated text overlays (TikTok/CapCut-style), audio-reactive
visualizers.

**Production**: <https://sync.johannboehme.de>

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Local development](#local-development)
- [Tests](#tests)
- [Production deployment from scratch](#production-deployment-from-scratch)
- [Continuous deployment](#continuous-deployment)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)

---

## What it does

You film yourself playing a song on your phone (or Ray-Ban). Phone audio is bad
— bad mic, room reverb, background noise. The actual song was rendered cleanly
from your DAW (e.g. Teenage Engineering OP-1) as MP3/WAV.

Drag both files in. The app:

1. Extracts the phone-recorded audio from the video
2. Cross-correlates 12-bin chroma features to find the exact alignment
3. Falls back to chroma-DTW for non-linear drift if the simple match has low
   confidence
4. Re-mux the video with the studio audio at the right offset, applying
   atempo-based drift correction if needed

You get back a finished MP4. Optionally drop into the browser editor for cuts,
text overlays, and audio-reactive visualizers (showcqt / showfreqs / showwaves /
showspectrum / avectorscope) before final render.

## Architecture

Deliberately small. Made to fit on a single small VPS alongside other apps.

```
┌─────────────────────────── one Docker container ────────────────────────────┐
│                                                                              │
│  FastAPI (uvicorn)                                                           │
│  ├─ /api/auth/*       email + argon2 + signed-cookie session                 │
│  ├─ /api/jobs/*       upload, list, get, edit, download, delete              │
│  ├─ /api/jobs/{id}/events   SSE progress stream                              │
│  └─ /                 serves the built React SPA                             │
│                                                                              │
│  asyncio.Queue (in-process) → 1 worker task                                  │
│  └─ ProcessPoolExecutor(max_workers=1) for CPU-bound librosa                 │
│                                                                              │
│  pipeline                                                                    │
│  ├─ extract.py       ffmpeg: extract ref audio, thumbs, waveform peaks       │
│  ├─ sync.py          librosa chroma + scipy correlate + DTW fallback         │
│  ├─ energy.py        per-band rms curves for audio-reactive overlays         │
│  ├─ render_quick.py  audio-replace mux                                       │
│  ├─ render_edit.py   trim+concat / overlay / showcqt / ass burn-in           │
│  └─ ass.py           Advanced SubStation Alpha generator                     │
│                                                                              │
│  SQLite (one file at $DATA_DIR/db.sqlite)                                    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
        │                                   ▲
        ▼                                   │
   $DATA_DIR/                          nginx (host)
     db.sqlite                              ▲
     uploads/{job_id}/                      │
     cache/{job_id}/                        │
     renders/{job_id}/                  Cloudflare /
     tmp/{job_id}/                      Internet
```

**No Redis, no Celery, no separate worker container.** One serial job at a time
is enough for ≤ 3 users. The job code is plain `async def` — trivially
swappable to ARQ if it ever needs to scale.

**Stack**

| layer        | choice                                          |
|--------------|-------------------------------------------------|
| backend      | Python 3.12, FastAPI, SQLAlchemy 2.x async      |
| audio        | librosa, scipy, numpy, soundfile                |
| video        | ffmpeg (with libass for animated text)          |
| auth         | argon2-cffi + itsdangerous (signed cookie)      |
| db           | SQLite via aiosqlite                            |
| frontend     | React 18 + Vite + TypeScript + Tailwind         |
| tests        | pytest + httpx + Vitest + Testing Library       |
| container    | one Dockerfile, multi-stage (node + python)     |
| reverse prox | nginx + Let's Encrypt (already on the host)     |

## Local development

```bash
# bring up the container with auto-rebuild
docker compose up --build

# create a user (the only way users get added — there's no signup)
docker compose exec app vasync add-user you@example.com
```

App at <http://localhost:8000>.

If you want to run the backend without docker:

```bash
uv venv --python 3.13 .venv && source .venv/bin/activate
uv pip install -e ".[dev]"
uvicorn app.main:app --reload
# in another terminal:
cd frontend && npm install && npm run dev   # served at :5173 with /api → :8000
```

## Tests

Backend:

```bash
source .venv/bin/activate
pytest           # 49 tests, ~10 s on a laptop. Includes real-ffmpeg
                 # integration tests of the full sync+render pipeline.
                 # libass-dependent test auto-skips on macs whose Homebrew
                 # ffmpeg lacks libass; runs green inside the container.
```

Frontend:

```bash
cd frontend && npm test     # 38 tests, ~2 s
```

CI runs both on every push and PR — see `.github/workflows/test.yml`.

---

## Production deployment from scratch

This is the recipe used to bootstrap the production server (Debian 13 trixie,
4 vCPU, 8 GB RAM, netcup VPS). Run as a sudo-capable user.

### 0. Prerequisites

- A Debian-ish Linux box
- A domain pointing to the box (we use `sync.johannboehme.de`, served by an
  existing wildcard A-record `*.johannboehme.de`)
- nginx already installed and serving on :80/:443
- certbot installed (`apt-get install python3-certbot-nginx`)

### 1. Install Docker (official repo)

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg \
     -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
      https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
     | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
                        docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
# log out + back in for the docker group to take effect
```

### 2. Fix nftables for Docker networking *(required if your firewall has `policy drop` on `forward`)*

This was the most painful step on netcup. The default Debian firewall blocks
all forwarded traffic, which means Docker containers can't reach DNS during
build OR runtime. Add bridge-egress rules to the system nftables:

Open `/etc/nftables.conf`, find the `chain forward { ... }` block, and replace:

```nft
chain forward {
    type filter hook forward priority 0; policy drop;
}
```

with:

```nft
chain forward {
    type filter hook forward priority 0; policy drop;

    # Allow Docker bridge networks to reach the world (and replies back)
    ct state established,related accept
    iifname "docker0" accept
    iifname "br-*" accept
}
```

Then:

```bash
sudo nft -c -f /etc/nftables.conf && echo OK   # validate first
sudo systemctl restart nftables
```

Set Docker's DNS to public resolvers so containers can resolve names even when
the host uses ISP-specific nameservers that don't route from the bridge namespace:

```bash
echo '{"dns": ["1.1.1.1", "1.0.0.1", "8.8.8.8"]}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

### 3. Bootstrap the app

```bash
cd ~ && git clone https://github.com/johannboehme/videoaudiosync.git
cd videoaudiosync
mkdir -p data
SECRET=$(openssl rand -hex 32)
cat > .env <<EOF
SECRET_KEY=$SECRET
BASE_URL=https://sync.johannboehme.de
MAX_USER_QUOTA_GB=5
MAX_UPLOAD_MB=1024
EOF
chmod 600 .env

docker compose up -d --build
curl -s http://127.0.0.1:8000/api/health    # → {"status":"ok"}
```

Note: `docker-compose.yml` declares `build.network: host`. This is intentional
— without it, BuildKit's network namespace can't resolve DNS on hosts with the
nftables policy above.

### 4. Add your first user

```bash
docker exec -it videoaudiosync vasync add-user you@example.com
```

### 5. nginx vhost

A working template lives at `deploy/nginx-vhost.conf`. To install:

```bash
sudo cp deploy/nginx-vhost.conf /etc/nginx/sites-available/sync.johannboehme.de
# temporarily comment out the SSL listen lines so nginx -t passes pre-cert
sudo sed -i 's|^\(\s*listen .*443.*\)|# \1|' /etc/nginx/sites-available/sync.johannboehme.de
sudo ln -s /etc/nginx/sites-available/sync.johannboehme.de \
           /etc/nginx/sites-enabled/sync.johannboehme.de
sudo nginx -t && sudo systemctl reload nginx

# request the cert
sudo certbot --nginx -d sync.johannboehme.de \
  --non-interactive --agree-tos --email you@example.com --redirect
```

Certbot tends to make a mess of the file — it duplicates `server_name` blocks
and leaves dangling redirects. After it runs, **review and clean
up the vhost manually**. The canonical clean version is in
`deploy/nginx-vhost.conf` with both port-80 redirect and port-443 TLS server
blocks.

The vhost contains some non-default settings worth knowing:

- `client_max_body_size 2g` — videos are big
- `proxy_buffering off` + `proxy_read_timeout 1h` — SSE progress stream needs
  unbuffered streaming and long timeouts during multi-minute renders
- `proxy_set_header X-Forwarded-Proto $scheme` — so FastAPI's secure-cookie
  detection works behind the proxy

### 6. Verify

```bash
curl https://sync.johannboehme.de/api/health   # → {"status":"ok"}
```

Open the URL in a browser, sign in.

---

## Continuous deployment

Every push to `main` triggers `.github/workflows/deploy.yml`:

```
push to main
   │
   ├─► test.yml (called via `uses:`)
   │     ├─ backend: ubuntu + ffmpeg + python 3.13 + pytest (~1m30s)
   │     └─ frontend: node 20 + tsc -b + vitest (~25s)
   │
   ├─► deploy
   │     ├─ install DEPLOY_SSH_KEY into the runner
   │     ├─ ssh-keyscan DEPLOY_HOST → known_hosts
   │     └─ ssh devien@host 'bash ~/videoaudiosync/deploy/deploy.sh'
   │            │
   │            ├─ git fetch + reset --hard to origin/main
   │            ├─ docker compose build
   │            ├─ docker compose up -d
   │            ├─ docker image prune -af --filter until=168h
   │            └─ wait up to 30 s for /api/health, else rollback
```

Total wall time: ~2 minutes (tests run in parallel with the deploy gate).

### One-time CI secrets setup

The deploy workflow needs three repository secrets. Generate a dedicated SSH
keypair on the server (do **not** reuse your personal SSH key):

```bash
# on the server, as the deploy user (devien)
ssh-keygen -t ed25519 -N '' -C 'github-actions-deploy@videoaudiosync' \
           -f ~/.ssh/videoaudiosync_deploy

# restrict the public key so it can ONLY run the deploy script — no shell
PUBKEY=$(cat ~/.ssh/videoaudiosync_deploy.pub)
echo "command=\"bash /home/devien/videoaudiosync/deploy/deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $PUBKEY" \
     >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Then push the secrets via `gh` (use `--body` so there's no trailing newline —
that bites):

```bash
ssh devien@johannboehme.de "cat ~/.ssh/videoaudiosync_deploy" \
  | gh secret set DEPLOY_SSH_KEY --repo johannboehme/videoaudiosync
gh secret set DEPLOY_HOST --repo johannboehme/videoaudiosync --body "johannboehme.de"
gh secret set DEPLOY_USER --repo johannboehme/videoaudiosync --body "devien"
```

Verify:

```bash
gh secret list --repo johannboehme/videoaudiosync
```

The `command="..."` restriction in `authorized_keys` is the security
backbone here. Even if the GitHub secret leaked, an attacker could only
trigger the same deploy script — no shell, no scp, no port forward.

### Manual deploy

To deploy without pushing (e.g. to test deploy.sh changes):

```bash
gh workflow run deploy.yml --repo johannboehme/videoaudiosync --ref main
gh run watch $(gh run list --repo johannboehme/videoaudiosync \
               --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Or directly on the server:

```bash
ssh devien@johannboehme.de 'bash ~/videoaudiosync/deploy/deploy.sh'
```

---

## Operations

### Add or remove users

```bash
ssh devien@johannboehme.de docker exec -it videoaudiosync vasync add-user a@b.com
ssh devien@johannboehme.de docker exec -it videoaudiosync vasync set-password a@b.com
ssh devien@johannboehme.de docker exec    videoaudiosync vasync list-users
```

### Logs

```bash
ssh devien@johannboehme.de docker compose -f ~/videoaudiosync/docker-compose.yml logs -f --tail=100
```

### Backups

The only stateful path is `~/videoaudiosync/data/`. Tar it:

```bash
ssh devien@johannboehme.de \
  'tar czf /tmp/vasync-backup-$(date +%F).tar.gz -C ~/videoaudiosync data'
```

SQLite is the bulk of what you actually want to keep — uploads/renders are
auto-pruned after 14 days by the in-process cleanup loop in `app/main.py`.

### Updating Docker / nginx / certbot

Standard `apt` updates. The container is rebuilt by every deploy, so there's no
in-container patching to do.

### Quota and storage

Default per-user quota is 5 GB (`MAX_USER_QUOTA_GB`). Files older than 14 days
are auto-expired (DB row marked `expired`, files deleted). Tweak via `.env`.

---

## Troubleshooting

### `npm error Exit handler never called!` during build

DNS resolution failing inside the build container. Either the firewall blocks
the bridge (see [step 2](#2-fix-nftables-for-docker-networking-required-if-your-firewall-has-policy-drop-on-forward))
or Docker's daemon DNS isn't set. Verify with:

```bash
docker run --rm node:20-bookworm-slim getent hosts registry.npmjs.org
```

Should print an IP. If it times out, your nftables rules aren't permitting
egress from the docker bridge.

### `iptables: No chain/target/match by that name` on `compose up`

Docker tries to write rules into chains that don't exist yet. Restart the
docker daemon — it recreates the chains on startup:

```bash
sudo systemctl restart docker
```

### `vasync` exits with `ModuleNotFoundError: No module named 'app'`

The Dockerfile must run `pip install -e .` *after* the app source is COPY'd.
Already fixed in the current Dockerfile (the editable install reruns post-COPY
and `PYTHONPATH=/app` is set as belt-and-suspenders).

### Nginx returns 301 to itself or "conflicting server name" warnings

Certbot rewrote your vhost into nonsense. Replace it with the canonical
template at `deploy/nginx-vhost.conf` (manual `cp`, then `nginx -t`, then
`systemctl reload nginx`). Don't run `certbot --nginx` on it again — use
`certbot renew` only, which doesn't touch the vhost file.

### Sync confidence is low / output is misaligned

The DTW fallback runs automatically when chroma cross-correlation confidence is
below 0.4. If the result still has `sync_warning` set, the source audio is
probably too different from the studio version (different key? different mix?)
or the recording is too short (<3 seconds of music). The job page surfaces the
warning instead of silently shipping bad output.

### SSE progress stops updating

nginx is buffering. Check the vhost has `proxy_buffering off` and
`proxy_read_timeout 1h` in the `:443` server block. Also verify the deploy
didn't strip those — `deploy/nginx-vhost.conf` is the source of truth, the
running config can drift if edited by hand.

### Deploy hangs at `Set up SSH`

Either the secrets are empty (check `gh secret list --repo …`), or one of them
got a trailing newline because it was `echo`-piped instead of passed via
`--body`. Re-set them:

```bash
gh secret set DEPLOY_HOST --repo johannboehme/videoaudiosync --body "johannboehme.de"
```

### Rollback after a bad deploy

`deploy.sh` already auto-rolls-back if `/api/health` doesn't return 200 within
30 s. To force-roll-back to a specific SHA:

```bash
ssh devien@johannboehme.de 'cd ~/videoaudiosync && git reset --hard <sha> && docker compose up -d --build'
```
