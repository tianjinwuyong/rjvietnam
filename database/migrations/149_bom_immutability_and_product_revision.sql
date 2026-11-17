CREATE OR REPLACE FUNCTION enforce_bom_line_draft_only()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_bom_id bigint; v_status varchar(20);
BEGIN
  v_bom_id=COALESCE(NEW.bom_id,OLD.bom_id);
  SELECT status INTO v_status FROM boms WHERE id=v_bom_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft BOM lines can be changed; create a new revision';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_bom_lines_draft_only ON bom_lines;
CREATE TRIGGER trg_bom_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON bom_lines
FOR EACH ROW EXECUTE FUNCTION enforce_bom_line_draft_only();

CREATE OR REPLACE FUNCTION prevent_non_draft_bom_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Only draft BOM can be deleted'; END IF;
  IF EXISTS(SELECT 1 FROM work_orders WHERE bom_id=OLD.id) THEN RAISE EXCEPTION 'BOM is referenced by work orders'; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_bom_delete_draft_only ON boms;
CREATE TRIGGER trg_bom_delete_draft_only BEFORE DELETE ON boms
FOR EACH ROW EXECUTE FUNCTION prevent_non_draft_bom_delete();
