-- =============================================
-- MARKET VALUE TABLES
-- =============================================

-- Market values by vehicle and condition
CREATE TABLE IF NOT EXISTS vehicle_market_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_spec_id UUID REFERENCES vehicle_specs(id) ON DELETE CASCADE,
    -- Denormalized YMMT for vehicles not in vehicle_specs
    year INTEGER NOT NULL,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    trim VARCHAR(200),
    -- Condition and values
    condition VARCHAR(20) NOT NULL CHECK (condition IN ('Outstanding', 'Clean', 'Average', 'Rough')),
    trade_in_cents INTEGER,
    private_party_cents INTEGER,
    dealer_retail_cents INTEGER,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (year, make, model, trim, condition)
);

-- Indexes for market values
CREATE INDEX IF NOT EXISTS idx_market_values_spec_id ON vehicle_market_values(vehicle_spec_id);
CREATE INDEX IF NOT EXISTS idx_market_values_ymmt ON vehicle_market_values(year, make, model, trim);
CREATE INDEX IF NOT EXISTS idx_market_values_condition ON vehicle_market_values(condition);

-- =============================================
-- MAINTENANCE TABLES
-- =============================================

-- Maintenance schedules per vehicle with service items as array
CREATE TABLE IF NOT EXISTS vehicle_maintenance_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_spec_id UUID REFERENCES vehicle_specs(id) ON DELETE CASCADE,
    -- Denormalized YMMT for vehicles not in vehicle_specs
    year INTEGER NOT NULL,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    trim VARCHAR(200),
    -- Schedule info
    mileage INTEGER NOT NULL,
    service_items TEXT[], -- Array of service item names
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (year, make, model, trim, mileage)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_schedules_spec_id ON vehicle_maintenance_schedules(vehicle_spec_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_schedules_ymmt ON vehicle_maintenance_schedules(year, make, model, trim);
CREATE INDEX IF NOT EXISTS idx_maintenance_schedules_mileage ON vehicle_maintenance_schedules(mileage);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE vehicle_market_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_maintenance_schedules ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Allow public read access on vehicle_market_values"
    ON vehicle_market_values FOR SELECT USING (true);

CREATE POLICY "Allow public read access on vehicle_maintenance_schedules"
    ON vehicle_maintenance_schedules FOR SELECT USING (true);
