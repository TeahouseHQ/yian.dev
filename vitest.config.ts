import { defineConfig } from "vitest/config";
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
  },
  resolve: {
    alias: {
      "#": path.resolve(__dirname, "."),
      types: path.resolve(__dirname, "./@types"),
    },
  },
});
