# Work Order Coding Rule

Source rule: `dc/宸ュ崟缂栫爜瑙勫垯.doc`

## Current Rule

Format:

```text
YY + MM + work_order_type + line_code + serial_no
```

Total length: 11 digits.

## Table Support

The database supports the coding rule with:
- `work_order_serial_counters` for the monthly sequence per year, month, work order type, and 2-digit line code
- `work_orders.code` with a numeric 11-digit check constraint
- `production_lines.numeric_line_code` as the source of the 2-digit line code

The sequence row should be reserved and incremented transactionally so the same code is never generated twice.

## Field Definition

| Field | Length | Example | Description |
| --- | ---: | --- | --- |
| YY | 2 | 26 | Last two digits of year |
| MM | 2 | 06 | Month, 01-12 |
| work_order_type | 1 | 1 | 1 mass production, 2 sample/trial, 3 rework/repair |
| line_code | 2 | 01 | Physical line code |
| serial_no | 4 | 0002 | Monthly sequence for same type and line |

## Examples

| Code | Meaning |
| --- | --- |
| 26061010002 | 2026-06, mass production, SMT-01, serial 0002 |
| 26061020005 | 2026-06, mass production, line 02, serial 0005 |
| 26062010001 | 2026-06, sample/trial, SMT-01, serial 0001 |
| 26063990003 | 2026-06, rework/repair, line 99, serial 0003 |

## Rule Notes

- Codes are numeric only.
- Do not include customer, product model, day-of-month, or symbols.
- Serial number resets by month, work order type, and line.
- Voided work order codes are kept and never reused.
- Emergency orders use the next available serial number.

## Open Issue

The source document says line code is fixed to 2 digits, but one table shows values like `L001`, `L002`, `L003`, `L004`. For the system, use the 2-digit numeric line code for work order code generation and keep `L001` style codes only as internal line master data if needed.
