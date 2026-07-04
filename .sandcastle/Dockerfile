FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# Install pi coding agent
RUN npm install -g @earendil-works/pi-coding-agent

# Enable pnpm (this repo is pnpm-only; package.json pins
# "packageManager": "pnpm@9.15.4"). The base node:22 image ships corepack but
# does not enable it, so without this `pnpm` is not on PATH and every
# onSandboxReady `pnpm install ...` hook fails with exit 127 (command not found).
# `corepack enable` installs the pnpm shim; `prepare --activate` pre-fetches the
# pinned version into COREPACK_HOME so runtime needs no network to resolve it.
# COREPACK_HOME is set to a fixed path (not $HOME/.cache) so the version baked in
# at build time is still found at runtime, where HOME=/home/agent.
ENV COREPACK_HOME=/home/agent/.cache/node/corepack
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Bake glm-5.1 LiteLLM provider config into the image (issue #49).
# pi reads ~/.pi/agent/models.json at startup; containerUid: 0 means the
# container runs as root, so /home/agent/.pi/agent is owned by root and no
# chown is needed. The provider points at the host's Tailscale IP
# (100.86.127.113:4000) — see docs/adr/0002-host-access-via-tailscale-ip.md
# for why bridge -> Tailscale IP is the only working network path.
# $LITELLM_API_KEY is resolved at request time from the container env.
# COPY auto-creates /home/agent/.pi/agent, so no preceding mkdir is needed.
# NOTE: `sandcastle docker build-image` uses the .sandcastle/ directory as the
# build context (docker build <.sandcastle>), so COPY sources are relative to
# .sandcastle/ — use `models.json`, not `.sandcastle/models.json`.
COPY models.json /home/agent/.pi/agent/models.json

# Run as root. Under ROOTLESS Docker (this machine), the container's root maps
# to the host user that owns the bind-mounted worktree, so root is the ONLY
# user that can write commits into it. main.mts must pass matching
# containerUid/containerGid: 0 (sandcastle's checkImageUid asserts the runtime
# --user matches the image's USER). The AGENT_UID/GID alignment above is kept
# for ROOTFUL Docker: to use it, restore `USER ${AGENT_UID}:${AGENT_GID}` here
# and drop the containerUid/containerGid options in main.mts.
USER root

# Point $HOME at /home/agent. The container runs as root (above), whose
# default HOME is /root, but models.json (and pi's other state) live under
# /home/agent/.pi/agent. Without this, pi resolves ~/.pi/agent to
# /root/.pi/agent (missing), never loads the glm-5.1/litellm provider, and
# falls back to its default provider -> "No API key found". The bind-mounted
# worktree write path is unaffected: the process is still root.
ENV HOME=/home/agent

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
