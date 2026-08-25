# UI Design

The web console is dashboard-first. After sign-in, the first screen is a usable operations dashboard, not a marketing page.

## Visual Definition

- Primary brand color: factory teal
- Secondary color: slate blue-gray
- Success: green
- Warning: amber
- Danger: red
- Backgrounds: light gray-blue surfaces with white content panels
- Borders: soft neutral gray
- Density: compact tables and cards, not spacious marketing layouts

## Language Definition

- Supported languages: `zh-CN`, `en-US`, `vi-VN`
- All visible UI text must use i18n keys
- Short operator labels should favor Vietnamese first when the active locale is `vi-VN`
- Management and customer-facing content should remain clear in English and Chinese
- No hard-coded user-facing labels in feature code
- Mixed-language screens are allowed only for technical codes, machine IDs, and business numbers

## Layout

- Left rail for module navigation and locale switching
- Top bar for the active module title and current context
- Main surface for dense operational panels and tables

## Shared Patterns

- Metric cards for plant-level status
- Scan-first inputs for WMS, MES, and traceability
- Status badges with consistent colors
- Tables for queue-based work and exception review
- Compact action buttons for common factory commands

## Main Surfaces

- Dashboard
- PMC work orders
- WMS receiving, inventory, pick, issue
- MES line execution and feeder binding
- Quality inspection and repair closure
- Traceability query
- Reports
- Admin and role control

## Dependency Note

The UI is designed around live auth, menu permission, and transaction APIs. Until those are connected, the web app should keep using demo data and clear status placeholders.
