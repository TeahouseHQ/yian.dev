/**
 * `pnpm sandcastle:shell` — drop into an interactive root shell inside a
 * Sandcastle sandbox to test/debug the container environment by hand.
 *
 * WHY a bespoke script (not `sandcastle docker <x>`): the sandcastle CLI's
 * docker namespace only exposes `build-image` / `remove-image` — there is no
 * built-in interactive shell. This reuses the SAME `createSandbox` path the
 * orchestrator's Implementer/Reviewer run under, so "what you debug" is exactly
 * "what the agent sees": a fresh `origin/main` worktree bind-mounted at
 * /home/agent/workspace, `.sandcastle/.env` injected as container env
 * (LITELLM_API_KEY, GH_TOKEN, model config — createSandbox calls `resolveEnv`
 * internally), `--user 0:0`, the same network, and the baked-in models.json.
 * A hand-rolled `docker run` would re-derive all of that by hand and drift.
 *
 * The public `Sandbox` handle intentionally exposes only run()/interactive()
 * (agent sessions) and exec() (captured) — no raw TTY. So for a real shell we
 * let `createSandbox` do the setup, then attach with `docker exec -it` against
 * the container we locate by its unique worktree bind mount.
 *
 * Flags (forwarded through `pnpm sandcastle:shell -- …`):
 *   --build          Run the Implementer's install+build hooks first
 *                    (`pnpm install --frozen-lockfile && pnpm build`) so you
 *                    land in a fully-ready workspace. OFF by default: a broken
 *                    build makes `onSandboxReady` exit non-zero, which REJECTS
 *                    `createSandbox` (see the Landing in main.mts) — so building
 *                    by default would lock you out of the very shell you opened
 *                    to debug that build.
 *   --branch <name>  Reproduce a specific sandbox by checking out an existing
 *                    branch (e.g. `sandcastle/issue-123`) instead of the fresh
 *                    throwaway default. An existing branch is used as-is
 *                    (createSandbox ignores `baseBranch` when the branch already
 *                    exists) and is NEVER force-deleted.
 *
 * The default branch is the throwaway `sandcastle/shell`, force-freshed on every
 * run (deleted before AND after) so each default session forks a clean
 * `origin/main`: createSandbox only forks when the branch is ABSENT, so a
 * leftover branch would otherwise silently resurrect a stale tree.
 *
 * On exit (you type `exit`): the sandbox is disposed — container removed and the
 * throwaway worktree cleaned (createSandbox preserves it only if dirty, printing
 * the path) — then the `sandcastle/shell` branch is deleted.
 *
 * containerUid/containerGid: 0 mirrors main.mts's `dockerSandbox()`: this machine
 * runs ROOTLESS Docker where the container's root maps to the host user that owns
 * the bind mount, and the image's USER must match or `checkImageUid` rejects it
 * (ADR-0002 background; see main.mts and .sandcastle/Dockerfile).
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { implementerSandboxSpec } from "./dispatch.mts";
import { forkBase, loadRepoProfile } from "./repo-profile.mts";

// The debug shell forks from the same Repo-profile base as a real Implementer
// (ADR-0014, #108) — no hardcoded origin/main.
const repoProfile = loadRepoProfile();

const execFileAsync = promisify(execFile);

/** The sandbox-side repo path (matches SANDBOX_REPO_DIR in sandcastle). */
const SANDBOX_REPO_DIR = "/home/agent/workspace";
/** Throwaway branch used when no explicit `--branch` is given. */
const DEFAULT_BRANCH = "sandcastle/shell";

// ── Parse args ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const wantBuild = argv.includes("--build");
const branchFlagIdx = argv.indexOf("--branch");
const branchArg = branchFlagIdx !== -1 ? argv[branchFlagIdx + 1] : undefined;
if (branchFlagIdx !== -1 && (branchArg === undefined || branchArg.startsWith("--"))) {
  console.error("--branch requires a branch name, e.g. --branch sandcastle/issue-123");
  process.exit(1);
}
const branch = branchArg ?? DEFAULT_BRANCH;
const isDefaultBranch = branchArg === undefined;

