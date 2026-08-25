# Repair station integration graph

The repair station is a fact collector and command client. MES owns decisions and
the immutable event ledger; WMS and QMS remain bounded domain systems.

```mermaid
flowchart LR
  SN[Product SN / repair work order]
  RS[Repair station UI]
  MES[MES authority\nroute · retest · disposition]
  WMS[WMS\nlot / IQC / quantity]
  QMS[QMS\nNG case / evidence]
  LEDGER[(Append-only station event ledger)]
  PDA[Team leader / line manager PDA]

  SN --> RS
  RS -->|read context| MES
  RS -->|read lot facts| WMS
  RS -->|read NG case| QMS
  RS -->|command envelope| LEDGER
  LEDGER --> MES
  MES -->|authorized route and retest| RS
  MES -->|pickup / Andon| PDA
  WMS -->|validated material fact| MES
  QMS -->|quality decision| MES
```

## Command boundary

The station may append `REPAIR_STARTED`, `MATERIAL_USAGE_RECORDED`,
`QMS_EVIDENCE_ATTACHED`, and `RETEST_REQUESTED`. Each command has an `eventId`,
operator, station, SN, timestamp, and `authority: MES`. The station cannot
change a route, increase retests, release, scrap, or delete history.

The `/api/repair-station/context` response deliberately reports per-domain
availability and does not substitute demo data when WMS or QMS is unavailable.
