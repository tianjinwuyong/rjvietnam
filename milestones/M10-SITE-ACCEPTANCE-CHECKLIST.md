# M10 site acceptance checklist

These checks require the real factory device or network and cannot be truthfully certified by a software-only local run.

## USB scanner — each commissioned station

- Scan one known-good SN: guard result appears, no new SN-master/registry record is created.
- Scan one active confirmed-NG SN: station blocks and sound/light alarm activates.
- Scan one duplicate SN: station blocks and duplicate alarm activates.
- Scan one out-of-sequence SN: MES returns `OUT_OF_SEQUENCE`; 3D displays but does not perform the lock.
- Disconnect MES: scan is blocked with guard-unavailable status; it is never treated as PASS.
- Reconnect MES and repeat: normal guard decision returns.

Record station code, device ID, operator, SN, time, expected result, actual result and evidence photo.

## Physical 20-minute interruption

- Record central event count and last acknowledged cursor.
- Disconnect the pilot station network for 20 minutes while controlled events enter its local queue.
- Reconnect without clearing local data.
- Verify every event is acknowledged exactly once and the cursor advances.
- Verify conflicting payloads are quarantined and require `wms.sync.manage` approval.

## Three-language visual acceptance

- Open the same WMS account in two browsers.
- Check Chinese, Vietnamese and English for every canonical WMS menu group.
- Check loading, empty, error, offline and retry states.
- Confirm the two browsers show the same authoritative counts.
- Confirm no menu displays a translation key or demo/mock label.

## Sign-off

Required: warehouse lead, quality lead, MES administrator and factory IT. Attach scanner records, network timestamps and browser screenshots to the M10 acceptance report.
