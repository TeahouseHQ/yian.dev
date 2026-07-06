import { describe, expect, it, vi } from "vitest";

import {
  createEvents,
  EVENT_TYPES,
  eventSeverity,
  eventStream,
  formatEventNdjson,
  formatEventProse,
  isKnownEventType,
  resolveEventFormat,
  type OrchestratorEvent,
} from "./events.mts";

/**
 * `Omit` over a discriminated union collapses to only the members' common keys
 * (here just `type`), which rejects every per-variant field. Distribute the
 * `Omit` across each member so an event minus `ts` keeps its full shape.
 */
type EventWithoutTs = OrchestratorEvent extends infer E
  ? E extends OrchestratorEvent
    ? Omit<E, "ts">
    : never
  : never;

/**
 * Build a single event of a given type with a fixed timestamp, so the pure
 * formatters are exercised against stable inputs (the prose formatters ignore
 * `ts`; the NDJSON formatter includes it).
 */
function evt(event: EventWithoutTs, ts = "2026-07-04T10:00:00.000Z"): OrchestratorEvent {
  return { ...(event as object), ts } as OrchestratorEvent;
}

// ── formatEventProse: one event → today's exact headless line ───────────────

describe("formatEventProse", () => {
  it("reproduces the Poll-tick header (leading + trailing blank line)", () => {
    const line = formatEventProse(evt({ type: "tick", free: 3, poolSize: 10, inflight: 7 }));
    expect(line).toBe("\n=== Poll tick — 3/10 Pool slots free, 7 in-flight ===\n");
  });

  it("reproduces the pool-full skip line", () => {
    expect(formatEventProse(evt({ type: "pool-full" }))).toBe(
      "Pool full — skipping gh query this tick."
    );
  });

  it("reproduces the buckets counts line", () => {
    expect(
      formatEventProse(evt({ type: "buckets", merge: 1, review: 2, agent: 5, actionable: 3 }))
    ).toBe("buckets: ready-for-merge 1, ready-for-review 2, ready-for-agent 5 (3 actionable).");
  });

  it("reproduces the Merger dispatch line (pr + issue + branch)", () => {
    expect(
      formatEventProse(
        evt({
          type: "dispatch",
          role: "merger",
          issue: 44,
          branch: "sandcastle/issue-44",
          pr: 90,
          title: null,
        })
      )
    ).toBe("  → dispatching Merger for PR #90 (issue #44) → sandcastle/issue-44");
  });

  it("reproduces the Reviewer dispatch line", () => {
    expect(
      formatEventProse(
        evt({
          type: "dispatch",
          role: "reviewer",
          issue: 44,
          branch: "sandcastle/issue-44",
          pr: 90,
          title: null,
        })
      )
    ).toBe("  → dispatching Reviewer for PR #90 (issue #44) → sandcastle/issue-44");
  });

  it("reproduces the Implementer dispatch line (title, no pr)", () => {
    expect(
      formatEventProse(
        evt({
          type: "dispatch",
          role: "implementer",
          issue: 44,
          branch: "sandcastle/issue-44",
          pr: null,
          title: "Fix the thing",
        })
      )
    ).toBe("  → dispatching Implementer for #44: Fix the thing → sandcastle/issue-44");
  });

  it("reproduces the Planner-emitted count line", () => {
    expect(formatEventProse(evt({ type: "planner-emitted", count: 2 }))).toBe(
      "Planner emitted 2 unblocked issue(s)."
    );
  });

  it("reproduces the Planner-skipped line", () => {
    expect(formatEventProse(evt({ type: "planner-skipped" }))).toBe(
      "No actionable ready-for-agent issues, or no free slot after merge+review draining — skipping Planner this tick."
    );
  });

  it("reproduces the plan-reused (cache hit) line", () => {
    expect(formatEventProse(evt({ type: "plan-reused", count: 3 }))).toBe(
      "Plan cache hit — reusing 3 emitted issue(s), no Planner call this tick."
    );
  });

  it("reproduces the no-<plan> tag line", () => {
    expect(formatEventProse(evt({ type: "planner-no-plan" }))).toBe(
      "Planner did not produce a <plan> tag."
    );
  });

  it("reproduces the Planner-failed line", () => {
    expect(formatEventProse(evt({ type: "planner-failed", error: "boom" }))).toBe(
      "Planner failed: boom"
    );
  });

  it("reproduces the no-op Implementer escalation line", () => {
    expect(formatEventProse(evt({ type: "noop-escalated", issue: 44 }))).toBe(
      "  ⚠ #44 produced no commits — escalated to ready-for-human."
    );
  });

  it("reproduces the gh-query failure line", () => {
    expect(
      formatEventProse(
        evt({ type: "gh-error", args: ["pr", "list", "--state", "open"], error: "nope" })
      )
    ).toBe("  ⚠ gh pr list --state open failed: nope");
  });

  it("renders nothing for a successful session-resolved (headless prose unchanged)", () => {
    expect(
      formatEventProse(
        evt({
          type: "session-resolved",
          role: "implementer",
          issue: 44,
          branch: "sandcastle/issue-44",
          status: "ok",
          commits: 3,
          error: null,
        })
      )
    ).toBeNull();
    expect(
      formatEventProse(
        evt({
          type: "session-resolved",
          role: "reviewer",
          issue: 44,
          branch: "b",
          status: "ok",
          commits: 0,
          error: null,
        })
      )
    ).toBeNull();
  });

  it("reproduces each role's failed-resolution line", () => {
    expect(
      formatEventProse(
        evt({
          type: "session-resolved",
          role: "implementer",
          issue: 44,
          branch: "sandcastle/issue-44",
          status: "failed",
          commits: 0,
          error: "kaboom",
        })
      )
    ).toBe("  ✗ #44 (sandcastle/issue-44) failed: kaboom");
    expect(
      formatEventProse(
        evt({
          type: "session-resolved",
          role: "reviewer",
          issue: 44,
          branch: "sandcastle/issue-44",
          status: "failed",
          commits: 0,
          error: "kaboom",
        })
      )
    ).toBe("  ✗ rev #44 (sandcastle/issue-44) failed: kaboom");
    expect(
      formatEventProse(
        evt({
          type: "session-resolved",
          role: "merger",
          issue: 44,
          branch: "sandcastle/issue-44",
          status: "failed",
          commits: 0,
          error: "kaboom",
        })
      )
    ).toBe("  ✗ merger #44 (sandcastle/issue-44) failed: kaboom");
  });

  it("renders a line for every non-silent event type (no event maps to undefined)", () => {
    const samples: EventWithoutTs[] = [
      { type: "tick", free: 0, poolSize: 10, inflight: 0 },
      { type: "pool-full" },
      { type: "buckets", merge: 0, review: 0, agent: 0, actionable: 0 },
      {
        type: "dispatch",
        role: "implementer",
        issue: 1,
        branch: "b",
        pr: null,
        title: "t",
      },
      { type: "planner-emitted", count: 0 },
      { type: "plan-reused", count: 0 },
      { type: "planner-skipped" },
      { type: "planner-no-plan" },
      { type: "planner-failed", error: "x" },
      { type: "noop-escalated", issue: 1 },
      { type: "gh-error", args: ["a"], error: "x" },
    ];
    for (const s of samples) {
      expect(formatEventProse(evt(s))).toBeTypeOf("string");
    }
  });
});

