# Pi Control Universal profile (plan §19.2)
#
# Base + Python + common build/runtime toolchain for mixed workloads
# (compilers, ffmpeg, database client headers, etc.).
#
# Build: podman build -t pi-control/universal:local -f images/profiles/universal/Dockerfile images/profiles/universal

FROM pi-control/base:local

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libpq-dev \
    libssl-dev \
    pkg-config \
    zip \
  && rm -rf /var/lib/apt/lists/*

ENV PIP_CACHE_DIR=/cache/pip \
    VIRTUAL_ENV_DISABLE_PROMPT=1
