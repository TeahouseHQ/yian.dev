import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent } from "@ai-hero/sandcastle";

import {
  formatLifecycleLine,
  formatStreamLine,
  isVerbose,
  lifecycle,
  logPath,
  observe,
} from "./observability.mts";

const toolCall = (overrides: Partial<Extract<AgentStreamEvent, { type: "toolCall" }>> = {}): AgentStreamEvent => ({
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
      formatStreamLine("impl #44", toolCall({ formattedArgs: "pnpm test\n--silent" }), false),
    ).toBe("[impl #44] ▶ Bash(pnpm test)");
  });

  it("suppresses text events unless verbose", () => {
    expect(formatStreamLine("planner", text("thinking..."), false)).toBeNull();
    expect(formatStreamLine("planner", text("thinking..."), true)).toBe("[planner] » thinking...");
  });

  it("suppresses raw events unless verbose", () => {
    expect(formatStreamLine("planner", raw('{"type":"tool_use"}'), false)).toBeNull();
    expect(formatStreamLine("planner", raw('{"type":"tool_use"}'), true)).toBe(
      '[planner] # {"type":"tool_use"}',
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
