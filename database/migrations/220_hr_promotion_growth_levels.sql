-- Employee growth ladder used by HR promotion-appraisal documentation.
-- Level 1 is entry/developing and Level 4 is the highest level.

ALTER TABLE performance_reviews
  ADD COLUMN IF NOT EXISTS promotion_recommendation_level smallint,
  ADD COLUMN IF NOT EXISTS promotion_documented_at timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_documented_by bigint REFERENCES employees(id);

ALTER TABLE performance_reviews
  DROP CONSTRAINT IF EXISTS chk_performance_reviews_promotion_level;

ALTER TABLE performance_reviews
  ADD CONSTRAINT chk_performance_reviews_promotion_level
  CHECK (promotion_recommendation_level IS NULL OR promotion_recommendation_level BETWEEN 1 AND 4);

CREATE INDEX IF NOT EXISTS idx_perf_reviews_promotion_level
  ON performance_reviews (promotion_recommendation_level)
  WHERE promotion_recommendation_level IS NOT NULL;
