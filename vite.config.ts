/**
 * Vite + Vitest configuration.
 *
 * - Tests run in jsdom so UI modules can be tested without a real browser.
 * - `globals: true` lets tests use describe/it/expect without importing them.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
