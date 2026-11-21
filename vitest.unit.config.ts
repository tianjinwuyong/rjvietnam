import { defineConfig } from "vitest/config";

// Database-free subset of the suite -- this is what the factory gate runs.
//
// Why a separate config instead of `vitest run --exclude "**/*-live.test.ts"`:
// passing `--exclude` on the CLI REPLACES the array in vitest.config.ts, so the
// e2e / hardware / 3D exclusions silently disappear and the "unit" rung starts
// running browser specs. Duplicating the base list here keeps the split visible
// in one place; the two files must stay in sync.
const baseExclude = [
  "**/node_modules/**",
  "**/tests/e2e/**",
  "**/test-3d-*.spec.ts",
  "**/smart-shelf-hardware.test.ts",
  "**/smt-pda-immediate-test-bypass.test.mjs",
];

// These require a live PostgreSQL and a running API. They are real integration
// coverage, not junk -- they just cannot be a precondition for every merge.
const liveOnly = ["**/*-live.test.ts"];

export default defineConfig({
  test: {
    exclude: [...baseExclude, ...liveOnly],
  },
});
