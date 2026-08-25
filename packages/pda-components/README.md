# PDA Component Reservoir

Shared, headless PDA modules for SMT, WMS, MES, quality, and maintenance applications.

The PDA is a thin edge client. It captures facts and executes decisions; MES/WMS owns work-order authority, inventory truth, Product Gate decisions, NG state, repair policy, permissions, and closure.

There is **one APK**. MES assigns a versioned `PdaProfile` after login/device registration. The profile enables only the modules and permissions needed by that operator and device; it does not create another application binary.

## Composition

```ts
const runtime = createPdaRuntime({ context, plugins, auditSink });
const result = await runtime.execute("scanner.scan", { rawValue });
```

Every module has the same lifecycle: `initialize`, `execute`, `health`, and `dispose`. The runtime supplies station/device/operator context, adds trace IDs, blocks duplicate registrations, and writes a common audit envelope.

The scanner accepts international barcode text: Unicode NFKC normalization, scanner framing/control-character removal, whitespace folding, and locale-safe upper-casing preserve non-Latin identifiers. Optional `duplicateCheck` and `ngCheck` policy adapters are consulted before a scan is captured; adapter failures fail closed with a retryable `SCANNER_GATE_UNAVAILABLE` result. A held scan can be retried through `scanner.recover` using its normalized value. Recovery is local-only and does not bypass MES duplicate or NG decisions.

The first production profile is intentionally narrow: material loading scans `machine → channel → feeder → material`, then MES validates the four-way match and records the confirmed loading. For the manual-line profile, material consumption is reported separately to the manual-line MES process as an immutable usage fact; it is not posted to the SMT consumption process. Other PDA workflows remain deferred until required.

## Initial certified modules

| Module | Responsibility | Authority |
|---|---|---|
| `scanner` | Normalize scans, validate patterns, suppress accidental duplicates | PDA capture policy |
| `product-gate` | Request route/NG/work-order/binding decision | MES |
| `auth` | Establish operator session and request action authorization | MES/Identity |
| `alarm` | Display only new immutable alarms; acknowledge/silence/resolve | MES |
| `language` | One active zh-CN/en-US/vi-VN locale with missing-key detection | Versioned config |
| `sync` | Heartbeat, configuration pull, bounded outbox retry | MES/WMS |

Receiving, placement, issue/consumption, cycle count, IQC evidence, printing, and diagnostics plug into the same interface next.

## Safety

- A transport failure never becomes `ALLOW`.
- Privileged actions require an identified operator and server authorization.
- Historical alarms never replay as new alarms.
- Every production mutation requires an idempotency key and an audit record.
- A manual-line usage module rejects any profile whose process domain is not exactly `manual-line`; there is no cross-domain fallback.
- Tests use adapters and must not write production data.
