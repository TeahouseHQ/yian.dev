import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent, IterationResult } from "@ai-hero/sandcastle";

import {
  appendManifestLine,
  buildFailedManifestEntry,
  buildManifestEntry,
  formatLifecycleLine,
  formatStreamLine,
  generateRunId,
  isVerbose,
  lastSession,
  lifecycle,
  logPath,
  manifestPath,
  observe,
  sessionsDir,
  type RunLike,
} from "./observability.mts";

const toolCall = (
  overrides: Partial<Extract<AgentStreamEvent, { type: "toolCall" }>> = {}
): AgentStreamEvent => ({
  type: "toolCall",
  name: "Bash",
  formattedArgs: "pnpm test",
  iteration: 1,
  timestamp: new Date("2026-06-28T12:00:00Z"),
  ...overrides,
});

const text = (message: string): AgentStreamEvent => ({
  type: "text",
  message,
  iteration: 1,
  timestamp: new Date("2026-06-28T12:00:00Z"),
});

const raw = (line: string): AgentStreamEvent => ({
  type: "raw",
  line,
  iteration: 1,
  timestamp: new Date("2026-06-28T12:00:00Z"),
});

describe("formatStreamLine", () => {
  it("formats a toolCall as a prefixed single line", () => {
    expect(formatStreamLine("impl #44", toolCall(), false)).toBe("[impl #44] ▶ Bash(pnpm test)");
  });

  it("collapses multi-line toolCall args to the first line", () => {
    expect(
      formatStreamLine("impl #44", toolCall({ formattedArgs: "pnpm test\n--silent" }), false)
    ).toBe("[impl #44] ▶ Bash(pnpm test)");
  });

  it("suppresses text events unless verbose", () => {
    expect(formatStreamLine("planner", text("thinking..."), false)).toBeNull();
    expect(formatStreamLine("planner", text("thinking..."), true)).toBe("[planner] » thinking...");
  });

  it("suppresses raw events unless verbose", () => {
    expect(formatStreamLine("planner", raw('{"type":"tool_use"}'), false)).toBeNull();
    expect(formatStreamLine("planner", raw('{"type":"tool_use"}'), true)).toBe(
      '[planner] # {"type":"tool_use"}'
    );
  });

  it("always emits toolCall regardless of verbose", () => {
    expect(formatStreamLine("merger", toolCall(), true)).toBe("[merger] ▶ Bash(pnpm test)");
  });
});

describe("formatLifecycleLine", () => {
  it("formats agent start/stop markers", () => {
    expect(formatLifecycleLine("planner", "start")).toBe("[planner] ● start");
    expect(formatLifecycleLine("planner", "done")).toBe("[planner] ● done");
  });

  it("formats a sandbox-ready marker", () => {
    expect(formatLifecycleLine("impl #44", "sandbox")).toBe("[impl #44] ● sandbox ready");
  });

  it("pluralizes the commit count", () => {
    expect(formatLifecycleLine("impl #44", "commits", 0)).toBe("[impl #44] ✓ 0 commits");
    expect(formatLifecycleLine("impl #44", "commits", 1)).toBe("[impl #44] ✓ 1 commit");
    expect(formatLifecycleLine("impl #44", "commits", 3)).toBe("[impl #44] ✓ 3 commits");
  });
});

describe("isVerbose", () => {
  afterEach(() => {
    delete process.env.SANDCASTLE_VERBOSE;
  });

  it("is off by default and only flips on for SANDCASTLE_VERBOSE=1", () => {
    expect(isVerbose()).toBe(false);
    process.env.SANDCASTLE_VERBOSE = "0";
    expect(isVerbose()).toBe(false);
    process.env.SANDCASTLE_VERBOSE = "true";
    expect(isVerbose()).toBe(false);
    process.env.SANDCASTLE_VERBOSE = "1";
    expect(isVerbose()).toBe(true);
  });
});

describe("logPath", () => {
  it("writes a deterministic .log file under .sandcastle/logs, slug-stamped by label", () => {
    const path = logPath("impl #44", new Date("2026-06-28T12:00:00.123Z"));
    expect(path).toMatch(/[\\/]\.sandcastle[\\/]logs[\\/]20260628120000123-impl-44\.log$/);
  });

  it("falls back to an 'agent' slug for labels with no alphanumerics", () => {
    const path = logPath("## !!", new Date("2026-06-28T12:00:00.000Z"));
    expect(path).toMatch(/[\\/]\.sandcastle[\\/]logs[\\/]20260628120000000-agent\.log$/);
  });
});

