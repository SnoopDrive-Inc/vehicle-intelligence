-- Vehicle Manuals table for storing owner's manual metadata and storage info
-- Scraped from manual-directory.com / gimmemanuals.com

-- Create vehicle_manuals table
CREATE TABLE IF NOT EXISTS vehicle_manuals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Vehicle identification (denormalized for performance)
    year INTEGER NOT NULL CHECK (year >= 1900 AND year <= 2100),
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    variant TEXT, -- e.g., "sedan", "coupe", "hatchback", "hybrid"

    -- Manual source info
    source_url TEXT NOT NULL, -- manual-directory.com page URL
    source_mid TEXT, -- manual-directory.com internal ID

    -- PDF info
    pdf_url TEXT NOT NULL, -- gimmemanuals.com PDF URL
    pdf_size_bytes BIGINT, -- File size in bytes
    pdf_storage_path TEXT, -- Supabase Storage path after upload

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'downloading', 'uploaded', 'failed', 'unavailable')),
    last_verified_at TIMESTAMPTZ,
    error_message TEXT,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint on vehicle + variant
    CONSTRAINT vehicle_manuals_unique UNIQUE (year, make, model, variant)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_vehicle_manuals_ymm ON vehicle_manuals (year, make, model);
CREATE INDEX IF NOT EXISTS idx_vehicle_manuals_make ON vehicle_manuals (make);
CREATE INDEX IF NOT EXISTS idx_vehicle_manuals_status ON vehicle_manuals (status);
CREATE INDEX IF NOT EXISTS idx_vehicle_manuals_year ON vehicle_manuals (year);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_vehicle_manuals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vehicle_manuals_updated_at ON vehicle_manuals;
CREATE TRIGGER vehicle_manuals_updated_at
    BEFORE UPDATE ON vehicle_manuals
    FOR EACH ROW
    EXECUTE FUNCTION update_vehicle_manuals_updated_at();

-- RLS policies (public read for vehicle manuals)
ALTER TABLE vehicle_manuals ENABLE ROW LEVEL SECURITY;

-- Allow public read access to manuals
CREATE POLICY "vehicle_manuals_public_read"
    ON vehicle_manuals
    FOR SELECT
    TO PUBLIC
    USING (true);

-- Only service role can modify
CREATE POLICY "vehicle_manuals_service_write"
    ON vehicle_manuals
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Create storage bucket for PDFs (if not exists)
-- Note: Run this in the Supabase dashboard or via API:
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('vehicle-manuals', 'vehicle-manuals', true)
-- ON CONFLICT (id) DO NOTHING;

-- Helper function to find manual for a vehicle
CREATE OR REPLACE FUNCTION get_vehicle_manual(
    p_year INTEGER,
    p_make TEXT,
    p_model TEXT,
    p_variant TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    year INTEGER,
    make TEXT,
    model TEXT,
    variant TEXT,
    pdf_url TEXT,
    pdf_storage_path TEXT,
    status TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        vm.id,
        vm.year,
        vm.make,
        vm.model,
        vm.variant,
        vm.pdf_url,
        vm.pdf_storage_path,
        vm.status
    FROM vehicle_manuals vm
    WHERE vm.year = p_year
      AND LOWER(vm.make) = LOWER(p_make)
      AND LOWER(vm.model) ILIKE '%' || LOWER(p_model) || '%'
      AND (p_variant IS NULL OR vm.variant = p_variant)
      AND vm.status IN ('uploaded', 'discovered')
    ORDER BY
        CASE WHEN vm.status = 'uploaded' THEN 0 ELSE 1 END,
        vm.variant NULLS FIRST
    LIMIT 1;
END;
$$;

-- Comment on table
COMMENT ON TABLE vehicle_manuals IS 'Owner''s manuals scraped from manual-directory.com. PDFs hosted on gimmemanuals.com or uploaded to Supabase Storage.';
