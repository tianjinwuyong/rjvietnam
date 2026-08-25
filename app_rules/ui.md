# UI Rules

## Owns

- `apps/web`
- `apps/scanner-terminal`
- `apps/display-board`
- UI design docs under `docs/`

## May edit

- frontend components
- UI styles
- screen navigation
- local demo data only when needed for shell work

## Must not edit

- database migrations
- backend auth logic
- backend API contracts unless the UI contract forces a note

## Required rules

1. Build practical factory screens first, not marketing pages.
2. Keep barcode-first workflows fast and dense.
3. Use shared contracts for screen data instead of hardcoded assumptions.
4. Keep language support and layout stability part of the baseline.
5. Separate each major surface into its own runtime port.
6. Follow the UI foundation doc for color, locale, and status meaning.
7. Render one active locale per page and switch the rendered language with the global language switch.
8. Do not show all three languages on the same page.

## Warning rules

1. Use warnings for actionable risk, not decorative emphasis.
2. Show the reason for the warning in plain language.
3. Keep warning colors consistent with the shared status meaning.
4. Use `warning` for pending or at-risk states, `danger` for blocked or failed states.
5. Do not stack multiple warnings when one clear warning is enough.
6. Put the warning near the affected control, queue, or record.
7. Use audit or trace references when a warning depends on a transaction history.

## Tooltip rules

1. Add tooltips for all buttons, inputs, status indicators, icons, and non-obvious controls.
2. Tooltips must explain what the control does, not repeat the label only.
3. Keep tooltip text short, direct, and translated in the active locale.
4. Use tooltips to clarify abbreviations, icons, warnings, and machine or code fields.
5. Do not use tooltips to hide essential information that should already be visible.
6. Make tooltips available on hover and focus where the UI supports it.
7. Use the same tooltip meaning for the same control across all pages.
8. If a control is disabled or blocked, its tooltip should explain the reason.

## Required checks

- Verify text fits in the target layout for zh-CN, en-US, and vi-VN.
- Keep the first screen useful.
- Avoid introducing UI patterns that depend on backend data you do not own.
- Ensure the same status color means the same thing across all screens.
- Confirm the language switch changes the visible page copy instead of stacking translations together.
- Confirm warnings are actionable, specific, and tied to the affected record or control.
- Confirm every meaningful control has a tooltip in the active locale.

## Handoff

- When a screen needs a new field or endpoint, record the dependency in the data-contract or API lane instead of fabricating it in the UI.