describe("observe", () => {
  afterEach(() => {
    delete process.env.SANDCASTLE_VERBOSE;
  });

  it("returns a file-mode logging config with an onAgentStreamEvent handler", () => {
    const cfg = observe("planner");
    expect(cfg.type).toBe("file");
    expect(typeof cfg.onAgentStreamEvent).toBe("function");
    expect(cfg.path).toMatch(/[\\/]\.sandcastle[\\/]logs[\\/].*\.log$/);
  });

  it("threads SANDCASTLE_VERBOSE into both verbose and the handler", () => {
    process.env.SANDCASTLE_VERBOSE = "1";
    const cfg = observe("planner");
    expect(cfg.verbose).toBe(true);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // verbose => text now prints
    cfg.onAgentStreamEvent(text("hi"));
    expect(log).toHaveBeenCalledWith("[planner] » hi");
    log.mockRestore();
  });

  it("prints a prefixed toolCall line and suppresses text by default", () => {
    const cfg = observe("impl #44");
    expect(cfg.verbose).toBe(false);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    cfg.onAgentStreamEvent(toolCall());
    cfg.onAgentStreamEvent(text("ignored"));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[impl #44] ▶ Bash(pnpm test)");
    log.mockRestore();
  });
});

describe("lifecycle", () => {
  it("prints the formatted marker line for each kind", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const lc = lifecycle("impl #44");
    lc.start();
    lc.sandbox();
    lc.commits(2);
    lc.done();
    expect(log).toHaveBeenNthCalledWith(1, "[impl #44] ● start");
    expect(log).toHaveBeenNthCalledWith(2, "[impl #44] ● sandbox ready");
    expect(log).toHaveBeenNthCalledWith(3, "[impl #44] ✓ 2 commits");
    expect(log).toHaveBeenNthCalledWith(4, "[impl #44] ● done");
    log.mockRestore();
  });
});

// ---- Manifest (issue #53) ------------------------------------------------

const iteration = (overrides: Partial<IterationResult> = {}): IterationResult => ({
  sessionId: "sess-abc",
  sessionFilePath: "/repo/.sandcastle/sessions/--repo--/1700000000000_sess-abc.jsonl",
  usage: {
    inputTokens: 10,
    cacheCreationInputTokens: 1,
    cacheReadInputTokens: 2,
    outputTokens: 5,
  },
  ...overrides,
});

const okResult = (overrides: Partial<RunLike> = {}): RunLike => ({
  iterations: [iteration()],
  commits: [{ sha: "a" }, { sha: "b" }],
  ...overrides,
});

describe("generateRunId", () => {
  it("derives a deterministic run-issue-<n> id from an issue number", () => {
    expect(generateRunId(42)).toBe("run-issue-42");
    expect(generateRunId(1)).toBe("run-issue-1");
  });

  it("is stable for the same issue number regardless of when it is called", () => {
    // A Run spans an issue's whole lifecycle (impl → review → merge), so the id
    // must not depend on the moment each Session is recorded.
    expect(generateRunId(7, new Date("2026-06-28T12:00:00.000Z"))).toBe(
      generateRunId(7, new Date("2030-01-01T00:00:00.000Z"))
    );
    expect(generateRunId(7, new Date("2026-06-28T12:00:00.000Z"))).toBe("run-issue-7");
  });

  it("yields distinct ids for distinct issue numbers", () => {
    expect(generateRunId(1)).not.toBe(generateRunId(2));
    expect(generateRunId(1)).toBe("run-issue-1");
    expect(generateRunId(2)).toBe("run-issue-2");
  });

  it("ignores `now` entirely when an issue number is given", () => {
    // The deterministic path must not bleed the timestamp in even if a Date is passed.
    expect(generateRunId(99, new Date("2026-06-28T12:00:00.123Z"))).toBe("run-issue-99");
  });

  it("falls back to a per-invocation millisecond stamp when no issue is given", () => {
    // Explicit undefined — the cross-issue Planner Session's id (no issue to bind to).
    expect(generateRunId(undefined, new Date("2026-06-28T12:00:00.123Z"))).toBe(
      "run-20260628120000123"
    );
    // No-arg form also stamps and never looks like an issue id.
    expect(generateRunId().startsWith("run-")).toBe(true);
    expect(generateRunId()).not.toMatch(/^run-issue-/);
  });

  it("produces unique per-invocation ids across distinct millisecond stamps", () => {
    const a = generateRunId(undefined, new Date("2026-06-28T12:00:00.000Z"));
    const b = generateRunId(undefined, new Date("2026-06-28T12:00:00.001Z"));
    expect(a).not.toBe(b);
  });
});

describe("sessions + manifest paths", () => {
  it("points sessions dir and manifest under .sandcastle/sessions", () => {
    expect(sessionsDir).toMatch(/[\\/]\.sandcastle[\\/]sessions$/);
    expect(manifestPath).toBe(join(sessionsDir, "manifest.jsonl"));
  });
});

