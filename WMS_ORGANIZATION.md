# WMS management organization

## Operating model

Use a small human team supported by virtual employees and exception-based approvals. Normal material flow should be automatic; supervisors intervene only for quantity differences, major defects, tightened/reduced inspection changes, exemptions, rejection, or MRB.

## Human organization

- Factory director
  - Warehouse and quality supervisor (1 shared supervisor)
    - Warehouse general operator (1–2 per shift)
      - Receive and scan physical material.
      - Verify actual quantity.
      - Print and attach box QR labels.
      - Bind warehouse position and put away material.
      - Check MSL packaging and storage conditions.
    - IQC general inspector (1 per shift)
      - Execute dynamic IQC tasks on Unified PDA.
      - Complete the required sample quantity.
      - Capture visual evidence and defect photos.
      - Record real PASS/FAIL measurements and defect quantities.
    - Exception approval
      - Warehouse supervisor: inventory, location and quantity differences.
      - Quality supervisor: tightened/reduced inspection, exemption, rejection and MRB.

## Virtual employees

### WMS-RECEIVING-VIRTUAL-01

- Monitor open purchase orders and supplier pre-receiving data.
- Validate supplier, material, SN, PO and quantity.
- Resolve Ruijing/Vietnam material identity and MSL.
- Generate box QR and printing tasks.
- Recommend compatible locations and check capacity/mixing risk.
- Create the IQC task after receiving evidence is complete.

### IQC-VIRTUAL-01

- Monitor unfinished IQC tasks without requiring a browser.
- Read PO, receiving data, supplier/material history and ACTIVE Excel guidance.
- Use standard inspection when no history exists.
- Calculate sample size and Ac/Re from approved Excel rules.
- Recommend normal, tightened or reduced inspection from history and risk.
- Generate task-level dynamic inspection items for Unified PDA.
- Validate PDA evidence and preserve calculation/correction trace.
- Never fabricate evidence or approve exemptions.

### Moisture-control rules engine

- Monitor MSL, seal/open time, floor life, HIC, vacuum packaging and baking history.
- Warn and block affected inventory according to approved rules.

## Minimum staffing

- 1 warehouse general operator per shift.
- 1 IQC general inspector per shift.
- 1 shared warehouse/quality supervisor for exceptions.

## Authority boundaries

- Receiving operators cannot approve IQC PASS.
- IQC inspectors cannot modify inventory quantities.
- Virtual employees cannot invent measurements or approve exemptions.
- Exemption and major quality decisions require authorized human approval.
- Every automated recommendation, manual correction and final decision must remain auditable.

## Unified PDA convention

Unified PDA is the Kotlin Android application at `C:\Users\tianj\Desktop\越南工厂瑞晶\统一PDA管理\unifiedpda`. WMS generates dynamic IQC tasks; Unified PDA executes scans, sample progress, visual inspection, photos, defect capture and result synchronization.
