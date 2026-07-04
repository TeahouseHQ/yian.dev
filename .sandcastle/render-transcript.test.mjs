import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WINDOW_DAYS,
  NO_WINDOW,
  detailFields,
  filterEntries,
  flattenTree,
  formatArguments,
  formatDuration,
  formatTimestamp,
  formatTranscriptUsage,
  groupRuns,
  isListMode,
  latestRunId,
  pagerOffset,
  parseArgs,
  parseTranscript,
  parseWindowArgs,
  renderRunSummary,
  renderTranscript,
  resolveCutoff,
  resolveTranscriptFile,
  runIssue,
  runSummaryFields,
  summarizeEntry,
  summarizeUsage,
  withinWindow,
} from "./render-transcript.mjs";

// A minimal but representative captured pi session JSONL: a user prompt, an
// assistant turn with thinking + a tool call + usage, the tool result, then a
// final assistant text turn with usage. Mirrors the real on-disk format from
// ADR 0001 (see .pi/agent/sessions/*/<stamp>_<sessionId>.jsonl).
const FIXTURE_JSONL = [
  JSON.stringify({
    type: "session",
    version: 3,
    id: "sess-1",
    timestamp: "2026-06-28T01:00:00.000Z",
    cwd: "/repo",
  }),
  JSON.stringify({
    type: "message",
    id: "m1",
    parentId: null,
    timestamp: "2026-06-28T01:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text: "Fix issue #54" }] },
  }),
  JSON.stringify({
    type: "message",
    id: "m2",
    parentId: "m1",
    timestamp: "2026-06-28T01:00:02.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me read the issue.", thinkingSignature: "x" },
        {
          type: "toolCall",
          id: "call_1",
          name: "bash",
          arguments: { command: "gh issue view 54" },
        },
      ],
      model: "glm-5.1",
      usage: {
        input: 100,
        output: 10,
        cacheRead: 50,
        cacheWrite: 5,
        totalTokens: 165,
        cost: { total: 0 },
      },
    },
  }),
  JSON.stringify({
    type: "message",
    id: "m3",
    parentId: "m2",
    timestamp: "2026-06-28T01:00:03.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "bash",
      content: [{ type: "text", text: "ok output" }],
      isError: false,
    },
  }),
  JSON.stringify({
    type: "message",
    id: "m4",
    parentId: "m3",
    timestamp: "2026-06-28T01:00:04.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_2",
          name: "edit",
          arguments: { path: "/x.ts", content: "y" },
        },
      ],
      model: "glm-5.1",
      usage: { input: 120, output: 4, cacheRead: 80, cacheWrite: 0, totalTokens: 204 },
    },
  }),
  JSON.stringify({
    type: "message",
    id: "m5",
    parentId: "m4",
    timestamp: "2026-06-28T01:00:05.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_2",
      toolName: "edit",
      content: [{ type: "text", text: "boom" }],
      isError: true,
    },
  }),
  JSON.stringify({
    type: "message",
    id: "m6",
    parentId: "m5",
    timestamp: "2026-06-28T01:00:06.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Done." }],
      model: "glm-5.1",
      usage: { input: 200, output: 2, cacheRead: 90, cacheWrite: 0, totalTokens: 292 },
    },
  }),
].join("\n");

// ---- arg parsing -----------------------------------------------------------