// ── Force-fresh the throwaway branch ─────────────────────────────────────────
// createSandbox forks `branch` from origin/main ONLY when it does not already
// exist; a leftover `sandcastle/shell` from a prior (or crashed) run would be
// reused stale. Delete it up front — ignoring "not found" — so every default run
// starts from a clean origin/main. A user-supplied --branch is left untouched:
// it is the thing being reproduced, not a throwaway.
function deleteDefaultBranch(): void {
  if (!isDefaultBranch) return;
  try {
    execFileSync("git", ["branch", "-D", DEFAULT_BRANCH], { stdio: "ignore" });
  } catch {
    // Branch didn't exist (or is still checked out in a preserved worktree) —
    // nothing to clean, or it will be cleaned by `pnpm sandcastle:prune`.
  }
}

/** Realpath, tolerating paths that don't resolve (compare raw as a fallback). */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Find the running `sandcastle-*` container whose worktree bind mount matches
 * this sandbox. The public Sandbox handle doesn't expose the container name, but
 * it does expose `worktreePath`, and each sandbox mounts a UNIQUE host worktree
 * at /home/agent/workspace — so matching on mount Source is race-free even when
 * the orchestrator is running its own sandboxes concurrently.
 */
async function findContainer(worktreePath: string): Promise<string> {
  const target = safeRealpath(worktreePath);
  const { stdout } = await execFileAsync("docker", [
    "ps",
    "--no-trunc",
    "--filter",
    "name=^sandcastle-",
    "--format",
    "{{.Names}}",
  ]);
  const names = stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of names) {
    const { stdout: mounts } = await execFileAsync("docker", [
      "inspect",
      "-f",
      "{{range .Mounts}}{{.Source}}\n{{end}}",
      name,
    ]);
    const sources = mounts
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (sources.some((s) => safeRealpath(s) === target)) return name;
  }
  throw new Error(
    `Could not find the sandbox container for worktree ${worktreePath}. ` +
      "Is Docker running? (searched running sandcastle-* containers)"
  );
}

/**
 * Attach an interactive `bash` to the container. `-it` allocates a TTY (requires
 * this process's stdin to be a terminal — true under `pnpm sandcastle:shell`);
 * `-w` lands you in the workspace. Resolves with the shell's exit code.
 */
function runInteractiveShell(container: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["exec", "-it", "-w", SANDBOX_REPO_DIR, container, "bash"], {
      stdio: "inherit",
    });
    proc.on("error", reject);
    // A signal-killed shell reports code === null; map to the conventional 130.
    proc.on("exit", (code, signal) => resolve(code ?? (signal ? 130 : 0)));
  });
}

// ── Open the sandbox and drop into the shell ─────────────────────────────────
// --build → the full Implementer spec (fork origin/main, carry node_modules,
// install+build). Default → a fast bare checkout on origin/main with no hooks.
const spec = wantBuild
  ? implementerSandboxSpec(branch, repoProfile)
  : { branch, baseBranch: forkBase(repoProfile) };

deleteDefaultBranch();

console.log(
  `\n⛱  Opening a shell in ${branch}${wantBuild ? " (install+build first)" : ""} — type \`exit\` to tear down.\n`
);

let exitCode = 0;
let sandbox: sandcastle.Sandbox | undefined;
try {
  sandbox = await sandcastle.createSandbox({
    sandbox: docker({ containerUid: 0, containerGid: 0 }),
    ...spec,
  });
  const container = await findContainer(sandbox.worktreePath);
  exitCode = await runInteractiveShell(container);
} finally {
  // Dispose first (removes container + throwaway worktree; preserves the
  // worktree only if dirty), THEN drop the branch now that nothing checks it out.
  if (sandbox) await sandbox.close();
  deleteDefaultBranch();
}

process.exit(exitCode);
