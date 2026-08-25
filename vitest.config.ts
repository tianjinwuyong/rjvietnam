import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/tests/e2e/**", "**/test-3d-*.spec.ts", "**/smart-shelf-hardware.test.ts", "**/smt-pda-immediate-test-bypass.test.mjs"],
  },
});