// ── eventStream: prose mode routes errors to stderr, rest to stdout ─────────

describe("eventStream", () => {
  it("routes the orchestrator progress events to stdout", () => {
    expect(eventStream(evt({ type: "tick", free: 1, poolSize: 10, inflight: 0 }))).toBe("stdout");
    expect(eventStream(evt({ type: "pool-full" }))).toBe("stdout");
    expect(
      eventStream(evt({ type: "buckets", merge: 0, review: 0, agent: 0, actionable: 0 }))
    ).toBe("stdout");
    expect(
      eventStream(
        evt({ type: "dispatch", role: "merger", issue: 1, branch: "b", pr: 2, title: null })
      )
    ).toBe("stdout");
    expect(eventStream(evt({ type: "planner-emitted", count: 1 }))).toBe("stdout");
    expect(eventStream(evt({ type: "planner-skipped" }))).toBe("stdout");
    expect(eventStream(evt({ type: "noop-escalated", issue: 1 }))).toBe("stdout");
  });

  it("routes the error-shaped events to stderr", () => {
    expect(eventStream(evt({ type: "gh-error", args: ["a"], error: "x" }))).toBe("stderr");
    expect(eventStream(evt({ type: "planner-no-plan" }))).toBe("stderr");
    expect(eventStream(evt({ type: "planner-failed", error: "x" }))).toBe("stderr");
  });

  it("routes a failed session-resolved to stderr but a successful one to stdout", () => {
    const failed = evt({
      type: "session-resolved",
      role: "reviewer",
      issue: 1,
      branch: "b",
      status: "failed",
      commits: 0,
      error: "x",
    });
    const ok = evt({
      type: "session-resolved",
      role: "reviewer",
      issue: 1,
      branch: "b",
      status: "ok",
      commits: 0,
      error: null,
    });
    expect(eventStream(failed)).toBe("stderr");
    expect(eventStream(ok)).toBe("stdout");
  });
});

// ── formatEventNdjson: one JSON object per line, type + ts included ─────────

