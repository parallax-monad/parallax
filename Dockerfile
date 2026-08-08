FROM --platform=linux/amd64 node:22.23.2-bookworm-slim

ENV COREPACK_HOME=/opt/corepack
ENV PNPM_HOME=/opt/pnpm
ENV PATH=/opt/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git g++ make python3 \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.10.0 --activate

WORKDIR /app
COPY . .

# Parallax loads Moss from a real Git checkout and verifies both its HEAD and
# every built package before opening the HTTP listener.
ARG MOSS_RUNTIME_REPOSITORY=https://github.com/jzhao0/moss.git
ARG MOSS_RUNTIME_REVISION=ef15448e166f31c891e80dba5073dae04a052a2b

RUN pnpm install --frozen-lockfile \
  && git clone "${MOSS_RUNTIME_REPOSITORY}" /opt/moss-runtime \
  && git -C /opt/moss-runtime checkout "${MOSS_RUNTIME_REVISION}" \
  && cd /opt/moss-runtime \
  && pnpm install --frozen-lockfile \
  && pnpm -r build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000
ENV MOSS_RUNTIME_PATH=/opt/moss-runtime

# Run from the API workspace so pnpm resolves its workspace-local tsx binary.
# Render injects the runtime environment directly; no .env file is required.
CMD ["pnpm", "--filter", "@parallax/api", "exec", "tsx", "src/server.ts"]
