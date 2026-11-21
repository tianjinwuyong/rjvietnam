-- 076: Allow plant-manager exception authorization windows up to two days.
ALTER TABLE mes_plant_manager_authorizations
  DROP CONSTRAINT IF EXISTS mes_plant_manager_authorizations_valid_until_check;
ALTER TABLE mes_plant_manager_authorizations
  ADD CONSTRAINT mes_plant_manager_authorizations_valid_until_check
  CHECK (valid_until > valid_from AND valid_until <= valid_from + INTERVAL '48 hours');
