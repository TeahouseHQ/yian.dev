#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const hooks = ["pre-commit", "pre-push"];
const gitDir = path.resolve(__dirname, "..", ".git");

// In a git worktree (or submodule), `.git` is a FILE pointing at the real
// gitdir under the main repo's `.git/worktrees/<name>`, not a directory. Our
// `.git/hooks/<hook>` -> `../../scripts/<hook>` linking only makes sense for a
// primary checkout, and worktrees share the main repo's hooks regardless, so
// there is nothing to do here. Bail out cleanly instead of crashing trying to
// mkdir/symlink under a file.
if (!fs.statSync(gitDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.log("skipping git hook linking: not a primary git checkout (worktree/submodule)");
  process.exit(0);
}

const hooksDir = path.join(gitDir, "hooks");

if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

for (const hook of hooks) {
  const target = path.join(hooksDir, hook);
  const link = path.join("..", "..", "scripts", hook);

  // Remove stale hook (file or symlink)
  if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
    fs.unlinkSync(target);
  }

  fs.symlinkSync(link, target);
  console.log(`linked ${hook} -> scripts/${hook}`);
}
