-- Migration: 052_fix_wo_bom_linkage.sql
-- Problem: Work orders 26061010008 and 26061020008 reference product PCBA-AURORA-CTRL
--          which has no active BOM. GET /mes/work-order-requirements returns empty.
-- Fix:    Re-link WOs to products that have active BOMs.
--          26061010008 (L001) → B2672111-001 (BOM V0.5, ~80 lines)
--          26061020008 (L002) → EPS18R1G    (BOM V1.5, ~120 lines)

BEGIN;

-- Verify current state (should show PCBA-AURORA-CTRL or NULL)
SELECT wo.code, p.code AS product_code, b.id AS current_bom_id, b.status AS bom_status
FROM work_orders wo
JOIN products p ON p.id = wo.product_id
LEFT JOIN boms b ON b.id = wo.bom_id
WHERE wo.code IN ('26061010008', '26061020008');

-- Fix 26061010008 → product with active BOM
UPDATE work_orders
SET product_id = (SELECT id FROM products WHERE code = 'B2672111-001' LIMIT 1),
    bom_id     = (SELECT id FROM boms WHERE product_id = (SELECT id FROM products WHERE code = 'B2672111-001' LIMIT 1) AND status = 'active' LIMIT 1)
WHERE code = '26061010008';

-- Fix 26061020008 → product with active BOM
UPDATE work_orders
SET product_id = (SELECT id FROM products WHERE code = 'EPS18R1G' LIMIT 1),
    bom_id     = (SELECT id FROM boms WHERE product_id = (SELECT id FROM products WHERE code = 'EPS18R1G' LIMIT 1) AND status = 'active' LIMIT 1)
WHERE code = '26061020008';

-- Verify fix applied
SELECT wo.code, p.code AS product_code, b.id AS bom_id, b.revision, b.status AS bom_status
FROM work_orders wo
JOIN products p ON p.id = wo.product_id
LEFT JOIN boms b ON b.id = wo.bom_id
WHERE wo.code IN ('26061010008', '26061020008');

COMMIT;
