# --- Stage 1: build the React frontend ---
# Use bookworm-slim instead of alpine — Vite's native deps (rollup, esbuild,
# lightningcss) ship glibc binaries by default; the alpine/musl variants need
# extra optionalDependencies that aren't always in the lockfile.
FROM node:20-bookworm-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund && \
    test -x node_modules/.bin/tsc || (echo "tsc missing after npm ci" && exit 1)
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Python runtime ---
FROM python:3.12-slim AS runtime

# ffmpeg + libsndfile (for soundfile) + minimal build deps for argon2-cffi/numpy/scipy
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
        libgomp1 \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (heavy, rarely changes). pyproject.toml alone is
# enough for pip to resolve dependencies, but the actual `app` package will
# be installed editable from /app in the next step so the `vasync` entry-point
# script can find it.
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --no-deps -e . || true && \
    pip install --no-cache-dir .

COPY app/ ./app/
COPY --from=frontend /fe/dist/ ./app/static/

# Re-install editable now that app/ exists, so vasync entry point resolves
# `from app.cli import cli` correctly regardless of cwd.
RUN pip install --no-cache-dir --no-deps -e .

ENV DATA_DIR=/data \
    PORT=8000 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

VOLUME ["/data"]
EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
