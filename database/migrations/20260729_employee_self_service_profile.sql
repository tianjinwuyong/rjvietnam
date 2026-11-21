ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS emergency_contact varchar(120),
  ADD COLUMN IF NOT EXISTS emergency_phone varchar(40),
  ADD COLUMN IF NOT EXISTS avatar_url text;