describe("formatEventNdjson", () => {
  it("emits the whole event as one JSON object on a single line", () => {
    const event = evt({ type: "pool-full" });
    const line = formatEventNdjson(event);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ type: "pool-full", ts: "2026-07-04T10:00:00.000Z" });
  });

  it("keeps the discriminator type + full payload for every event", () => {
    const cases: OrchestratorEvent[] = [
      evt({ type: "tick", free: 2, poolSize: 10, inflight: 8 }),
      evt({ type: "buckets", merge: 1, review: 2, agent: 3, actionable: 4 }),
      evt({
        type: "dispatch",
        role: "implementer",
        issue: 7,
        branch: "b",
        pr: null,
        title: "t",
      }),
      evt({
        type: "session-resolved",
        role: "merger",
        issue: 7,
        branch: "b",
        status: "ok",
        commits: 5,
        error: null,
      }),
      evt({ type: "gh-error", args: ["pr", "list"], error: "nope" }),
    ];
    for (const c of cases) {
      const obj = JSON.parse(formatEventNdjson(c)) as Record<string, unknown>;
      expect(obj.type).toBe(c.type);
      expect(obj.ts).toBe("2026-07-04T10:00:00.000Z");
    }
  });
});

// ── resolveEventFormat: env → prose | ndjson ────────────────────────────────

describe("resolveEventFormat", () => {
  it("defaults to prose when the env var is absent or unrecognized", () => {
    expect(resolveEventFormat({})).toBe("prose");
    expect(resolveEventFormat({ SANDCASTLE_EVENT_FORMAT: undefined })).toBe("prose");
    expect(resolveEventFormat({ SANDCASTLE_EVENT_FORMAT: "true" })).toBe("prose");
    expect(resolveEventFormat({ SANDCASTLE_EVENT_FORMAT: "1" })).toBe("prose");
    expect(resolveEventFormat({ SANDCASTLE_EVENT_FORMAT: "json" })).toBe("prose");
  });

  it("flips to ndjson only for SANDCASTLE_EVENT_FORMAT=ndjson", () => {
    expect(resolveEventFormat({ SANDCASTLE_EVENT_FORMAT: "ndjson" })).toBe("ndjson");
  });
});

// ── createEvents: one emitter, two renderers ────────────────────────────────

