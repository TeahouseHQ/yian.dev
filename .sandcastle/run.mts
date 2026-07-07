/**
 * Headless restart wrapper for the orchestrator (self-restart on upgrade,
 * ADR-0013, #102). `pnpm sandcastle` runs the orchestrator with no Cockpit
 * supervising it, so the shell-level restart the Cockpit gives supervised runs
 * lives here instead: spawn `main.mts`, and when it exits with the drain code —
 * meaning its own code changed on `origin/main` and it drained to restart — spawn
 * it again on the new code. Any OTHER exit (a clean stop, a crash, a Ctrl-C) ends
 * the wrapper, propagating the child's exit code.
 *
 * The restart contract is the SAME {@link shouldRestart} the Cockpit supervisor
 * uses ({@link import("./cockpit-core.mts").describeChildExit}), so the headless
 * and supervised restart behaviours can never drift. This wrapper is the thin
 * imperative layer only — the decision is the pure predicate in `dispatch.mts`.
 */
import { spawn } from "node:child_process";
import { DRAIN_EXIT_CODE, shouldRestart } from "./dispatch.mts";

/** Absolute path to the orchestrator entrypoint — resolved off this module's URL
 *  so the wrapper works regardless of the process's cwd. */
const ENTRY = new URL("./main.mts", import.meta.url).pathname;

/**
 * Run the orchestrator once, inheriting stdio so its headless prose feed streams
 * straight to the terminal. Resolves with the exit code the wrapper decides on:
 * the child's own numeric code, or — when a signal killed it (Ctrl-C, a kill) —
 * a non-zero code so the wrapper stops rather than restarts. Forwards SIGINT /
 * SIGTERM to the child so a Ctrl-C stops the orchestrator cleanly instead of
 * orphaning it.
 */
function runOrchestrator(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("tsx", [ENTRY], { stdio: "inherit" });
    const forward = (signal: NodeJS.Signals) => {
      if (child.exitCode === null) child.kill(signal);
    };
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    const cleanup = () => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
    };
    child.on("exit", (code, signal) => {
      cleanup();
      // A signal-killed child reports code === null — treat as a non-restart stop
      // (128 + is the conventional signal-exit encoding; any non-drain code stops).
      resolve(code ?? (signal ? 130 : 0));
    });
    child.on("error", (err) => {
      cleanup();
      console.error(`failed to start orchestrator: ${err.message}`);
      resolve(1);
    });
  });
}

for (;;) {
  const code = await runOrchestrator();
  if (!shouldRestart(code)) process.exit(code);
  // Drain exit: the orchestrator's code changed upstream and it drained cleanly.
  console.log(
    `\n↻ orchestrator drained to restart (exit ${DRAIN_EXIT_CODE}) — relaunching on the new code…\n`
  );
}
