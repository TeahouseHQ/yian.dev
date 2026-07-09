import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  oxc: {
    // tsconfig sets jsx: "preserve" for Next.js, which vite/oxc cannot
    // execute directly. Tell oxc to transform TSX with the automatic
    // runtime so vitest can import .tsx modules and test files.
    jsx: { runtime: "automatic" },
  },
  test: {
    // Use node environment
    environment: "node",
    // Sandcastle worktrees are full repo checkouts nested under a dot
    // directory; vitest's default excludes don't skip dot directories
    // generically, so without this their test files run twice.
    exclude: [...configDefaults.exclude, "**/.sandcastle/worktrees/**"],
  },
  resolve: {
    alias: {
      "#": path.resolve(__dirname, "."),
      types: path.resolve(__dirname, "./@types"),
    },
  },
});
