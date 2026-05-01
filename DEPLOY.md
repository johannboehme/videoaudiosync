# Self-hosting TK-1

Notes for forking the project and running your own instance. The
public deployment at <https://tk-1.app> uses exactly this setup.

## Configuring your instance

The legal pages (`/impressum`, `/datenschutz`) read their operator
details from build-time env vars, so the source tree stays free of any
single deployment's name and address. Copy the example file at the
repo root:

```bash
cp .env.example .env
$EDITOR .env
```

The schema (see [`.env.example`](.env.example) for full comments):

| Variable                          | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `VITE_IMPRESSUM_NAME`             | Operator's full legal name                           |
| `VITE_IMPRESSUM_ADDRESS_LINE_1`   | Street + number                                      |
| `VITE_IMPRESSUM_ADDRESS_LINE_2`   | Postal code + city                                   |
| `VITE_IMPRESSUM_COUNTRY`          | Country (optional, displayed if set)                 |
| `VITE_IMPRESSUM_EMAIL`            | Contact e-mail                                       |
| `VITE_DSGVO_AUTHORITY_NAME`       | Supervisory authority (optional)                     |
| `VITE_DSGVO_AUTHORITY_ADDRESS`    | Authority postal address (optional)                  |

Vite reads these at build time (`envDir: ".."` in
[`frontend/vite.config.ts`](frontend/vite.config.ts)) and inlines them
into the static bundle. The Docker build picks them up via build args
declared in [`docker-compose.yml`](docker-compose.yml) and
[`Dockerfile`](Dockerfile).

If any of the four imprint fields is missing at build time,
`/impressum` renders an obvious "Imprint not configured" placeholder
instead of partial details, so you notice before the public does. The
`/datenschutz` supervisory-authority block falls back to a generic
notice if the authority vars are unset.

After changing `.env`, rebuild: `docker compose up -d --build`.

## Production deployment

The container is two stages: build the React app and the Rust→WASM
core, then serve `dist/` from `nginx:1.27-alpine` with COOP/COEP set
in [`deploy/nginx.conf`](deploy/nginx.conf).

Bootstrap on a fresh Debian or Ubuntu server:

```bash
sudo apt-get update && sudo apt-get install -y \
  docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
git clone https://github.com/<you>/tk-1.git ~/tk-1
cd ~/tk-1
cp .env.example .env && $EDITOR .env       # imprint config (above)
sudo cp deploy/nginx-vhost.conf /etc/nginx/sites-available/<your-host>
sudo ln -s /etc/nginx/sites-available/<your-host> /etc/nginx/sites-enabled/
sudo certbot --nginx -d <your-host>
docker compose up -d --build
```

Continuous deployment: run [`deploy/deploy.sh`](deploy/deploy.sh) from
a cron or push hook on the server. It pulls main, rebuilds the image,
rolls the container, and rolls back on a failed readiness check. The
script never touches your `.env`, so the imprint survives upgrades.

Updating is `git pull && docker compose up -d --build`.

If `crossOriginIsolated === false` in the page console, check that
both the host nginx vhost and the container's `nginx.conf` keep
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` intact.

## Hosting in Germany — compliance checklist

The published instance ships with what a private, non-commercial tool
in DE typically needs. If you fork and host your own:

- **Fill `.env`** so the imprint pages render real, legally-required
  details (see *Configuring your instance* above).
- **Update the supervisory authority** via `VITE_DSGVO_AUTHORITY_*`
  if you're not in Bavaria.
- **Anonymise nginx logs.**
  [`deploy/nginx-vhost.conf`](deploy/nginx-vhost.conf) enables an
  `anon` log format; the matching `map` and `log_format` directives
  must live at `http {}` scope in the host `/etc/nginx/nginx.conf`,
  see the comment block at the top of the vhost file.
- **Log retention.** `/etc/logrotate.d/nginx` already rotates
  `/var/log/nginx/*.log` daily with `rotate 14`, so the access log
  drops after 14 days. The privacy policy mirrors that number; if you
  change retention, update
  [`frontend/src/pages/Datenschutz.tsx`](frontend/src/pages/Datenschutz.tsx).
- **Web fonts are bundled locally** via `@fontsource-variable/*`. Do
  not re-introduce a `fonts.googleapis.com` import.
- **No analytics, no tracking, no cookies.** Keep it that way; if you
  add any, the privacy policy must change accordingly.

Not legal advice. For a forked deployment that goes beyond a personal
hobby project, have a lawyer review the imprint and privacy policy
texts.
