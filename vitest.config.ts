import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
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
