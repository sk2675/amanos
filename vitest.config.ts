import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["site/**", "node_modules/**", "dist/**"],
  },
});
