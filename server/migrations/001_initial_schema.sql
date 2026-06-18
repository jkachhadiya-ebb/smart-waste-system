-- Smart Waste System – Initial Schema
-- Run once against a fresh `smart_waste` database.
-- Idempotent: uses IF NOT EXISTS / ON CONFLICT where possible.

BEGIN;

------------------------------------------------------------
-- 1. Core lookup / reference tables
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS municipalities (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(200),
  municipality_code VARCHAR(40) UNIQUE,
  country       VARCHAR(100),
  state_region  VARCHAR(100),
  city          VARCHAR(100),
  address_text  VARCHAR(255),
  address_lat   NUMERIC(10,7),
  address_lng   NUMERIC(10,7),
  contact_email VARCHAR(200),
  contact_phone VARCHAR(24),
  logo_url      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS municipality_settings (
  id                    SERIAL PRIMARY KEY,
  municipality_id       INTEGER NOT NULL UNIQUE REFERENCES municipalities(id) ON DELETE CASCADE,
  default_theme         VARCHAR(20),
  default_language      VARCHAR(35),
  default_map_view      VARCHAR(20),
  default_zoom          INTEGER,
  marker_style          VARCHAR(20),
  show_registered_cities BOOLEAN,
  show_recycling_centers BOOLEAN,
  show_trucks_live      BOOLEAN,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

------------------------------------------------------------
-- 2. Users, sessions, MFA, password reset
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(80)  NOT NULL UNIQUE,
  email           VARCHAR(200) NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,
  role            VARCHAR(30)  NOT NULL DEFAULT 'user',
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash  TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  ip_address          VARCHAR(45),
  user_agent          TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id, revoked_at);

CREATE TABLE IF NOT EXISTS user_mfa (
  id                      BIGSERIAL PRIMARY KEY,
  user_id                 INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  totp_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret_encrypted   TEXT,
  enabled_at              TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER     NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email        VARCHAR(200),
  otp_code     VARCHAR(10) NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ,
  is_verified  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS password_resets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reset_token TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

------------------------------------------------------------
-- 3. User settings and notifications
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_settings (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  theme                   VARCHAR(20),
  language                VARCHAR(35),
  map_view                VARCHAR(20),
  zoom                    INTEGER,
  marker_style            VARCHAR(20),
  show_registered_cities  BOOLEAN,
  show_recycling_centers  BOOLEAN,
  show_trucks_live        BOOLEAN,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_notification_settings (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  inapp_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  gps_offline_minutes INTEGER NOT NULL DEFAULT 15,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_event_types (
  key   VARCHAR(80) PRIMARY KEY,
  label VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_notification_event_prefs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key  VARCHAR(80) NOT NULL REFERENCES notification_event_types(key) ON DELETE CASCADE,
  enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_key)
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL,
  message    TEXT         NOT NULL,
  event_key  VARCHAR(80),
  meta       JSONB,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread  ON user_notifications (user_id, read_at);

------------------------------------------------------------
-- 4. Supported languages
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supported_languages (
  id         SERIAL PRIMARY KEY,
  code       VARCHAR(10)  NOT NULL UNIQUE,
  label      VARCHAR(100) NOT NULL,
  enabled    BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order INTEGER      NOT NULL DEFAULT 0
);

INSERT INTO supported_languages (code, label, enabled, sort_order) VALUES
  ('en', 'English', TRUE, 1),
  ('de', 'Deutsch', TRUE, 2),
  ('tr', 'Türkçe', TRUE, 3)
ON CONFLICT (code) DO NOTHING;

------------------------------------------------------------
-- 5. Trucks, GPS, drivers
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS centers (
  id              SERIAL PRIMARY KEY,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  name            VARCHAR(200) NOT NULL,
  lat             NUMERIC(10,7),
  lng             NUMERIC(10,7),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trucks (
  id                  SERIAL PRIMARY KEY,
  truck_code          VARCHAR(40) UNIQUE,
  plate_number        VARCHAR(30),
  model               VARCHAR(100),
  gps_imei            VARCHAR(30) UNIQUE,
  status              VARCHAR(20) DEFAULT 'Active',
  fuel_type           VARCHAR(20) NOT NULL DEFAULT 'diesel',
  capacity_tons       NUMERIC(8,2),
  co2_factor_per_liter NUMERIC(8,4),
  co_factor_per_liter  NUMERIC(8,6),
  municipality_id     INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  home_center_id      INTEGER REFERENCES centers(id) ON DELETE SET NULL,
  vehicle_role        VARCHAR(30),
  ownership_type      VARCHAR(30),
  combustion_share    NUMERIC(5,2),
  electric_share      NUMERIC(5,2),
  fuel_efficiency_km_per_liter NUMERIC(8,3),
  fuel_efficiency_kwh_per_km   NUMERIC(8,3),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gps_devices (
  id         SERIAL PRIMARY KEY,
  imei       VARCHAR(30) UNIQUE NOT NULL,
  model      VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gps_assignments (
  id         SERIAL PRIMARY KEY,
  gps_id     INTEGER NOT NULL REFERENCES gps_devices(id) ON DELETE CASCADE,
  truck_id   INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS drivers (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,
  license_number  VARCHAR(40),
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_assignments (
  id          SERIAL PRIMARY KEY,
  driver_id   INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  truck_id    INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at  TIMESTAMPTZ
);

------------------------------------------------------------
-- 6. Trips, telemetry, emissions
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trips (
  id              SERIAL PRIMARY KEY,
  truck_id        INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  driver_id       INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  start_lat       NUMERIC(10,7),
  start_lng       NUMERIC(10,7),
  end_lat         NUMERIC(10,7),
  end_lng         NUMERIC(10,7),
  distance_km     NUMERIC(10,3),
  status          VARCHAR(20) DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telemetry (
  id          BIGSERIAL PRIMARY KEY,
  truck_id    INTEGER NOT NULL,
  trip_id     INTEGER,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7),
  speed_kmh   NUMERIC(8,2),
  distance_km NUMERIC(10,3),
  fuel_liters NUMERIC(10,3),
  fuel_type   VARCHAR(20),
  waste_kg    NUMERIC(10,3),
  co2_kg      NUMERIC(12,6),
  co_kg       NUMERIC(12,6),
  stops       INTEGER DEFAULT 0,
  odometer_km NUMERIC(12,3)
);
CREATE INDEX IF NOT EXISTS idx_telemetry_truck_ts ON telemetry (truck_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS trip_emissions (
  id          BIGSERIAL PRIMARY KEY,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  truck_id    INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  co2_kg      NUMERIC(12,6),
  co_kg       NUMERIC(12,6),
  co2e_kg     NUMERIC(12,6),
  fuel_liters NUMERIC(10,3),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_emissions_timeseries (
  id              BIGSERIAL PRIMARY KEY,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE SET NULL,
  bucket          TIMESTAMPTZ NOT NULL,
  co2_kg          NUMERIC(12,6) NOT NULL DEFAULT 0,
  co_kg           NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

------------------------------------------------------------
-- 7. Route optimizations
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS route_optimizations (
  id                      BIGSERIAL PRIMARY KEY,
  truck_id                INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  trip_id                 INTEGER,
  executed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  baseline_from           TIMESTAMPTZ,
  baseline_to             TIMESTAMPTZ,
  fuel_type               VARCHAR(20) NOT NULL DEFAULT 'diesel',
  baseline_distance_km    NUMERIC(12,3) NOT NULL DEFAULT 0,
  optimized_distance_km   NUMERIC(12,3) NOT NULL DEFAULT 0,
  reduced_distance_km     NUMERIC(12,3),
  baseline_time_minutes   NUMERIC(12,2) NOT NULL DEFAULT 0,
  optimized_time_minutes  NUMERIC(12,2) NOT NULL DEFAULT 0,
  time_saved_minutes      NUMERIC(12,2),
  baseline_fuel_liters    NUMERIC(12,3),
  optimized_fuel_liters   NUMERIC(12,3),
  fuel_saved_liters       NUMERIC(12,3),
  baseline_co2_kg         NUMERIC(12,3),
  optimized_co2_kg        NUMERIC(12,3),
  reduced_co2_kg          NUMERIC(12,3),
  baseline_co_kg          NUMERIC(12,3),
  optimized_co_kg         NUMERIC(12,3),
  reduced_co_kg           NUMERIC(12,3),
  global_warming_delta_c  NUMERIC(12,6),
  vehicle_id              BIGINT,
  original_distance_km    NUMERIC(12,3),
  distance_saved_km       NUMERIC(12,3),
  co2_saved_kg            NUMERIC(12,6),
  co_saved_kg             NUMERIC(12,6),
  baseline_route_geojson  JSONB,
  optimized_route_geojson JSONB,
  meta                    JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_opt_truck_time ON route_optimizations (truck_id, executed_at DESC);

------------------------------------------------------------
-- 8. Landfill, disposal, waste rules
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS landfill_sites (
  id              SERIAL PRIMARY KEY,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  capacity_m3     NUMERIC(14,3) NOT NULL DEFAULT 0,
  used_m3         NUMERIC(14,3) NOT NULL DEFAULT 0,
  density_kg_per_m3 NUMERIC(8,2) NOT NULL DEFAULT 400,
  lat             NUMERIC(10,7),
  lng             NUMERIC(10,7),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disposal_events (
  id                     BIGSERIAL PRIMARY KEY,
  municipality_id        INTEGER NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  landfill_site_id       INTEGER REFERENCES landfill_sites(id) ON DELETE SET NULL,
  truck_id               INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
  trip_id                INTEGER,
  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_weight_kg        NUMERIC(12,3) NOT NULL DEFAULT 0,
  bio_kg                 NUMERIC(12,3) NOT NULL DEFAULT 0,
  plastic_kg             NUMERIC(12,3) NOT NULL DEFAULT 0,
  cardboard_kg           NUMERIC(12,3) NOT NULL DEFAULT 0,
  metal_kg               NUMERIC(12,3) NOT NULL DEFAULT 0,
  other_kg               NUMERIC(12,3) NOT NULL DEFAULT 0,
  load_volume_m3         NUMERIC(12,3) NOT NULL DEFAULT 0,
  landfill_used_before_m3 NUMERIC(14,3) NOT NULL DEFAULT 0,
  landfill_used_after_m3  NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disposal_events_municipality ON disposal_events (municipality_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS waste_rules (
  id              SERIAL PRIMARY KEY,
  municipality_id INTEGER REFERENCES municipalities(id) ON DELETE CASCADE,
  bio_ratio       NUMERIC(5,4) NOT NULL DEFAULT 0.30,
  plastic_ratio   NUMERIC(5,4) NOT NULL DEFAULT 0.24,
  cardboard_ratio NUMERIC(5,4) NOT NULL DEFAULT 0.28,
  metal_ratio     NUMERIC(5,4) NOT NULL DEFAULT 0.11,
  other_ratio     NUMERIC(5,4) NOT NULL DEFAULT 0.07,
  density_kg_per_m3 NUMERIC(8,2) NOT NULL DEFAULT 400,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (municipality_id)
);

CREATE TABLE IF NOT EXISTS waste_load_events (
  id          BIGSERIAL PRIMARY KEY,
  truck_id    INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  trip_id     INTEGER,
  weight_kg   NUMERIC(10,3) NOT NULL,
  loaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7)
);

------------------------------------------------------------
-- 9. Vendors, vehicle rentals, maintenance
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendors (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  contact     VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_rentals (
  id                 SERIAL PRIMARY KEY,
  truck_id           INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  vendor_id          INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  rental_start       DATE NOT NULL,
  rental_end         DATE,
  monthly_cost_eur   NUMERIC(10,2),
  contract_reference VARCHAR(100),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id              SERIAL PRIMARY KEY,
  truck_id        INTEGER NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  description     TEXT,
  cost_eur        NUMERIC(10,2),
  scheduled_at    DATE,
  completed_at    DATE,
  status          VARCHAR(30) DEFAULT 'scheduled',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

------------------------------------------------------------
-- 10. View: v_disposal_ui_rows
------------------------------------------------------------

CREATE OR REPLACE VIEW v_disposal_ui_rows AS
SELECT
  de.id,
  de.occurred_at::date                                   AS date,
  COALESCE(t.truck_code, de.truck_id::text)              AS truck_id,
  ROUND(de.total_weight_kg / 1000.0, 3)                 AS total_waste_t,
  ROUND(de.bio_kg          / 1000.0, 3)                 AS bio_t,
  ROUND(de.plastic_kg      / 1000.0, 3)                 AS plastic_t,
  ROUND(de.cardboard_kg    / 1000.0, 3)                 AS cardboard_t,
  ROUND(de.metal_kg        / 1000.0, 3)                 AS metal_t,
  ROUND(de.other_kg        / 1000.0, 3)                 AS other_t,
  de.load_volume_m3                                      AS landfill_used_m3,
  de.landfill_used_after_m3                              AS landfill_total_used_m3,
  de.municipality_id,
  de.landfill_site_id
FROM disposal_events de
LEFT JOIN trucks t ON t.id = de.truck_id;

------------------------------------------------------------
-- 11. Seed: notification event types
------------------------------------------------------------

INSERT INTO notification_event_types (key, label) VALUES
  ('gps_offline',       'GPS Offline Alert'),
  ('truck_maintenance', 'Truck Maintenance'),
  ('route_optimized',   'Route Optimized'),
  ('disposal_event',    'Disposal Event'),
  ('high_emissions',    'High Emissions Alert'),
  ('system_update',     'System Update')
ON CONFLICT (key) DO NOTHING;

COMMIT;