describe("lastSession", () => {
  it("returns the last iteration that has session data", () => {
    const result = okResult({
      iterations: [
        iteration({ sessionId: "old", sessionFilePath: "/old" }),
        iteration({ sessionId: "new", sessionFilePath: "/new" }),
      ],
    });
    expect(lastSession(result)).toEqual({
      sessionId: "new",
      sessionFile: "/new",
      usage: result.iterations[1].usage,
    });
  });

  it("skips trailing iterations without a session and uses an earlier one", () => {
    const result = okResult({
      iterations: [
        iteration({ sessionId: "real", sessionFilePath: "/real" }),
        iteration({ sessionId: undefined, sessionFilePath: undefined }),
      ],
    });
    expect(lastSession(result).sessionId).toBe("real");
    expect(lastSession(result).sessionFile).toBe("/real");
  });

  it("returns empty when no iteration captured a session", () => {
    const result = okResult({
      iterations: [iteration({ sessionId: undefined, sessionFilePath: undefined })],
    });
    expect(lastSession(result)).toEqual({});
  });
});

describe("buildManifestEntry", () => {
  it("builds the full field set from a successful run", () => {
    const startedAt = new Date("2026-06-28T12:00:00.000Z");
    const endedAt = new Date("2026-06-28T12:05:00.000Z");
    const result = okResult();
    const entry = buildManifestEntry({
      runId: "run-x",
      phase: "impl",
      issue: 53,
      branch: "sandcastle/issue-53",
      result,
      startedAt,
      endedAt,
    });
    expect(entry).toEqual({
      runId: "run-x",
      phase: "impl",
      issue: 53,
      branch: "sandcastle/issue-53",
      sessionId: "sess-abc",
      sessionFile: result.iterations[0].sessionFilePath,
      commits: 2,
      usage: result.iterations[0].usage,
      startedAt: "2026-06-28T12:00:00.000Z",
      endedAt: "2026-06-28T12:05:00.000Z",
      status: "ok",
    });
  });

  it("nulls missing session fields, nulls issue/branch by default, counts zero commits", () => {
    const result = okResult({
      iterations: [{ sessionId: undefined, sessionFilePath: undefined, usage: undefined }],
      commits: [],
    });
    const entry = buildManifestEntry({
      runId: "run-x",
      phase: "planner",
      result,
      startedAt: new Date(0),
      endedAt: new Date(0),
    });
    expect(entry.sessionId).toBeNull();
    expect(entry.sessionFile).toBeNull();
    expect(entry.usage).toBeNull();
    expect(entry.commits).toBe(0);
    expect(entry.issue).toBeNull();
    expect(entry.branch).toBeNull();
    expect(entry.status).toBe("ok");
  });
});

describe("buildFailedManifestEntry", () => {
  it("writes status failed with error message and no transcript guessing", () => {
    const entry = buildFailedManifestEntry({
      runId: "run-x",
      phase: "impl",
      issue: 53,
      branch: "b",
      error: new Error("boom"),
      startedAt: new Date("2026-06-28T12:00:00.000Z"),
      endedAt: new Date("2026-06-28T12:01:00.000Z"),
    });
    expect(entry).toEqual({
      runId: "run-x",
      phase: "impl",
      issue: 53,
      branch: "b",
      sessionId: null,
      sessionFile: null,
      commits: 0,
      usage: null,
      startedAt: "2026-06-28T12:00:00.000Z",
      endedAt: "2026-06-28T12:01:00.000Z",
      status: "failed",
      error: "boom",
    });
  });

  it("stringifies non-Error throwables", () => {
    const entry = buildFailedManifestEntry({
      runId: "r",
      phase: "rev",
      error: "oops",
      startedAt: new Date(0),
      endedAt: new Date(0),
    });
    expect(entry.error).toBe("oops");
    expect(entry.status).toBe("failed");
  });
});

describe("appendManifestLine", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("appends one JSON line per entry and creates the dir + file", async () => {
    dir = await mkdtemp(join(tmpdir(), "manifest-"));
    const path = join(dir, "nested", "manifest.jsonl");
    await appendManifestLine(
      buildFailedManifestEntry({
        runId: "r",
        phase: "rev",
        error: "x",
        startedAt: new Date(0),
        endedAt: new Date(0),
      }),
      path
    );
    await appendManifestLine(
      buildFailedManifestEntry({
        runId: "r",
        phase: "impl",
        error: "y",
        startedAt: new Date(0),
        endedAt: new Date(0),
      }),
      path
    );
    const contents = await readFile(path, "utf8");
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).phase).toBe("rev");
    expect(JSON.parse(lines[1]).phase).toBe("impl");
  });

  it("never throws on a write failure (observability must not break the run)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // An unwritable path (a file used as a directory) forces the mkdir to fail.
    await expect(
      appendManifestLine(
        buildFailedManifestEntry({
          runId: "r",
          phase: "rev",
          error: "x",
          startedAt: new Date(0),
          endedAt: new Date(0),
        }),
        "/proc/1/manifest.jsonl"
      )
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
