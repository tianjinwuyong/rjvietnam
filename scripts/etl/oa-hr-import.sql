-- OA -> public.employees import (2026-11-20)
--
-- Why this exists: the dev database's `employees` table was emptied, and the
-- authoritative roster lives in the running OA system, not in WMS and not in
-- the SMT database. OA's read model already carries everything the SMT
-- directory needs (`org_user` for identity, `employee_onboarding` for the HR
-- record: gender, birth date, id card, emergency contact, hire date).
--
-- Atomic: BEGIN/COMMIT, and the verify block at the end aborts the whole
-- import if any row would break a downstream constraint.
-- Idempotent: guarded by employee_no (unique) so re-running inserts nothing.
--
-- Three constraint traps this handles explicitly:
--
--  1. `employees` is mirrored into `hr_employees` on every /api/hr request
--     (services/api/server.js, api.use("/hr")). That mirror writes
--     CASE ... ELSE 'U' for gender, but hr_employees_gender_check only allows
--     M/F -- one unmapped value takes the whole /api/hr router down with a 500.
--     OA stores Vietnamese labels ('Nữ'/'Nam') plus one legacy 'male', none of
--     which the CASE matches, so they are normalised here.
--
--  2. hr_employees.department_id is NOT NULL, so every imported person needs a
--     department. OA's org units do not share codes with the local ones (only
--     EN->ENG and PLAN->PMC match by name), so the mapping is stated as data.
--
--  3. The two status CHECK constraints intersect in exactly one value,
--     'active': employees allows inactive/leave/terminated/voided, hr_employees
--     allows probation/resigned/suspended/retired, and the mirror copies the
--     value through unchanged. All 39 people are active in OA, so this is not
--     a workaround -- but it is the only value that would ever be safe.
--
-- Deliberately excluded: org_user rows with no onboarding record. Those are
-- `admin` and `wms_bot` (both is_system = true) -- accounts, not people. They
-- stay in `users` and are not employees, which also avoids inventing a gender.

BEGIN;

-- ── 0. the one OA unit that has no local counterpart ───────────────────
-- FIN 财务 owns 1 person. Every other unit maps onto an existing department.
INSERT INTO public.departments (code, name_zh, name_en, name_vi, department_type, status, dept_type)
VALUES ('FIN', '财务部', 'Finance', 'Tài chính', 'support', 'active', 'general')
ON CONFLICT (code) DO NOTHING;

-- ── 1. employees from the OA roster + OA onboarding record ─────────────
WITH dept_map(oa_dept_id, local_code) AS (VALUES
    (  2::bigint, 'IQC'),      -- 质量管理部  -> 品质部
    (  6::bigint, 'ENG'),      -- 工程部      -> 工程部
    (  7::bigint, 'WH'),       -- 供应链管理部 -> 仓库部
    (  8::bigint, 'SMT'),      -- 制造部      -> SMT 生产部
    (  9::bigint, 'MGMT'),     -- 总经办      -> 管理层
    (571::bigint, 'SMT'),      -- SMT   (child of 制造部)
    (572::bigint, 'SMT'),      -- Assy  (child of 制造部)
    (573::bigint, 'DEP-HR'),   -- 人力资源部
    (574::bigint, 'PMC'),      -- 计划部
    (577::bigint, 'FIN')       -- 财务 (created above)
),
src AS (
  SELECT
    u.employee_no,
    u.id                                                    AS oa_user_id,
    u.real_name,
    u.email,
    u.phone,
    u.organization,
    u.department_id                                         AS oa_dept_id,
    dm.local_code,
    o.gender                                                AS raw_gender,
    o.birth_date,
    o.id_card_no,
    o.emergency_contact,
    o.emergency_phone,
    COALESCE(o.hire_date, u.hire_date)                      AS hire_date,
    lu.id                                                   AS local_user_id,
    -- OA's own position codes (pos_3o0gcs, qc, team_lead, ...) are internal to
    -- OA and share no vocabulary with the local positions.code set, so
    -- position_id stays NULL. The hr_employees mirror has an explicit
    -- COALESCE(..., '未分配岗位') fallback for exactly this case.
    NULL::bigint                                            AS position_id
  FROM oa.org_user u
  -- inner join: only people who actually have an HR onboarding record
  JOIN oa.employee_onboarding o ON o.employee_no = u.employee_no
  JOIN dept_map dm ON dm.oa_dept_id = u.department_id
  LEFT JOIN public.users lu ON lu.username = u.username
  WHERE u.employee_no IS NOT NULL
),
norm AS (
  SELECT s.*,
    CASE lower(s.raw_gender)
      WHEN 'nữ'     THEN 'F' WHEN 'nu'     THEN 'F'
      WHEN '女'     THEN 'F' WHEN 'female' THEN 'F' WHEN 'f' THEN 'F'
      WHEN 'nam'    THEN 'M' WHEN '男'     THEN 'M'
      WHEN 'male'   THEN 'M' WHEN 'm'      THEN 'M'
      ELSE NULL
    END AS gender_code,
    lower(COALESCE(s.raw_gender, '')) AS raw_gender_lc
  FROM src s
)
INSERT INTO public.employees (
  employee_no, code, user_id, department_id, position_id,
  full_name, full_name_zh, full_name_en, full_name_vi,
  name_zh, name_en, name_vi, display_name,
  gender, date_of_birth, phone, email, id_card_no,
  emergency_contact, emergency_phone,
  employment_type, hire_date, status, work_location,
  created_at, updated_at
)
SELECT
  n.employee_no,
  n.employee_no,
  n.local_user_id,
  d.id,
  n.position_id,
  -- full_name, full_name_zh, full_name_en, full_name_vi,
  -- name_zh, name_en, name_vi, display_name
  n.real_name, n.real_name, n.real_name, n.real_name,
  n.real_name, n.real_name, n.real_name, n.real_name,
  -- gender
  n.gender_code,
  n.birth_date, n.phone, n.email, n.id_card_no,
  n.emergency_contact, n.emergency_phone,
  'full_time',
  n.hire_date,
  'active',
  n.organization,
  now(), now()
