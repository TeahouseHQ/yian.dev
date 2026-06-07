#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const hooks = ["pre-commit", "pre-push"];
const gitDir = path.resolve(__dirname, "..", ".git");
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
