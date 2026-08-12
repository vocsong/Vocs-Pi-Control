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

# Unprivileged runtime user (issue #4): workloads run as uid 1000 with no
# capabilities; the control server creates containers with
# --user 1000:1000 --userns keep-id, which maps this uid to the host user
# so bind-mounted workspaces stay writable under rootless Podman. The
# official node image already ships the `node` user at uid 1000 — reuse it
# (numeric ids are what matter) and keep the /home/pi volume path used by
# the control plane.
RUN mkdir -p /home/pi /state /cache /tools /workspace \
  && chown -R node:node /home/pi /state /cache /tools /workspace

ENV HOME=/home/pi

# Development PATH: workspace-local binaries first, then /tools, then system.
ENV PATH="/workspace/node_modules/.bin:/workspace/.venv/bin:/tools/bin:/tools/npm/bin:/usr/local/bin:/usr/bin:/bin"

WORKDIR /workspace

# Phase 2: the workspace agent is the container entrypoint. It authenticates
# to the control server with PI_CONTROL_AGENT_TOKEN and owns processes and
# Pi sessions. Without a token it stays idle (ad-hoc use).

# Phase 3: the real Pi coding-agent SDK (ESM, resolved at runtime via
# NODE_PATH — the agent bundle keeps it external). Pinned to the version
# validated against the control plane. node-pty powers terminals (Phase 8).
ARG PI_CODING_AGENT_VERSION=0.84.1
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/pi-control \
  && cd /opt/pi-control \
  && npm init -y > /dev/null \
  && npm install --no-audit --no-fund @earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION} node-pty 2>&1 | tail -2

ENV NODE_PATH=/opt/pi-control/node_modules

COPY agent/agent.cjs /usr/local/lib/pi-control-workspace-agent.cjs

# NOTE: no USER directive here — profile images layer apt-get steps on top.
# The unprivileged runtime user is enforced at CONTAINER CREATION via
# --user 1000:1000 --userns keep-id (buildArgs.ts, issue #4), which also
# covers ad-hoc images and the security self-test.

ENTRYPOINT ["node", "/usr/local/lib/pi-control-workspace-agent.cjs"]
CMD []
