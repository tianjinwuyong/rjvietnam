# Manual Line Downstream NG E2E Report

Test date: 2026-07-27  
MES: `192.168.6.155:8080`  
Station install/data directory: `D:\stations`  
Upstream active NG SN: `ASM152951105941L5`  
Upstream source: `manu_assem_ate`  
NG reason: `SIM_NG`

## Acceptance rule

1. An upstream station publishes NG to MES.
2. MES keeps the SN in the canonical active-NG registry.
3. Every downstream station refreshes its local active-NG cache.
4. Scanning the same SN must stop the station, show an NG warning, and append a local SQLite interception record.
5. Retest confirmation permits another test attempt only; it does not release NG.
6. Retest FAIL remains blocked.
7. Only an MES-authorized retest PASS may publish RELEASED and allow downstream passage.
8. NG and retest history remains immutable.

## Real station results

| IP | Station | Scanner port | Result | Local evidence |
|---|---|---:|---|---|
| 192.168.6.95 | Assembly ATE | 1007 | PASS | `CONFIRMED_NG`, source `manu_assem_ate` |
| 192.168.6.96 | Supersonic | 1008 | PASS | `CONFIRMED_NG`, source `manu_assem_ate` |
| 192.168.6.97 | Aging cabinet | 1009 | PASS | `CONFIRMED_NG`, source `manu_assem_ate` |
| 192.168.6.98 | High-voltage ATE | 1010 | PASS | `CONFIRMED_NG`, source `manu_assem_ate` |
| 192.168.6.99 | Packaging ATE | 1011 | PASS | Two persistent `CONFIRMED_NG` rows retrieved from `D:\stations\packing_ate_agent.db` |

## Defects found and repaired

- Frozen one-file EXEs previously placed SQLite under the temporary extraction directory. All five agents now persist beside the EXE in `D:\stations`.
- Retest mode previously bypassed the shared active-NG gate. That bypass was removed. Retest now bypasses only the duplicate/retest-attempt restriction; it cannot bypass an active upstream NG.
- Aging station 97 did not remain running after a diagnostic restart. It was redeployed, verified running, and passed a fresh NG scan test.

## Deployment verification

All five remote EXEs were backed up, replaced, hash-verified, started by their station tasks, and confirmed running. Remote hashes matched the local release candidates.

## Data cleanup

No synthetic production NG was inserted. The test reused an already-active upstream NG, so no production NG cleanup was required. Interception rows are retained as required audit evidence and were not deleted.

## Conclusion

PASS — the tested upstream NG was propagated through MES and blocked by every tested downstream manual-line station. A retest attempt alone cannot release the NG; only an MES-authorized PASS may release it.
