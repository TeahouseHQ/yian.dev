# Sandbox contract BASE image (ADR-0014, #110).
#
# This layer owns the sandbox CONTRACT — git, gh, the pi coding agent, the vendored
# agent skills, and the uid/HOME/rootless-Docker layout subtleties this repo fought
# to get right — and NOTHING about any consumer repo's stack (no package-manager
# pin, no repo or machine facts). It is meant to be verbatim-reusable by a future
# second consumer repo; a repo adds its stack extras in a thin overlay Dockerfile
# built `FROM` this image.
#
# Built as `sandcastle-base:latest` by the base build step; the overlay
# (.sandcastle/Dockerfile) does `FROM sandcastle-base:latest`.
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

# NOTE: the pi LiteLLM provider config (models.json) is NO LONGER baked into this
# image (ADR-0014, #109). It is generated from the per-machine Host profile
# (~/.teahouse/host-profile.json) and bind-mounted into the container at RUNTIME at
# /home/agent/.pi/agent/models.json — the docker sandbox auto-creates that parent dir
# for the file mount. This keeps a machine's Tailscale IP out of the image, so
# changing the LiteLLM host never means rebuilding this image. pi still reads
# ~/.pi/agent/models.json at startup and resolves $LITELLM_API_KEY from container env.

# Bake Agent Skills into pi's GLOBAL skills dir (ADR-0017). pi loads
# ~/.pi/agent/skills/ unconditionally, whereas project-level skills
# (.agents/skills in the bind-mounted worktree) load only after a project is
# "trusted" — and Sandcastle runs pi headless, with no human to grant trust.
# Baking here is the only path that provably fires headless, and it mirrors the
# models.json bake above rather than an `npx skills add` at build time (which
# would pull unpinned upstream over the network). Skills are vendored under
# .sandcastle/skills/ (one dir per skill, each with a SKILL.md) and COPY'd
# wholesale; the build context is .sandcastle/, so the source path is `skills`.
# These are generic engineering skills (not repo-stack facts), so they belong on
# the reusable base, not the overlay — a second consumer repo gets them for free.
# Owned by root like the rest of .pi/agent (containerUid: 0), so no chown.
COPY skills /home/agent/.pi/agent/skills

# Run as root. Under ROOTLESS Docker (this machine), the container's root maps to
# the host user that owns the bind-mounted worktree, so root is the ONLY user that
# can write commits into it. main.mts must pass matching containerUid/containerGid:
# 0 (sandcastle's checkImageUid asserts the runtime --user matches the image's
# USER). The AGENT_UID/GID alignment above is kept for ROOTFUL Docker: to use it,
# restore `USER ${AGENT_UID}:${AGENT_GID}` here and drop the
# containerUid/containerGid options in main.mts.
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
