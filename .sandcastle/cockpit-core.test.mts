import { describe, expect, it } from "vitest";

import {
  appendLogLine,
  COCKPIT_TABS,
  cycleTab,
  describeChildExit,
  formatEventLog,
  parseEventLine,
  spawnOrchestrator,
  splitNdjsonChunk,
  type OrchestratorHandlers,
} from "./cockpit-core.mts";
import type { OrchestratorEvent } from "./events.mts";

/** Build one event of a given type with a fixed timestamp for the log formatter. */
function evt(event: Omit<OrchestratorEvent, "ts">): OrchestratorEvent {
  return { ...(event as object), ts: "2026-07-04T10:00:00.000Z" } as OrchestratorEvent;
}

// ── cycleTab: the tab-switch keybind's pure model ───────────────────────────

describe("cycleTab", () => {
  it("advances to the next tab and wraps past the last", () => {
    expect(cycleTab("live", "next")).toBe("sessions");
    expect(cycleTab("sessions", "next")).toBe("maintenance");
    expect(cycleTab("maintenance", "next")).toBe("live");
  });

  it("steps to the previous tab and wraps before the first", () => {
    expect(cycleTab("maintenance", "prev")).toBe("sessions");
    expect(cycleTab("sessions", "prev")).toBe("live");
    expect(cycleTab("live", "prev")).toBe("maintenance");
  });

  it("lists the three tabs in Live → Sessions → Maintenance order", () => {
    expect(COCKPIT_TABS).toEqual(["live", "sessions", "maintenance"]);
  });
});

// ── parseEventLine: decode one NDJSON stdout line → typed event | null ───────