FROM norm n
JOIN public.departments d ON d.code = n.local_code
WHERE NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.employee_no = n.employee_no);

-- ── 2. keep the id sequence ahead of the imported rows ─────────────────
SELECT setval(
  pg_get_serial_sequence('public.employees', 'id'),
  GREATEST(1, (SELECT coalesce(max(id), 0) FROM public.employees)),
  true
);

-- ── 3. verify: abort unless every row survives the hr_employees mirror ──
DO $$
DECLARE
  bad_gender   INT;
  bad_dept     INT;
  bad_status   INT;
  bad_hire     INT;
  bad_names    INT;
  total        INT;
  problems     text := '';
BEGIN
  SELECT count(*) INTO total FROM public.employees;

  SELECT count(*) INTO bad_gender FROM public.employees
    WHERE gender IS NULL OR gender NOT IN ('M','F');
  IF bad_gender > 0 THEN problems := problems || format(' gender_not_MF(%s)', bad_gender); END IF;

  SELECT count(*) INTO bad_dept FROM public.employees
    WHERE department_id IS NULL
       OR (department_id IS NOT NULL AND NOT EXISTS
            (SELECT 1 FROM public.departments d WHERE d.id = employees.department_id));
  IF bad_dept > 0 THEN problems := problems || format(' department_missing(%s)', bad_dept); END IF;

  -- the mirror copies status straight through; only 'active' satisfies both
  -- employees_status_check and hr_employees_status_check
  SELECT count(*) INTO bad_status FROM public.employees
    WHERE status <> 'active';
  IF bad_status > 0 THEN problems := problems || format(' status_not_active(%s)', bad_status); END IF;

  SELECT count(*) INTO bad_hire FROM public.employees WHERE hire_date IS NULL;
  IF bad_hire > 0 THEN problems := problems || format(' hire_date_null(%s)', bad_hire); END IF;

  SELECT count(*) INTO bad_names FROM public.employees
    WHERE full_name IS NULL OR employee_no IS NULL;
  IF bad_names > 0 THEN problems := problems || format(' name_or_no_null(%s)', bad_names); END IF;

  IF total < 39 THEN problems := problems || format(' expected_at_least_39(got %s)', total); END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'OA HR IMPORT REJECTED:%', problems;
  END IF;

  RAISE NOTICE 'OA HR IMPORT OK: employees=% (M:%, F:%)',
    total,
    (SELECT count(*) FROM public.employees WHERE gender = 'M'),
    (SELECT count(*) FROM public.employees WHERE gender = 'F');
END $$;

COMMIT;
