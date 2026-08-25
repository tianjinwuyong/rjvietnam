import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/smart-shelf-hardware.test.ts"], testTimeout: 12_000 },
});