describe("parseEventLine", () => {
  it("parses a valid NDJSON event line into the typed event", () => {
    const line = JSON.stringify({
      type: "tick",
      free: 3,
      poolSize: 10,
      inflight: 7,
      ts: "2026-07-04T10:00:00.000Z",
    });
    expect(parseEventLine(line)).toEqual({
      type: "tick",
      free: 3,
      poolSize: 10,
      inflight: 7,
      ts: "2026-07-04T10:00:00.000Z",
    });
  });

  it("returns null for a blank line", () => {
    expect(parseEventLine("")).toBeNull();
    expect(parseEventLine("   ")).toBeNull();
  });

  it("returns null for non-JSON stray output (a stack trace, a stray log)", () => {
    expect(parseEventLine("Error: boom at foo.mts:1")).toBeNull();
    expect(parseEventLine("{ not json")).toBeNull();
  });

  it("returns null for JSON whose type is not a known orchestrator event", () => {
    expect(parseEventLine(JSON.stringify({ type: "mystery", ts: "x" }))).toBeNull();
    expect(parseEventLine(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseEventLine(JSON.stringify([1, 2, 3]))).toBeNull();
  });
});

// ── splitNdjsonChunk: buffer partial trailing lines across stdout chunks ─────

describe("splitNdjsonChunk", () => {
  it("splits complete newline-terminated lines with an empty remainder", () => {
    expect(splitNdjsonChunk("", "a\nb\nc\n")).toEqual({
      lines: ["a", "b", "c"],
      rest: "",
    });
  });

  it("buffers a chunk without a trailing newline as the remainder", () => {
    expect(splitNdjsonChunk("", "a\nb\nhalf")).toEqual({
      lines: ["a", "b"],
      rest: "half",
    });
  });

  it("completes a buffered partial line with the next chunk", () => {
    const first = splitNdjsonChunk("", '{"type":"tic');
    expect(first).toEqual({ lines: [], rest: '{"type":"tic' });
    const second = splitNdjsonChunk(first.rest, 'k"}\n');
    expect(second).toEqual({ lines: ['{"type":"tick"}'], rest: "" });
  });
});

// ── formatEventLog: one event → one compact scrolling-log line ───────────────

describe("formatEventLog", () => {
  it("renders a Poll tick as a compact capacity line", () => {
    expect(formatEventLog(evt({ type: "tick", free: 3, poolSize: 10, inflight: 7 }))).toBe(
      "tick · 3/10 free · 7 in-flight"
    );
  });

  it("renders a SUCCESSFUL session resolution (which prose suppresses)", () => {
    expect(
      formatEventLog(
        evt({
          type: "session-resolved",
          role: "implementer",
          issue: 12,
          branch: "sandcastle/issue-12",
          status: "ok",
          commits: 2,
          error: null,
        })
      )
    ).toBe("✓ impl #12 resolved · 2 commits");
  });

  it("renders a FAILED session resolution with its error", () => {
    expect(
      formatEventLog(
        evt({
          type: "session-resolved",
          role: "reviewer",
          issue: 44,
          branch: "sandcastle/issue-44",
          status: "failed",
          commits: 0,
          error: "boom",
        })
      )
    ).toBe("✗ rev #44 failed · boom");
  });

  it("renders an Implementer dispatch with the issue title and branch", () => {
    expect(
      formatEventLog(
        evt({
          type: "dispatch",
          role: "implementer",
          issue: 12,
          branch: "sandcastle/issue-12",
          pr: null,
          title: "Add the widget",
        })
      )
    ).toBe("▶ dispatch impl #12: Add the widget");
  });

  it("renders a Reviewer/Merger dispatch with the PR and issue", () => {
    expect(
      formatEventLog(
        evt({
          type: "dispatch",
          role: "merger",
          issue: 44,
          branch: "sandcastle/issue-44",
          pr: 90,
          title: null,
        })
      )
    ).toBe("▶ dispatch merger PR #90 (#44)");
  });

  it("renders the remaining informational and warning events", () => {
    expect(formatEventLog(evt({ type: "pool-full" }))).toBe("pool full · gh query skipped");
    expect(
      formatEventLog(evt({ type: "buckets", merge: 1, review: 2, agent: 5, actionable: 3 }))
    ).toBe("buckets · merge 1 · review 2 · agent 5 (3 actionable)");
    expect(formatEventLog(evt({ type: "planner-emitted", count: 3 }))).toBe(
      "planner emitted 3 issue(s)"
    );
    expect(formatEventLog(evt({ type: "planner-skipped" }))).toBe("planner skipped");
    expect(formatEventLog(evt({ type: "planner-no-plan" }))).toBe("planner produced no plan");
    expect(formatEventLog(evt({ type: "planner-failed", error: "opus down" }))).toBe(
      "⚠ planner failed · opus down"
    );
    expect(formatEventLog(evt({ type: "noop-escalated", issue: 12 }))).toBe(
      "⚠ #12 no commits · escalated to ready-for-human"
    );
    expect(
      formatEventLog(evt({ type: "gh-error", args: ["issue", "list"], error: "rate limited" }))
    ).toBe("⚠ gh issue list failed · rate limited");
  });
});

// ── appendLogLine: bounded ring buffer for the scrolling log ─────────────────

describe("appendLogLine", () => {
  it("appends a line while under the cap", () => {
    expect(appendLogLine(["a", "b"], "c", 5)).toEqual(["a", "b", "c"]);
  });

  it("drops the oldest lines once the cap is exceeded, keeping the last N", () => {
    expect(appendLogLine(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b"];
    appendLogLine(input, "c", 5);
    expect(input).toEqual(["a", "b"]);
  });
});

// ── describeChildExit: clean Stop vs crash to surface ────────────────────────

describe("describeChildExit", () => {
  it("classifies a user-initiated Stop (SIGTERM) as stopped, not a crash", () => {
    expect(describeChildExit({ code: null, signal: "SIGTERM", stoppedByUser: true })).toEqual({
      status: "stopped",
      message: "orchestrator stopped",
    });
  });

  it("classifies a non-zero exit that the user did not request as a crash", () => {
    expect(describeChildExit({ code: 1, signal: null, stoppedByUser: false })).toEqual({
      status: "crashed",
      message: "orchestrator crashed (exit code 1)",
    });
  });

  it("classifies a kill by an unexpected signal as a crash", () => {
    expect(describeChildExit({ code: null, signal: "SIGSEGV", stoppedByUser: false })).toEqual({
      status: "crashed",
      message: "orchestrator crashed (signal SIGSEGV)",
    });
  });

  it("classifies a clean exit(0) the user did not request as stopped", () => {
    expect(describeChildExit({ code: 0, signal: null, stoppedByUser: false })).toEqual({
      status: "stopped",
      message: "orchestrator exited",
    });
  });
});

// ── spawnOrchestrator: the supervised-child pipeline, end-to-end ─────────────
//
// Spawns a REAL child (a `node -e` fake orchestrator) so the whole seam is
// exercised: process spawn, chunked stdout → NDJSON decode → typed events,
// stderr line delivery, and exit classification. No Docker/gh/agents involved.

/** Collect everything a supervised child produces, resolving once it exits. */
function runFakeOrchestrator(
  script: string,
  drive?: (sup: { stop(): void }) => void
): Promise<{
  events: OrchestratorEvent[];
  stdoutRaw: string[];
  stderr: string[];
  exit: { status: string; message: string } | null;
  spawnError: string | null;
}> {
  return new Promise((resolve) => {
    const events: OrchestratorEvent[] = [];
    const stdoutRaw: string[] = [];
    const stderr: string[] = [];
    let exit: { status: string; message: string } | null = null;
    let spawnError: string | null = null;
    const handlers: OrchestratorHandlers = {
      onEvent: (e) => events.push(e),
      onStdoutRaw: (l) => stdoutRaw.push(l),
      onStderr: (l) => stderr.push(l),
      onExit: (status, message) => {
        exit = { status, message };
        resolve({ events, stdoutRaw, stderr, exit, spawnError });
      },
      onSpawnError: (message) => {
        spawnError = message;
        resolve({ events, stdoutRaw, stderr, exit, spawnError });
      },
    };
    const sup = spawnOrchestrator({ command: process.execPath, args: ["-e", script] }, handlers);
    if (drive) drive(sup);
  });
}

describe("spawnOrchestrator", () => {
  it("decodes a child's NDJSON stdout into typed events and classifies clean exit", async () => {
    // The fake writes two events across an AWKWARD chunk boundary (a split mid-
    // JSON) to prove the cross-chunk line reassembly holds through a real pipe.
    const script = `
      const tick = JSON.stringify({type:"tick",free:1,poolSize:10,inflight:0,ts:"2026-07-04T10:00:00.000Z"});
      const done = JSON.stringify({type:"session-resolved",role:"implementer",issue:7,branch:"sandcastle/issue-7",status:"ok",commits:2,error:null,ts:"2026-07-04T10:00:01.000Z"});
      const all = tick + "\\n" + done + "\\n";
      process.stdout.write(all.slice(0, 20));
      setTimeout(() => process.stdout.write(all.slice(20)), 15);
    `;
    const result = await runFakeOrchestrator(script);
    expect(result.events.map((e) => e.type)).toEqual(["tick", "session-resolved"]);
    expect(result.events[1]).toMatchObject({ type: "session-resolved", issue: 7, commits: 2 });
    expect(result.spawnError).toBeNull();
    expect(result.exit).toEqual({ status: "stopped", message: "orchestrator exited" });
  });

  it("delivers stderr lines (the agent sub-feed) separately from events", async () => {
    const script = `
      process.stderr.write("impl #7 · toolCall bash\\n");
      process.stdout.write(JSON.stringify({type:"pool-full",ts:"2026-07-04T10:00:00.000Z"}) + "\\n");
    `;
    const result = await runFakeOrchestrator(script);
    expect(result.stderr).toContain("impl #7 · toolCall bash");
    expect(result.events.map((e) => e.type)).toEqual(["pool-full"]);
  });

  it("surfaces a Stop as a clean stopped exit, not a crash", async () => {
    // A child that would run forever; the supervisor Stops it after it is alive.
    const script = `setInterval(() => {}, 1000); process.stdout.write("ready\\n");`;
    const result = await runFakeOrchestrator(script, (sup) => {
      setTimeout(() => sup.stop(), 50);
    });
    expect(result.exit).toEqual({ status: "stopped", message: "orchestrator stopped" });
  });

  it("reports a spawn failure (command not found) without throwing", async () => {
    const events: OrchestratorEvent[] = [];
    const spawnError = await new Promise<string | null>((resolve) => {
      spawnOrchestrator(
        { command: "definitely-not-a-real-binary-xyz", args: [] },
        {
          onEvent: (e) => events.push(e),
          onStdoutRaw: () => {},
          onStderr: () => {},
          onExit: () => resolve(null),
          onSpawnError: (message) => resolve(message),
        }
      );
    });
    expect(spawnError).toMatch(/ENOENT|not.*found|spawn/i);
  });
});
