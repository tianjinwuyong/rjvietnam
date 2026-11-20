-- 1. Create standard item library table
CREATE TABLE IF NOT EXISTS iqc_standard_item (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    section_type varchar(30) NOT NULL,
    item_name varchar(300) NOT NULL,
    item_name_vi varchar(300),
    item_name_en varchar(300),
    standard text,
    standard_vi text,
    standard_en text,
    spc varchar(50),
    lsl varchar(100),
    usl varchar(100),
    unit varchar(20),
    sampling_plan_text varchar(100),
    sample_size integer,
    ac integer,
    re integer,
    sort_order integer DEFAULT 0,
    is_required boolean DEFAULT true,
    _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _created_by user_profile,
    _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    _updated_by user_profile
);
CREATE INDEX IF NOT EXISTS idx_iqc_std_item_section ON iqc_standard_item(section_type);

-- 2. Add selected_sections column to iqc_template
ALTER TABLE iqc_template ADD COLUMN IF NOT EXISTS selected_sections varchar(30)[] DEFAULT '{}';

-- 3. Backfill selected_sections for existing templates based on their items
UPDATE iqc_template t
SET selected_sections = ARRAY(
    SELECT DISTINCT section_type FROM iqc_template_item WHERE template_id = t.id
)
WHERE t.selected_sections IS NULL OR t.selected_sections = '{}';
