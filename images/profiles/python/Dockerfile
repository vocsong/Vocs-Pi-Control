# Pi Control Python profile (plan §19.2)
#
# Base (Node 22 + Git + workspace agent) + Python toolchain. Python
# environments belong in workspace .venv dirs; PIP caches to /cache/pip.
#
# Build: podman build -t pi-control/python:local -f images/profiles/python/Dockerfile images/profiles/python

FROM pi-control/base:local

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

ENV PIP_CACHE_DIR=/cache/pip \
    VIRTUAL_ENV_DISABLE_PROMPT=1
