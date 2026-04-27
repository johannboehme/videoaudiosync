# Build the React app and serve it from a tiny nginx image. Everything that
# used to be Python (sync, render, ffmpeg, librosa, scipy) now runs in the
# user's browser via WebCodecs / WASM. The container is just static hosting.

# --- Stage 1: build the React frontend (incl. Rust → WASM sync core) ---
FROM node:20-bookworm-slim AS frontend
WORKDIR /fe

# Rust + wasm-pack to compile the sync-core WASM module that the frontend
# loads at runtime. Pinned to stable for reproducible builds.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal \
    && /root/.cargo/bin/rustup target add wasm32-unknown-unknown \
    && /root/.cargo/bin/cargo install --locked wasm-pack
ENV PATH="/root/.cargo/bin:${PATH}"

# Copy package manifests AND the scripts directory first — `npm ci` runs
# our postinstall (`scripts/copy-runtime-assets.mjs`) which needs the
# script file to exist. Keeping the heavy `frontend/` copy after `npm ci`
# preserves Docker layer caching for the slow node_modules step.
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts ./scripts
RUN npm ci --no-audit --no-fund --legacy-peer-deps && \
    test -x node_modules/.bin/tsc || (echo "tsc missing after npm ci" && exit 1)
COPY frontend/ ./
RUN npm run build

# --- Stage 2: nginx static hosting with COOP/COEP ---
FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /fe/dist/ /usr/share/nginx/html/

EXPOSE 80