describe("createEvents", () => {
  it("in prose mode writes progress lines to `out` and error lines to `err`", () => {
    const out = vi.fn();
    const err = vi.fn();
    const events = createEvents({
      format: "prose",
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      out,
      err,
    });

    events.tick(3, 10, 7);
    events.buckets(1, 2, 5, 3);
    events.dispatchMerger(90, 44, "sandcastle/issue-44");
    events.plannerFailed("boom");
    events.ghError(["pr", "list"], "nope");

    expect(out).toHaveBeenCalledTimes(3);
    expect(out).toHaveBeenNthCalledWith(
      1,
      "\n=== Poll tick — 3/10 Pool slots free, 7 in-flight ===\n"
    );
    expect(out).toHaveBeenNthCalledWith(
      2,
      "buckets: ready-for-merge 1, ready-for-review 2, ready-for-agent 5 (3 actionable)."
    );
    expect(out).toHaveBeenNthCalledWith(
      3,
      "  → dispatching Merger for PR #90 (issue #44) → sandcastle/issue-44"
    );
    expect(err).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenNthCalledWith(1, "Planner failed: boom");
    expect(err).toHaveBeenNthCalledWith(2, "  ⚠ gh pr list failed: nope");
  });

  it("in prose mode does not write anything for a successful session-resolved", () => {
    const out = vi.fn();
    const err = vi.fn();
    const events = createEvents({ format: "prose", out, err });
    events.sessionResolved({
      role: "implementer",
      issue: 1,
      branch: "b",
      status: "ok",
      commits: 2,
    });
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it("in prose mode writes each role's failed-resolution line to stderr", () => {
    const out = vi.fn();
    const err = vi.fn();
    const events = createEvents({ format: "prose", out, err });
    events.sessionResolved({
      role: "reviewer",
      issue: 9,
      branch: "sandcastle/issue-9",
      status: "failed",
      commits: 0,
      error: "kaboom",
    });
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith("  ✗ rev #9 (sandcastle/issue-9) failed: kaboom");
  });

  it("in ndjson mode writes every event as one JSON object to `out` (incl. silent-in-prose ones)", () => {
    const out = vi.fn();
    const err = vi.fn();
    const events = createEvents({
      format: "ndjson",
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      out,
      err,
    });

    events.tick(3, 10, 7);
    events.sessionResolved({
      role: "implementer",
      issue: 1,
      branch: "b",
      status: "ok",
      commits: 2,
    });
    events.plannerFailed("boom");

    expect(err).not.toHaveBeenCalled();
    expect(out).toHaveBeenCalledTimes(3);
    const first = JSON.parse(out.mock.calls[0][0] as string) as Record<string, unknown>;
    const second = JSON.parse(out.mock.calls[1][0] as string) as Record<string, unknown>;
    const third = JSON.parse(out.mock.calls[2][0] as string) as Record<string, unknown>;
    expect(first).toEqual({
      type: "tick",
      free: 3,
      poolSize: 10,
      inflight: 7,
      ts: "2026-07-04T10:00:00.000Z",
    });
    expect(second).toEqual({
      type: "session-resolved",
      role: "implementer",
      issue: 1,
      branch: "b",
      status: "ok",
      commits: 2,
      error: null,
      ts: "2026-07-04T10:00:00.000Z",
    });
    expect(third).toEqual({
      type: "planner-failed",
      error: "boom",
      ts: "2026-07-04T10:00:00.000Z",
    });
  });

  it("defaults to prose and reads the format from SANDCASTLE_EVENT_FORMAT when not given", () => {
    const out = vi.fn();
    const err = vi.fn();
    const prose = createEvents({ now: () => new Date(0), out, err });
    prose.poolFull();
    expect(out).toHaveBeenCalledTimes(1);
    expect(out).toHaveBeenCalledWith("Pool full — skipping gh query this tick.");

    out.mockClear();
    err.mockClear();
    const ndjson = createEvents({
      now: () => new Date(0),
      out,
      err,
      format: resolveEventFormat({ SANDCASTLE_EVENT_FORMAT: "ndjson" }),
    });
    ndjson.poolFull();
    expect(JSON.parse(out.mock.calls[0][0] as string)).toEqual({
      type: "pool-full",
      ts: "1970-01-01T00:00:00.000Z",
    });
  });

  it("stamps each emitted event with an ISO ts at emit time", () => {
    const out = vi.fn();
    let t = new Date("2026-07-04T10:00:00.000Z");
    const events = createEvents({ format: "ndjson", now: () => t, out });
    events.poolFull();
    t = new Date("2026-07-04T11:00:00.000Z");
    events.poolFull();
    const a = JSON.parse(out.mock.calls[0][0] as string) as { ts: string };
    const b = JSON.parse(out.mock.calls[1][0] as string) as { ts: string };
    expect(a.ts).toBe("2026-07-04T10:00:00.000Z");
    expect(b.ts).toBe("2026-07-04T11:00:00.000Z");
  });
});

// ── EVENT_TYPES / isKnownEventType: the decode allow-list, derived from the union ─

describe("EVENT_TYPES / isKnownEventType", () => {
  /** The canonical roster of every OrchestratorEvent tag. This test's job is to
   *  catch divergence between the shipped allow-list and the union: a variant
   *  added to the union (and thus to the exhaustive tag map) but forgotten here
   *  fails the size assertion. */
  const ALL_TYPES: OrchestratorEvent["type"][] = [
    "tick",
    "pool-full",
    "buckets",
    "dispatch",
    "planner-emitted",
    "plan-reused",
    "planner-skipped",
    "planner-no-plan",
    "planner-failed",
    "noop-escalated",
    "gh-error",
    "session-resolved",
  ];

  it("contains exactly every orchestrator event type, no more, no fewer", () => {
    expect([...EVENT_TYPES].sort()).toEqual([...ALL_TYPES].sort());
  });

  it("recognizes every event type and rejects unknown ones", () => {
    for (const type of ALL_TYPES) expect(isKnownEventType(type)).toBe(true);
    expect(isKnownEventType("mystery")).toBe(false);
    expect(isKnownEventType("")).toBe(false);
  });
});

// ── eventSeverity: failure | warn | normal (drives the Cockpit log colour) ────

describe("eventSeverity", () => {
  it("classifies failures as failure", () => {
    expect(eventSeverity(evt({ type: "gh-error", args: ["a"], error: "x" }))).toBe("failure");
    expect(eventSeverity(evt({ type: "planner-failed", error: "x" }))).toBe("failure");
    expect(
      eventSeverity(
        evt({
          type: "session-resolved",
          role: "reviewer",
          issue: 1,
          branch: "b",
          status: "failed",
          commits: 0,
          error: "x",
        })
      )
    ).toBe("failure");
  });

  it("classifies soft escalations as warn", () => {
    expect(eventSeverity(evt({ type: "noop-escalated", issue: 1 }))).toBe("warn");
    expect(eventSeverity(evt({ type: "planner-no-plan" }))).toBe("warn");
  });

  it("classifies progress events (incl. a successful resolution) as normal", () => {
    expect(eventSeverity(evt({ type: "tick", free: 1, poolSize: 10, inflight: 0 }))).toBe("normal");
    expect(eventSeverity(evt({ type: "planner-emitted", count: 1 }))).toBe("normal");
    expect(
      eventSeverity(
        evt({
          type: "session-resolved",
          role: "implementer",
          issue: 1,
          branch: "b",
          status: "ok",
          commits: 2,
          error: null,
        })
      )
    ).toBe("normal");
  });
});
