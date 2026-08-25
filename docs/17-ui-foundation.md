# UI Foundation

This document defines the shared visual and language rules for the factory UI.

## Color System

| Token | Meaning | Use |
| --- | --- | --- |
| `brand` | factory teal | primary actions, active navigation, system identity |
| `surface` | light gray-blue | page background |
| `panel` | white | cards, tables, modal surfaces |
| `text` | dark slate | headings and primary copy |
| `muted` | gray slate | secondary copy and hints |
| `ok` | green | pass, released, running, available |
| `warning` | amber | hold, pending, changeover, watch |
| `danger` | red | fail, blocked, rejected, down |
| `info` | blue | trace, system info, neutral highlights |

Rules:

1. Use the same color for the same meaning everywhere.
2. Do not use color as the only indicator when text or badges are needed.
3. Keep the palette restrained and operational, not decorative.
4. Avoid random accent colors outside the approved tokens.

## Language System

Supported locales:

- `zh-CN`
- `en-US`
- `vi-VN`

Rules:

1. Every user-facing string must come from i18n keys.
2. Technical IDs, codes, machine names, and serials may remain untranslated.
3. Only one locale is rendered on a page at a time.
4. Operator screens should use short Vietnamese phrases when `vi-VN` is active.
5. Management views should remain understandable in English and Chinese.
6. Do not mix translated and hard-coded labels in the same control.
7. The language switch changes the visible locale, not the page structure.

## Density

- Use compact panels and tables for operations.
- Keep the first screen useful.
- Preserve scan-first workflows.
- Ensure long Chinese, English, and Vietnamese labels fit without overlap.

## Status Meaning

- Green means normal or complete.
- Amber means pending, waiting, or needs attention.
- Red means failed, blocked, or stopped.
- Blue means informational or trace-related.

## Warning Rules

1. Use warnings for actionable risk, not decoration.
2. Show the reason for the warning in plain language.
3. Keep warning colors consistent with the shared status meaning.
4. Use amber for pending or at-risk states.
5. Use red for blocked, failed, or stopped states.
6. Do not stack multiple warnings when one clear warning is enough.
7. Place the warning near the affected control, queue, or record.
8. If the warning depends on history, include the trace or audit reference.

## Tooltip Rules

1. Add tooltips for all buttons, inputs, status indicators, icons, and non-obvious controls.
2. Tooltips must explain what the control does, not just repeat the label.
3. Keep tooltip text short, direct, and translated in the active locale.
4. Use tooltips to clarify abbreviations, icons, warnings, and machine or code fields.
5. Do not use tooltips to hide essential information that should already be visible.
6. Make tooltips available on hover and focus where the UI supports it.
7. Use the same tooltip meaning for the same control across all pages.
8. If a control is disabled or blocked, its tooltip should explain the reason.
