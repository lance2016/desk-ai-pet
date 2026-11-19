import { defineConfig } from "vitest/config";

/**
 * `pnpm eval`: the model-behaviour regression set in `evals/`. It calls DeepSeek with a real key,
 * so it costs a little and the answers vary; it is run by hand, never by `pnpm test` or CI.
 */
export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    environment: "node",
    // Soft cases report how often they were right as a warning; show it even when they pass.
    silent: false,
    // The tools share one stubbed `window`, so the cases run one after another.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
  },
});
