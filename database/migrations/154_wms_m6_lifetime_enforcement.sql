-- M6: one canonical material-lifetime rule and enforceable isolation state.

ALTER TABLE material_lots
  ADD COLUMN IF NOT EXISTS lifecycle_status varchar(30) NOT NULL DEFAULT 'NORMAL';
ALTER TABLE material_lots
  ADD COLUMN IF NOT EXISTS lifecycle_isolated_at timestamptz;
ALTER TABLE material_lots
  ADD COLUMN IF NOT EXISTS lifecycle_policy_id bigint REFERENCES material_lifetime_policies(id);

CREATE OR REPLACE FUNCTION wms_effective_lot_expiry(p_lot_id bigint)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN ml.opened_at IS NOT NULL AND ml.opened_shelf_life_days IS NOT NULL
      THEN ml.opened_at + make_interval(days => ml.opened_shelf_life_days::int)
    ELSE ml.expiry_date::timestamptz
  END
  FROM material_lots ml WHERE ml.id=p_lot_id
$$;

CREATE OR REPLACE FUNCTION wms_refresh_material_lifecycle()
RETURNS TABLE(isolated_count integer, warning_count integer)
LANGUAGE plpgsql AS $$
DECLARE v_isolated integer := 0; v_warning integer := 0;
BEGIN
  WITH changed AS (
    UPDATE material_lots ml
       SET lifecycle_status='EXPIRED_ISOLATED',
           lifecycle_isolated_at=COALESCE(lifecycle_isolated_at,now())
     WHERE ml.voided_at IS NULL
       AND ml.received_qty > 0
       AND wms_effective_lot_expiry(ml.id) < CURRENT_DATE
       AND ml.lifecycle_status <> 'EXPIRED_ISOLATED'
    RETURNING ml.id
  ) SELECT count(*) INTO v_isolated FROM changed;

  INSERT INTO material_lifecycle_status_history
    (material_lot_id,event_type,old_status,new_status,source_type,source_id,days_remaining,notes)
  SELECT ml.id,'EXPIRED','NORMAL','EXPIRED_ISOLATED','SYSTEM','M6_LIFECYCLE_CLASSIFIER',
         floor(extract(epoch from (wms_effective_lot_expiry(ml.id)-now()))/86400)::integer,
         'Automatically isolated by canonical effective-expiry rule'
    FROM material_lots ml
   WHERE ml.lifecycle_isolated_at >= now()-interval '5 seconds'
     AND NOT EXISTS (SELECT 1 FROM material_lifecycle_status_history h
                     WHERE h.material_lot_id=ml.id AND h.source_id='M6_LIFECYCLE_CLASSIFIER'
                       AND h.new_status='EXPIRED_ISOLATED');

  WITH classified AS (
    UPDATE material_lots ml
       SET lifecycle_status=CASE
         WHEN wms_effective_lot_expiry(ml.id) IS NULL THEN 'NORMAL'
         WHEN wms_effective_lot_expiry(ml.id) < CURRENT_DATE THEN 'EXPIRED_ISOLATED'
         WHEN wms_effective_lot_expiry(ml.id) <= now()+interval '30 days' THEN 'WARNING_LEVEL_1'
         WHEN wms_effective_lot_expiry(ml.id) <= now()+interval '60 days' THEN 'WARNING_LEVEL_2'
         ELSE 'NORMAL' END
     WHERE ml.voided_at IS NULL AND ml.lifecycle_status <> 'EXPIRED_ISOLATED'
    RETURNING lifecycle_status
  ) SELECT count(*) FILTER (WHERE lifecycle_status LIKE 'WARNING_%') INTO v_warning FROM classified;
  RETURN QUERY SELECT v_isolated,v_warning;
END $$;

CREATE OR REPLACE FUNCTION set_expiry_from_material()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_policy material_lifetime_policies%ROWTYPE;
BEGIN
  IF NEW.expiry_date IS NULL THEN
    SELECT lp.* INTO v_policy
      FROM material_lifetime_policies lp
      JOIN materials m ON m.id=NEW.material_id
     WHERE lp.status='ACTIVE'
       AND lp.effective_from<=COALESCE(NEW.received_at::date,current_date)
       AND (lp.effective_to IS NULL OR lp.effective_to>=COALESCE(NEW.received_at::date,current_date))
       AND (lp.material_id=NEW.material_id OR
            (lp.material_id IS NULL AND lp.category_id=m.category_id) OR
            lp.policy_code='DEFAULT-ELECTRONIC-COMPONENT')
     ORDER BY (lp.material_id IS NOT NULL) DESC,(lp.category_id IS NOT NULL) DESC
     LIMIT 1;
    NEW.lifecycle_policy_id := v_policy.id;
    IF v_policy.sealed_shelf_life_months IS NOT NULL THEN
      NEW.expiry_date := (COALESCE(NEW.manufacturing_date,NEW.received_at::date,current_date)
                          + make_interval(months=>v_policy.sealed_shelf_life_months))::date;
    ELSE
      SELECT (COALESCE(NEW.manufacturing_date,NEW.received_at::date,current_date)
              + make_interval(days=>m.shelf_life_days))::date
        INTO NEW.expiry_date FROM materials m WHERE m.id=NEW.material_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE INDEX IF NOT EXISTS idx_material_lots_lifecycle_status
  ON material_lots(lifecycle_status,lifecycle_isolated_at);

SELECT * FROM wms_refresh_material_lifecycle();
