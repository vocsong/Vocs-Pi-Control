# Pi Control base image (plan §19.1)
#
# Minimal development base: Node LTS runtime, Git, common shell tools,
# CA certificates. Environment profiles (node/python/universal) layer on
# top of this. No host secrets ever enter this image.
#
# Build:  podman build -t pi-control/base:local -f images/base/Dockerfile images/base

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    openssh-client \
    procps \
    file \
    unzip \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

# Sandbox-scoped Pi configuration (verify against upstream Pi env names).
ENV PI_CODING_AGENT_DIR=/state/pi-agent \
    PI_CODING_AGENT_SESSION_DIR=/state/pi-sessions \
    NPM_CONFIG_PREFIX=/tools/npm \
    NPM_CONFIG_CACHE=/cache/npm \
    PIP_CACHE_DIR=/cache/pip

# Development PATH: workspace-local binaries first, then /tools, then system.
ENV PATH="/workspace/node_modules/.bin:/workspace/.venv/bin:/tools/bin:/tools/npm/bin:/usr/local/bin:/usr/bin:/bin"

WORKDIR /workspace

# Phase 2: COPY the pi-control-workspace-agent into the image and define its
# entrypoint here.
CMD ["sleep", "infinity"]
