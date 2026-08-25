# MES Component Reservoir

Reusable station controls live in this folder. Station pages must import these components instead of copying their UI or MES request logic.

## StationScannerControl

Source: `StationScannerControl.tsx`

Purpose: standard scanner window for every production, inspection, binding, packaging, and maintenance station.

Built in behavior:

- scanner-focused SN input;
- Enter and on-screen SCAN submission;
- station-aware `SCAN_GUARD_CHECK` event;
- MES token forwarding;
- transfer and repair-return receipt handling;
- accepted and blocked feedback;
- Chinese, English, and Vietnamese labels;
- fixed-station mode or station-selector mode.

Fixed station example:

```tsx
<StationScannerControl stationCode="manu_assem_ate" locale={locale} />
```

Multi-station dashboard example:

```tsx
<StationScannerControl locale={locale} />
```

## Rules for reservoir components

1. Do not duplicate scanner request logic in a station page.
2. Pass the canonical MES station code.
3. Pass the active locale so labels remain international.
4. Add new reusable station controls here and document their contract before adoption.
5. Keep production results authoritative; UI components may request actions but must not invent real results.
