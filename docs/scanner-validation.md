# Scanner capture staging validation

Scope: staging fixtures only. These checks do not write to MES, PostgreSQL, SQLite, Excel, or remote stations.

## Automated evidence

Run:

```powershell
npx vitest run packages/pda-components/src/plugins/scanner.test.ts apps/station-agent/src/useBarcodeCapture.test.ts
```

The cases cover:

- NFKC normalization, scanner framing removal, Vietnamese/Latin text, and preserved CJK/symbol identifiers.
- Automatic local-window and MES duplicate holds.
- Automatic confirmed-NG rejection.
- Gate-unavailable hold and explicit retry/recovery.
- Global capture when focus is on the page or a non-editable control.
- Manual/fallback typing isolation for input, textarea, select, and contenteditable controls.
- A dedicated input can opt into global scanner capture with `data-scanner-capture="true"`.

## Repeatable browser check

1. Open the staging station-agent and place focus on the page background or a button.
2. Scan `sn-staging-001` with the scanner configured to append Enter. Confirm one normalized `SN-STAGING-001` result is processed.
3. Scan the same code again inside the configured duplicate window. Confirm the duplicate hold appears automatically.
4. Scan a staging fixture configured as confirmed NG. Confirm the NG rejection appears automatically and no success event is recorded.
5. Focus a normal text input and type `Linh kiện-01`. Confirm the field retains the typed text and no automatic scan result fires.
6. Focus an input marked `data-scanner-capture="true"` and scan a code. Confirm global capture still fires.
7. Simulate the duplicate/NG gate being unavailable, scan once, restore the gate, and retry. Confirm the pending scan recovers exactly once.

Expected safety behavior: editable controls are manual-entry boundaries unless explicitly marked as scanner capture fields. This prevents ordinary international keyboard input from being misclassified as a production scan.
