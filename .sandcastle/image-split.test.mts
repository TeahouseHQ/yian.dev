import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Image base/overlay split contract (ADR-0014, #110). These read the two shipped
 * Dockerfiles directly — no `docker build` — the same file-contract style as
 * `prompts.test.mts`.
 *
 * The split has one invariant per layer:
 *  - **base** (`base.Dockerfile`) owns the sandbox CONTRACT — git, gh, the pi coding
 *    agent, the vendored skills, and the uid/HOME/rootless-Docker layout subtleties —
 *    and NOTHING about this repo's stack (no package-manager pin). It must be
 *    verbatim-reusable by a future second consumer repo.
 *  - **overlay** (`Dockerfile`) is a THIN layer `FROM` the base adding only this
 *    repo's stack extras (corepack + the pinned pnpm). It must NOT re-declare any
 *    contract concern — those live once, on the base.
 *
 * Expected tokens come from the ADR-0014 spec and the pre-split Dockerfile, not from
 * re-deriving the files the way they were written, so a regression that drops a
 * contract line (or smears a repo fact into the base) fails here.
 */
const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** The base image tag the overlay must `FROM`. Fixed + repo-independent so a second
 *  consumer's overlay `FROM` line is identical — the base carries no repo name. */
const BASE_IMAGE = "sandcastle-base:latest";

const base = read("base.Dockerfile");
const overlay = read("Dockerfile");

describe("base.Dockerfile — the reusable sandbox contract (ADR-0014, #110)", () => {
  it("starts from the node base image", () => {
    expect(base).toMatch(/^FROM node:22-bookworm/m);
  });

  it("installs the contract toolchain: git, gh, and the pi coding agent", () => {
    expect(base).toMatch(/apt-get install[\s\S]*?\bgit\b/);
    expect(base).toMatch(/apt-get install -y gh\b/);
    expect(base).toContain("npm install -g @earendil-works/pi-coding-agent");
  });

  it("bakes the vendored agent skills into pi's global skills dir (ADR-0017)", () => {
    expect(base).toContain("COPY skills /home/agent/.pi/agent/skills");
  });

  it("carries the uid/HOME/rootless-Docker layout subtleties", () => {
    // uid/gid alignment build-args + the rename of the base image's `node` user.
    expect(base).toMatch(/ARG AGENT_UID/);
    expect(base).toMatch(/groupmod .* usermod/s);
    // Runs as root (rootless-Docker rationale) with HOME pointed at /home/agent.
    expect(base).toMatch(/^USER root/m);
    expect(base).toContain("ENV HOME=/home/agent");
    // The rootless-Docker rationale comment survives HERE, not on the overlay.
    expect(base).toMatch(/ROOTLESS Docker/);
    expect(base).toMatch(/^ENTRYPOINT/m);
  });

  it("carries NO repo-stack facts — no package-manager pin", () => {
    expect(base).not.toMatch(/corepack/i);
    expect(base).not.toMatch(/pnpm/i);
    expect(base).not.toMatch(/packageManager/i);
  });
});

describe("Dockerfile (overlay) — thin repo stack layer (ADR-0014, #110)", () => {
  it("builds FROM the base image, not a raw node image", () => {
    expect(overlay).toMatch(new RegExp(`^FROM ${BASE_IMAGE}`, "m"));
    expect(overlay).not.toMatch(/^FROM node:/m);
  });

  it("adds ONLY the repo's stack extras — corepack and the pinned pnpm", () => {
    expect(overlay).toContain("corepack enable");
    expect(overlay).toContain("corepack prepare pnpm@9.15.4");
    expect(overlay).toContain("COREPACK_HOME=");
  });

  it("does NOT re-declare any base contract concern (each lives once, on the base)", () => {
    // Toolchain install + skills bake belong to the base.
    expect(overlay).not.toMatch(/apt-get/);
    expect(overlay).not.toContain("pi-coding-agent");
    expect(overlay).not.toContain("COPY skills");
    // uid/HOME/rootless-Docker rationale + layout survive on the base, not here.
    expect(overlay).not.toMatch(/groupmod|usermod/);
    expect(overlay).not.toMatch(/^USER /m);
    expect(overlay).not.toMatch(/ROOTLESS Docker/);
    expect(overlay).not.toMatch(/^ENTRYPOINT/m);
  });
});