describe("parseArgs", () => {
  it("returns an empty filter (list mode) for no args", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("parses --issue, --phase, --run as space-separated flags", () => {
    expect(parseArgs(["--issue", "44", "--phase", "impl", "--run", "latest"])).toEqual({
      issue: 44,
      phase: "impl",
      run: "latest",
    });
  });

  it("parses --issue=44 / --run=run-x equals forms", () => {
    expect(parseArgs(["--issue=53", "--run=run-20260628120000123"])).toEqual({
      issue: 53,
      run: "run-20260628120000123",
    });
  });

  it("rejects a non-numeric --issue", () => {
    expect(() => parseArgs(["--issue", "abc"])).toThrow(/issue/i);
  });
});

describe("isListMode", () => {
  it("is true with no filters and false once any filter is set", () => {
    expect(isListMode({})).toBe(true);
    expect(isListMode({ issue: 44 })).toBe(false);
    expect(isListMode({ phase: "impl" })).toBe(false);
    expect(isListMode({ run: "latest" })).toBe(false);
  });
});

// ---- manifest query --------------------------------------------------------

const entries = [
  {
    runId: "run-old",
    phase: "impl",
    issue: 40,
    branch: "sandcastle/issue-40",
    sessionId: "s-old",
    sessionFile: "/repo/.sandcastle/sessions/--repo--",
    commits: 2,
    usage: {
      inputTokens: 10,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    startedAt: "2026-06-27T10:00:00.000Z",
    endedAt: "2026-06-27T10:05:00.000Z",
    status: "ok",
  },
  {
    runId: "run-new",
    phase: "planner",
    issue: null,
    branch: null,
    sessionId: "s-plan",
    sessionFile: "/repo/.sandcastle/sessions/--repo--",
    commits: 0,
    usage: {
      inputTokens: 5,
      outputTokens: 1,
      cacheReadInputTokens: 1,
      cacheCreationInputTokens: 0,
    },
    startedAt: "2026-06-28T12:00:00.000Z",
    endedAt: "2026-06-28T12:01:00.000Z",
    status: "ok",
  },
  {
    runId: "run-new",
    phase: "impl",
    issue: 44,
    branch: "sandcastle/issue-44",
    sessionId: "s-44",
    sessionFile: "/repo/.sandcastle/sessions/--repo--",
    commits: 3,
    usage: {
      inputTokens: 50,
      outputTokens: 4,
      cacheReadInputTokens: 20,
      cacheCreationInputTokens: 2,
    },
    startedAt: "2026-06-28T12:02:00.000Z",
    endedAt: "2026-06-28T12:10:00.000Z",
    status: "ok",
  },
  {
    runId: "run-new",
    phase: "impl",
    issue: 44,
    branch: "sandcastle/issue-44",
    sessionId: null,
    sessionFile: null,
    commits: 0,
    usage: null,
    startedAt: "2026-06-28T12:11:00.000Z",
    endedAt: "2026-06-28T12:11:30.000Z",
    status: "failed",
    error: "boom",
  },
];

describe("latestRunId", () => {
  it("picks the runId whose latest entry ended most recently", () => {
    expect(latestRunId(entries)).toBe("run-new");
  });

  it("returns null for an empty manifest", () => {
    expect(latestRunId([])).toBeNull();
  });
});

describe("filterEntries", () => {
  it("resolves --run latest to the newest runId and returns all its sessions", () => {
    const got = filterEntries(entries, { run: "latest" });
    expect(got).toHaveLength(3);
    expect(got.every((e) => e.runId === "run-new")).toBe(true);
  });

  it("filters by an explicit runId", () => {
    const got = filterEntries(entries, { run: "run-old" });
    expect(got).toHaveLength(1);
    expect(got[0].phase).toBe("impl");
    expect(got[0].issue).toBe(40);
  });

  it("filters by issue across runs", () => {
    const got = filterEntries(entries, { issue: 44 });
    expect(got).toHaveLength(2);
    expect(got.every((e) => e.phase === "impl")).toBe(true);
  });

  it("filters by phase", () => {
    const got = filterEntries(entries, { phase: "planner" });
    expect(got).toHaveLength(1);
    expect(got[0].runId).toBe("run-new");
  });

  it("combines filters with AND", () => {
    const got = filterEntries(entries, { run: "run-new", phase: "impl", issue: 44 });
    expect(got).toHaveLength(2);
  });

  it("returns [] when nothing matches", () => {
    expect(filterEntries(entries, { issue: 999 })).toEqual([]);
  });

  it("ignores an empty filter (returns everything)", () => {
    expect(filterEntries(entries, {})).toHaveLength(entries.length);
  });
});

// ---- summary rendering -----------------------------------------------------

describe("summarizeUsage", () => {
  it("formats an IterationUsage (manifest shape)", () => {
    expect(
      summarizeUsage({
        inputTokens: 50,
        outputTokens: 4,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 2,
      })
    ).toBe("in=50  out=4  cacheRead=20  cacheWrite=2");
  });

  it("reports (no usage) for null", () => {
    expect(summarizeUsage(null)).toBe("(no usage)");
  });
});

describe("summarizeEntry", () => {
  it("renders a full ok row", () => {
    expect(summarizeEntry(entries[2])).toBe(
      "impl  #44  sandcastle/issue-44  3 commits  in=50  out=4  cacheRead=20  cacheWrite=2  ok"
    );
  });

  it("renders a failed row with the error and pluralizes 0 commits", () => {
    expect(summarizeEntry(entries[3])).toBe(
      "impl  #44  sandcastle/issue-44  0 commits  (no usage)  failed: boom"
    );
  });

  it("renders an orchestrator row with no issue/branch", () => {
    expect(summarizeEntry(entries[1])).toBe(
      "planner  -  -  0 commits  in=5  out=1  cacheRead=1  cacheWrite=0  ok"
    );
  });
});

describe("renderRunSummary", () => {
  it("lists the run's sessions under a runId header", () => {
    const got = renderRunSummary(filterEntries(entries, { run: "run-new" }));
    expect(got).toContain("Run run-new");
    expect(got).toContain("planner  -  -");
    expect(got).toContain("impl  #44  sandcastle/issue-44  3 commits");
    expect(got).toContain("failed: boom");
  });
});

// ---- transcript parsing + rendering ---------------------------------------

describe("parseTranscript", () => {
  it("returns one record per non-blank line", () => {
    const { records } = parseTranscript(FIXTURE_JSONL + "\n\n");
    expect(records).toHaveLength(7);
    expect(records[0].type).toBe("session");
    expect(records[1].message.role).toBe("user");
  });

  it("collects per-line parse errors instead of throwing", () => {
    const { records, errors } = parseTranscript('{"type":"session"}\nnot json\n{"ok":1}\n');
    expect(records).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
  });
});

describe("formatTranscriptUsage", () => {
  it("formats the raw provider usage shape (input/output/cacheRead/cacheWrite/total)", () => {
    expect(
      formatTranscriptUsage({
        input: 100,
        output: 10,
        cacheRead: 50,
        cacheWrite: 5,
        totalTokens: 165,
      })
    ).toBe("in=100  out=10  cacheRead=50  cacheWrite=5  total=165");
  });

  it("omits total when absent", () => {
    expect(formatTranscriptUsage({ input: 1, output: 2 })).toBe("in=1  out=2");
  });
});

describe("formatArguments", () => {
  it("renders each key: value on its own line", () => {
    expect(formatArguments({ command: "gh issue view 54" })).toBe("command: gh issue view 54");
  });

  it("JSON-stringifies non-string values", () => {
    expect(formatArguments({ n: 3, opts: { a: true } })).toBe('n: 3\nopts: {"a":true}');
  });

  it("returns empty string for no arguments", () => {
    expect(formatArguments({})).toBe("");
    expect(formatArguments(undefined)).toBe("");
  });
});

describe("renderTranscript", () => {
  const out = renderTranscript(parseTranscript(FIXTURE_JSONL).records);

  it("renders the assistant model + per-message usage", () => {
    expect(out).toContain("assistant (glm-5.1)");
    expect(out).toContain("in=100  out=10  cacheRead=50  cacheWrite=5  total=165");
    expect(out).toContain("total=292");
  });

  it("renders thinking blocks", () => {
    expect(out).toContain("thinking");
    expect(out).toContain("Let me read the issue.");
  });

  it("renders tool calls with their inputs", () => {
    expect(out).toContain("bash");
    expect(out).toContain("command: gh issue view 54");
    expect(out).toContain("edit");
    expect(out).toContain("path: /x.ts");
    expect(out).toContain("content: y");
  });

  it("renders tool results and flags errors", () => {
    expect(out).toContain("ok output");
    expect(out).toContain("boom");
    expect(out).toContain("[error]");
  });

  it("renders assistant text", () => {
    expect(out).toContain("Done.");
  });

  it("renders the user prompt", () => {
    expect(out).toContain("Fix issue #54");
  });
});

// ---- transcript file resolution (fs) --------------------------------------

describe("resolveTranscriptFile", () => {
  let dir;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("uses sessionFile directly when it is a file", async () => {
    dir = await mkdtemp(join(tmpdir(), "transcript-"));
    const file = join(dir, "direct.jsonl");
    await writeFile(file, FIXTURE_JSONL, "utf8");
    const got = await resolveTranscriptFile({
      sessionId: "sess-1",
      sessionFile: file,
    });
    expect(got).toBe(file);
  });

  it("resolves the file by sessionId when sessionFile is a directory (pi shape)", async () => {
    dir = await mkdtemp(join(tmpdir(), "transcript-"));
    const sessionDir = join(dir, "--repo--");
    await mkdir(sessionDir, { recursive: true });
    // pi names files <stamp>_<sessionId>.jsonl
    const file = join(sessionDir, "2026-06-28T01-00-00-000Z_sess-1.jsonl");
    await writeFile(file, FIXTURE_JSONL, "utf8");
    const got = await resolveTranscriptFile({
      sessionId: "sess-1",
      sessionFile: sessionDir,
    });
    expect(got).toBe(file);
  });

  it("falls back to a recursive search of sessionsDir when sessionFile is null", async () => {
    dir = await mkdtemp(join(tmpdir(), "transcript-"));
    const nested = join(dir, "--repo--", "deep");
    await mkdir(nested, { recursive: true });
    const file = join(nested, "2026-06-28T01-00-00-000Z_sess-1.jsonl");
    await writeFile(file, FIXTURE_JSONL, "utf8");
    const got = await resolveTranscriptFile({ sessionId: "sess-1", sessionFile: null }, dir);
    expect(got).toBe(file);
  });

  it("returns null when no transcript can be found", async () => {
    dir = await mkdtemp(join(tmpdir(), "transcript-"));
    const got = await resolveTranscriptFile(
      { sessionId: "missing", sessionFile: join(dir, "nope") },
      dir
    );
    expect(got).toBeNull();
  });
});

// ---- windowing + run grouping (session browser, issue #72) ---------------

describe("parseWindowArgs", () => {
  it("returns {} when neither flag is present (unknown flags ignored)", () => {
    expect(parseWindowArgs([])).toEqual({});
    expect(parseWindowArgs(["--foo", "bar"])).toEqual({});
  });

  it("parses --days as an integer in both space and equals forms", () => {
    expect(parseWindowArgs(["--days", "7"])).toEqual({ days: 7 });
    expect(parseWindowArgs(["--days=7"])).toEqual({ days: 7 });
  });

  it("parses --since as a string", () => {
    expect(parseWindowArgs(["--since", "2026-07-01"])).toEqual({ since: "2026-07-01" });
    expect(parseWindowArgs(["--since=2026-07-01T00:00:00Z"])).toEqual({
      since: "2026-07-01T00:00:00Z",
    });
  });

  it("lets --days and --since coexist (since wins at resolve time)", () => {
    expect(parseWindowArgs(["--days", "3", "--since", "2026-07-01"])).toEqual({
      days: 3,
      since: "2026-07-01",
    });
  });

  it("rejects a non-integer --days", () => {
    expect(() => parseWindowArgs(["--days", "abc"])).toThrow(/days/i);
  });

  it("throws when a value is missing", () => {
    expect(() => parseWindowArgs(["--days"])).toThrow(/requires a value/);
    expect(() => parseWindowArgs(["--since"])).toThrow(/requires a value/);
  });
});

describe("resolveCutoff", () => {
  const now = new Date("2026-07-04T00:00:00.000Z");

  it("pins DEFAULT_WINDOW_DAYS to 3", () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(3);
  });

  it("defaults to the last 3 days", () => {
    // 2026-07-04 minus 3 days = 2026-07-01T00:00:00Z
    expect(resolveCutoff({}, now)).toBe(Date.parse("2026-07-01T00:00:00.000Z"));
    expect(resolveCutoff(undefined, now)).toBe(Date.parse("2026-07-01T00:00:00.000Z"));
  });

  it("honors --days N when provided", () => {
    expect(resolveCutoff({ days: 1 }, now)).toBe(Date.parse("2026-07-03T00:00:00.000Z"));
    expect(resolveCutoff({ days: 7 }, now)).toBe(Date.parse("2026-06-27T00:00:00.000Z"));
  });

  it("disables windowing for --days 0 or negative (NO_WINDOW)", () => {
    expect(resolveCutoff({ days: 0 }, now)).toBe(NO_WINDOW);
    expect(resolveCutoff({ days: -1 }, now)).toBe(NO_WINDOW);
    expect(NO_WINDOW).toBe(-Infinity);
  });

  it("--since overrides --days and the default", () => {
    expect(resolveCutoff({ days: 3, since: "2026-07-02" }, now)).toBe(
      Date.parse("2026-07-02T00:00:00.000Z")
    );
  });

  it("a non-parseable --since falls back to days/default (no throw)", () => {
    expect(resolveCutoff({ since: "not-a-date" }, now)).toBe(
      Date.parse("2026-07-01T00:00:00.000Z")
    );
  });
});

describe("withinWindow", () => {
  const es = [
    { runId: "a", endedAt: "2026-07-03T10:00:00.000Z" },
    { runId: "b", endedAt: "2026-06-20T10:00:00.000Z" }, // before cutoff
    { runId: "c", startedAt: "2026-07-02T10:00:00.000Z" }, // no endedAt → startedAt
    { runId: "d" }, // no parseable time
  ];

  it("keeps entries at/after the cutoff (endedAt, with startedAt fallback)", () => {
    const cutoff = Date.parse("2026-07-01T00:00:00.000Z");
    expect(withinWindow(es, cutoff).map((e) => e.runId)).toEqual(["a", "c"]);
  });

  it("returns a copy of every entry for NO_WINDOW (does not drop no-time rows)", () => {
    const got = withinWindow(es, NO_WINDOW);
    expect(got).toHaveLength(es.length);
    expect(got).not.toBe(es); // a defensive copy
  });

  it("drops only the no-time entries when the cutoff predates everything", () => {
    const got = withinWindow(es, Date.parse("2000-01-01T00:00:00.000Z"));
    expect(got.map((e) => e.runId)).toEqual(["a", "b", "c"]);
  });
});

describe("groupRuns", () => {
  const es = [
    { runId: "run-a", phase: "impl", endedAt: "2026-07-01T10:00:00.000Z" },
    { runId: "run-a", phase: "rev", endedAt: "2026-07-02T10:00:00.000Z" },
    { runId: "run-b", phase: "impl", endedAt: "2026-07-03T10:00:00.000Z" },
    { runId: "run-c", phase: "impl", startedAt: "2026-06-20T10:00:00.000Z" },
  ];

  it("groups by runId and sorts newest-first by max endedAt", () => {
    const got = groupRuns(es);
    expect(got.map((r) => r.runId)).toEqual(["run-b", "run-a", "run-c"]);
    expect(got[0].endedAt).toBe(Date.parse("2026-07-03T10:00:00.000Z"));
    expect(got[1].endedAt).toBe(Date.parse("2026-07-02T10:00:00.000Z")); // max of run-a
  });

  it("keeps each run's entries in manifest (append) order", () => {
    const a = groupRuns(es).find((r) => r.runId === "run-a");
    expect(a.entries.map((e) => e.phase)).toEqual(["impl", "rev"]);
  });

  it("returns [] for an empty manifest", () => {
    expect(groupRuns([])).toEqual([]);
  });

  it("reports endedAt -1 when none of a run's entries parse", () => {
    expect(groupRuns([{ runId: "run-x", phase: "impl" }])[0].endedAt).toBe(-1);
  });
});

describe("latestRunId (shares entryTime with groupRuns)", () => {
  it("still returns the runId whose latest entry ended most recently", () => {
    const es = [
      { runId: "run-a", endedAt: "2026-07-01T10:00:00.000Z" },
      { runId: "run-b", endedAt: "2026-07-03T10:00:00.000Z" },
    ];
    expect(latestRunId(es)).toBe("run-b");
    // and matches groupRuns' first element
    expect(groupRuns(es)[0].runId).toBe("run-b");
  });
});

// ---- detail + tree helpers (session browser, issue #73) ------------------

describe("formatDuration", () => {
  it("formats a sub-minute duration as Ns", () => {
    expect(formatDuration("2026-06-28T12:11:30.000Z", "2026-06-28T12:11:00.000Z")).toBe("30s");
  });

  it("formats a sub-hour duration as Nm Ns", () => {
    expect(formatDuration("2026-06-28T12:10:00.000Z", "2026-06-28T12:02:00.000Z")).toBe("8m 0s");
  });

  it("formats an hour+ duration as Nh Nm", () => {
    expect(formatDuration("2026-06-28T13:04:00.000Z", "2026-06-28T12:02:00.000Z")).toBe("1h 2m");
  });

  it("returns 0s for equal timestamps", () => {
    expect(formatDuration("2026-06-28T12:02:00.000Z", "2026-06-28T12:02:00.000Z")).toBe("0s");
  });

  it("returns (unknown) for unparseable or inverted timestamps", () => {
    expect(formatDuration(null, "2026-06-28T12:02:00.000Z")).toBe("(unknown)");
    // ended before started → invalid
    expect(formatDuration("2026-06-28T12:02:00.000Z", "2026-06-28T12:10:00.000Z")).toBe(
      "(unknown)"
    );
    expect(formatDuration(undefined, undefined)).toBe("(unknown)");
  });
});

describe("formatTimestamp", () => {
  it("formats an ISO timestamp in UTC deterministically", () => {
    expect(formatTimestamp("2026-06-28T12:10:00.000Z")).toBe("2026-06-28 12:10:00 UTC");
  });

  it("returns (unknown) for an unparseable timestamp", () => {
    expect(formatTimestamp("not-a-date")).toBe("(unknown)");
    expect(formatTimestamp(null)).toBe("(unknown)");
  });
});

describe("runIssue", () => {
  it("returns the first non-null issue among a run's entries", () => {
    const runs = groupRuns(entries);
    const r = runs.find((x) => x.runId === "run-new");
    // run-new mixes a planner(null) entry with impl(44) entries → 44
    expect(runIssue(r)).toBe(44);
  });

  it("returns null when every entry is issue-less (a planner run)", () => {
    const planner = { entries: [{ issue: null }, { issue: null }] };
    expect(runIssue(planner)).toBeNull();
  });
});

describe("detailFields", () => {
  it("renders the full ordered field set for an ok session, including duration", () => {
    const fields = detailFields(entries[2]); // impl #44, 3 commits, ok
    expect(fields.map((f) => f.label)).toEqual([
      "Phase",
      "Issue",
      "Branch",
      "Started",
      "Ended",
      "Duration",
      "Commits",
      "Tokens",
      "Status",
    ]);
    const map = Object.fromEntries(fields.map((f) => [f.label, f.value]));
    expect(map.Phase).toBe("impl");
    expect(map.Issue).toBe("#44");
    expect(map.Branch).toBe("sandcastle/issue-44");
    expect(map.Started).toBe("2026-06-28 12:02:00 UTC");
    expect(map.Ended).toBe("2026-06-28 12:10:00 UTC");
    expect(map.Duration).toBe("8m 0s");
    expect(map.Commits).toBe("3 commits");
    expect(map.Tokens).toBe("in=50  out=4  cacheRead=20  cacheWrite=2");
    expect(map.Status).toBe("ok");
  });

  it("flags a failed session's Status with the error and pluralizes 0 commits", () => {
    const map = Object.fromEntries(detailFields(entries[3]).map((f) => [f.label, f.value]));
    expect(map.Status).toBe("failed: boom");
    expect(map.Commits).toBe("0 commits");
    expect(map.Duration).toBe("30s");
  });

  it("labels a planner (issue-less) session and a null branch", () => {
    const map = Object.fromEntries(detailFields(entries[1]).map((f) => [f.label, f.value]));
    expect(map.Issue).toBe("(planner)");
    expect(map.Branch).toBe("(none)");
  });
});

describe("runSummaryFields", () => {
  it("summarizes a run's aggregate metadata", () => {
    const r = groupRuns(entries).find((x) => x.runId === "run-new");
    const map = Object.fromEntries(runSummaryFields(r).map((f) => [f.label, f.value]));
    expect(map.Run).toBe("run-new");
    expect(map.Issue).toBe("#44");
    expect(map.Sessions).toBe("3 sessions");
    expect(map["Total commits"]).toBe("3 commits"); // planner 0 + impl 3 + failed 0
    expect(map.Phases).toBe("planner, impl");
  });

  it("labels a planner run and formats its newest ended timestamp", () => {
    const planner = {
      runId: "run-plan",
      endedAt: Date.parse("2026-06-28T12:01:00.000Z"),
      entries: [{ runId: "run-plan", phase: "planner", issue: null, commits: 0 }],
    };
    const map = Object.fromEntries(runSummaryFields(planner).map((f) => [f.label, f.value]));
    expect(map.Issue).toBe("(planner)");
    expect(map["Newest ended"]).toBe("2026-06-28 12:01:00 UTC");
    expect(map.Phases).toBe("planner");
  });

  it("reports (unknown) when the run recorded no parseable endedAt", () => {
    const r = { runId: "run-x", endedAt: -1, entries: [{ phase: "impl", commits: 1 }] };
    const map = Object.fromEntries(runSummaryFields(r).map((f) => [f.label, f.value]));
    expect(map["Newest ended"]).toBe("(unknown)");
  });
});

// ---- transcript pager scroll (session browser, issue #74) ------------------

describe("pagerOffset", () => {
  // 50 rendered lines, 10 visible rows → maxOffset 40.
  const lineCount = 50;
  const height = 10;

  it("scrolls down one line and clamps at the bottom", () => {
    expect(pagerOffset(0, lineCount, height, "down")).toBe(1);
    expect(pagerOffset(40, lineCount, height, "down")).toBe(40);
  });

  it("scrolls up one line and clamps at the top", () => {
    expect(pagerOffset(5, lineCount, height, "up")).toBe(4);
    expect(pagerOffset(0, lineCount, height, "up")).toBe(0);
  });

  it("scrolls a full viewport on pageDown/pageUp and clamps at both ends", () => {
    expect(pagerOffset(0, lineCount, height, "pageDown")).toBe(10);
    expect(pagerOffset(25, lineCount, height, "pageUp")).toBe(15);
    // a pageDown that would overshoot lands on maxOffset
    expect(pagerOffset(38, lineCount, height, "pageDown")).toBe(40);
  });

  it("jumps to the top (home) or bottom (end)", () => {
    expect(pagerOffset(20, lineCount, height, "home")).toBe(0);
    expect(pagerOffset(20, lineCount, height, "end")).toBe(40);
  });

  it("keeps offset 0 when the transcript is shorter than the viewport", () => {
    expect(pagerOffset(0, 3, 10, "down")).toBe(0);
    expect(pagerOffset(0, 3, 10, "pageDown")).toBe(0);
    expect(pagerOffset(0, 3, 10, "end")).toBe(0);
  });

  it("clamps a stale offset that exceeds a new (shorter) max", () => {
    // transcript shrinks to 5 lines / 10 visible → maxOffset 0; old offset 8 clamps.
    expect(pagerOffset(8, 5, 10, "up")).toBe(0);
  });

  it("returns the clamped current offset for an unknown action", () => {
    expect(pagerOffset(5, lineCount, height, "noop")).toBe(5);
    expect(pagerOffset(99, lineCount, height, "noop")).toBe(40);
  });
});

describe("flattenTree", () => {
  const runs = [
    {
      runId: "run-a",
      endedAt: 2,
      entries: [
        { runId: "run-a", phase: "impl", issue: 1 },
        { runId: "run-a", phase: "rev", issue: 1 },
      ],
    },
    {
      runId: "run-b",
      endedAt: 1,
      entries: [{ runId: "run-b", phase: "impl", issue: 2 }],
    },
  ];

  it("emits a run row then its session rows when expanded", () => {
    const rows = flattenTree(runs, new Set());
    expect(rows.map((r) => [r.kind, r.runId])).toEqual([
      ["run", "run-a"],
      ["session", "run-a"],
      ["session", "run-a"],
      ["run", "run-b"],
      ["session", "run-b"],
    ]);
    expect(rows[0].depth).toBe(0);
    expect(rows[1].depth).toBe(1);
    expect(rows[1].entry.phase).toBe("impl");
  });

  it("hides a collapsed run's sessions", () => {
    const rows = flattenTree(runs, new Set(["run-a"]));
    expect(rows.map((r) => [r.kind, r.runId])).toEqual([
      ["run", "run-a"],
      ["run", "run-b"],
      ["session", "run-b"],
    ]);
  });

  it("returns only run rows when every run is collapsed", () => {
    const rows = flattenTree(runs, new Set(["run-a", "run-b"]));
    expect(rows.map((r) => r.kind)).toEqual(["run", "run"]);
  });

  it("returns [] for an empty run list", () => {
    expect(flattenTree([], new Set())).toEqual([]);
  });
});
