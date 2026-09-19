import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests run in Node (our track/intensity utils are pure TS — no DOM/THREE).
// The `@` alias mirrors vite.config.ts so imports resolve identically in tests.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});