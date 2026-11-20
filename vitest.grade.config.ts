import { defineConfig } from "vitest/config";

// Grading subset of the suite -- the only files whose verdict may be used as a
// pass/fail signal (factory review, seeded-bug tasks, PR gates).
//
// Why a third config instead of reusing `test:unit`: `test:unit` is the *merge*
// gate, so it keeps source-text assertions that are cheap to run but dishonest to
// grade with. A file in `sourceTextOnly` below reaches its verdict by reading an
// implementation file and matching a regex, which means a solver can satisfy it by
// editing a string (reward hacking) and a refactor can break it while behaviour is
// unchanged. Graders must observe behaviour only: import the module, call it, assert
// on the returned value.
//
// Rule for this list: add a file only if it imports the code under test. If it needs
// a database or a running API it belongs in `*-live.test.ts` instead, not here.
const baseExclude = [
  "**/node_modules/**",
  "**/tests/e2e/**",
  "**/test-3d-*.spec.ts",
  "**/smart-shelf-hardware.test.ts",
  "**/smt-pda-immediate-test-bypass.test.mjs",
];

// Cannot be a grading signal: needs live PostgreSQL + a running API (skips itself
// when the env flags are unset, so it would grade 0 tests silently).
const liveOnly = ["**/*-live.test.ts", "tests/bom-live-import.test.ts"];

const sourceTextOnly = [
  "tests/bom-source-files.test.ts",
  "tests/qms-oqc-contract.test.ts",
  "tests/scanner-contract.test.ts",
  "tests/supplier-create-postgres-contract.test.ts",
  "tests/supplier-excel-only-management-contract.test.ts",
  "tests/supplier-master-155-to-122-replication-contract.test.ts",
  "tests/supplier-plant-manager-import-contract.test.ts",
  "tests/supplier-po-qr-registration-contract.test.ts",
  "tests/supplier-test-quick-login-contract.test.ts",
  "tests/wms-3d-security-contract.test.ts",
  "tests/wms-pda-3d-receiving-bridge.test.ts",
];

export default defineConfig({
  test: {
    exclude: [...baseExclude, ...liveOnly, ...sourceTextOnly],
  },
});
