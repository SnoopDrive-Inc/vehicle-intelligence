-- Add columns to track PDF year mismatches
-- When manual-directory.com lists a 2025 manual but the actual PDF is from 2022

ALTER TABLE vehicle_manuals
ADD COLUMN IF NOT EXISTS pdf_year INTEGER,
ADD COLUMN IF NOT EXISTS year_mismatch BOOLEAN DEFAULT FALSE;

-- Add index for finding mismatched manuals
CREATE INDEX IF NOT EXISTS idx_vehicle_manuals_mismatch ON vehicle_manuals (year_mismatch) WHERE year_mismatch = TRUE;

COMMENT ON COLUMN vehicle_manuals.pdf_year IS 'Actual year extracted from PDF filename';
COMMENT ON COLUMN vehicle_manuals.year_mismatch IS 'True if pdf_year differs from listed year (placeholder manual)';
