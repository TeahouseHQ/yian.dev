# Overlay image for THIS repo (ADR-0014, #110).
#
# A thin layer over the reusable sandbox-contract base (base.Dockerfile). Everything
# generic — git, gh, the pi coding agent, the vendored skills, and the
# uid/HOME/rootless-Docker layout subtleties — lives on the base and is inherited
# here (USER root, ENV HOME=/home/agent, WORKDIR, ENTRYPOINT included). This file
# adds ONLY yian.dev's stack extras: corepack and the pinned pnpm.
#
# The base is built first as `sandcastle-base:latest` (see `pnpm sandcastle:build-base`);
# `sandcastle docker build-image` then builds this overlay as the image dispatches run.
FROM sandcastle-base:latest

# Enable pnpm (this repo is pnpm-only; package.json pins
# "packageManager": "pnpm@9.15.4"). The base node:22 image ships corepack but
# does not enable it, so without this `pnpm` is not on PATH and every
# onSandboxReady `pnpm install ...` hook fails with exit 127 (command not found).
# `corepack enable` installs the pnpm shim; `prepare --activate` pre-fetches the
# pinned version into COREPACK_HOME so runtime needs no network to resolve it.
# COREPACK_HOME is set to a fixed path (not $HOME/.cache) so the version baked in
# at build time is still found at runtime, where HOME=/home/agent (set on the base).
ENV COREPACK_HOME=/home/agent/.cache/node/corepack
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
