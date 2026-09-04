-- Atakum municipality, two trucks, and database-backed demo GPS routes.
-- The paired timestamps let the simulator emit one point per truck every tick.

ALTER TABLE telemetry
  ADD COLUMN IF NOT EXISTS street_name VARCHAR(160);

INSERT INTO municipalities (
  municipality_code, name, country, state_region, city,
  address_text, address_lat, address_lng
)
VALUES (
  'TR-SAM-ATAKUM', 'Atakum Municipality', 'Turkey', 'Samsun', 'Atakum',
  'Atakum, Samsun, Turkey', 41.3300000, 36.2700000
)
ON CONFLICT (municipality_code) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  state_region = EXCLUDED.state_region,
  city = EXCLUDED.city,
  address_text = EXCLUDED.address_text,
  address_lat = EXCLUDED.address_lat,
  address_lng = EXCLUDED.address_lng,
  updated_at = NOW();

INSERT INTO trucks (
  truck_code, plate_number, model, capacity_tons, gps_imei, status,
  fuel_type, municipality_id, vehicle_role, ownership_type,
  fuel_efficiency_km_per_liter, co2_factor_per_liter, co_factor_per_liter
)
SELECT
  values_to_insert.truck_code,
  values_to_insert.plate_number,
  values_to_insert.model,
  values_to_insert.capacity_tons,
  values_to_insert.gps_imei,
  'Active',
  'diesel',
  municipality.id,
  'waste_truck',
  'municipality_owned',
  values_to_insert.efficiency,
  2.6800,
  0.007000
FROM municipalities AS municipality
CROSS JOIN (
  VALUES
    ('ATK-WDT-001', '55 ATK 101', 'Atakum EcoCollector 18', 12.00, 'ATK-GPS-0001', 4.200),
    ('ATK-WDT-002', '55 ATK 102', 'Atakum EcoCollector 18', 12.00, 'ATK-GPS-0002', 4.350)
) AS values_to_insert(truck_code, plate_number, model, capacity_tons, gps_imei, efficiency)
WHERE municipality.municipality_code = 'TR-SAM-ATAKUM'
ON CONFLICT (truck_code) DO UPDATE SET
  plate_number = EXCLUDED.plate_number,
  model = EXCLUDED.model,
  capacity_tons = EXCLUDED.capacity_tons,
  gps_imei = EXCLUDED.gps_imei,
  status = 'Active',
  fuel_type = EXCLUDED.fuel_type,
  municipality_id = EXCLUDED.municipality_id,
  vehicle_role = EXCLUDED.vehicle_role,
  ownership_type = EXCLUDED.ownership_type,
  updated_at = NOW();

WITH route_points(truck_code, sequence_no, street_name, lat, lng, speed_kmh, distance_km, fuel_liters, waste_kg) AS (
  VALUES
    ('ATK-WDT-001',  1, 'Adnan Menderes Bulvarı', 41.3449000, 36.2402000, 28.0, 0.00, 0.00, 220.0),
    ('ATK-WDT-001',  2, 'Adnan Menderes Bulvarı', 41.3443000, 36.2468000, 31.0, 0.58, 0.14, 245.0),
    ('ATK-WDT-001',  3, 'Adnan Menderes Bulvarı', 41.3435000, 36.2537000, 29.0, 1.18, 0.28, 278.0),
    ('ATK-WDT-001',  4, 'Adnan Menderes Bulvarı', 41.3427000, 36.2605000, 25.0, 1.77, 0.42, 312.0),
    ('ATK-WDT-001',  5, 'Atatürk Bulvarı',        41.3379000, 36.2656000, 24.0, 2.42, 0.58, 346.0),
    ('ATK-WDT-001',  6, 'Atatürk Bulvarı',        41.3341000, 36.2729000, 32.0, 3.17, 0.76, 381.0),
    ('ATK-WDT-001',  7, 'Atatürk Bulvarı',        41.3312000, 36.2811000, 35.0, 3.93, 0.94, 416.0),
    ('ATK-WDT-001',  8, 'Atatürk Bulvarı',        41.3288000, 36.2897000, 30.0, 4.70, 1.12, 452.0),
    ('ATK-WDT-001',  9, 'İsmet İnönü Bulvarı',    41.3319000, 36.2968000, 22.0, 5.39, 1.28, 489.0),
    ('ATK-WDT-001', 10, 'İsmet İnönü Bulvarı',    41.3357000, 36.3029000, 26.0, 6.05, 1.44, 526.0),
    ('ATK-WDT-001', 11, 'Adnan Menderes Bulvarı', 41.3405000, 36.2971000, 29.0, 6.78, 1.61, 563.0),
    ('ATK-WDT-001', 12, 'Adnan Menderes Bulvarı', 41.3431000, 36.2879000, 31.0, 7.59, 1.80, 600.0),

    ('ATK-WDT-002',  1, 'Recep Tayyip Erdoğan Blv.', 41.3189000, 36.2474000, 27.0, 0.00, 0.00, 180.0),
    ('ATK-WDT-002',  2, 'Recep Tayyip Erdoğan Blv.', 41.3215000, 36.2539000, 30.0, 0.62, 0.14, 209.0),
    ('ATK-WDT-002',  3, 'Recep Tayyip Erdoğan Blv.', 41.3240000, 36.2606000, 33.0, 1.25, 0.29, 239.0),
    ('ATK-WDT-002',  4, 'Cağaloğlu Bulvarı',          41.3270000, 36.2655000, 24.0, 1.77, 0.41, 271.0),
    ('ATK-WDT-002',  5, 'Cağaloğlu Bulvarı',          41.3304000, 36.2695000, 21.0, 2.24, 0.52, 304.0),
    ('ATK-WDT-002',  6, 'Atatürk Bulvarı',            41.3332000, 36.2761000, 29.0, 2.87, 0.67, 338.0),
    ('ATK-WDT-002',  7, 'Atatürk Bulvarı',            41.3309000, 36.2839000, 32.0, 3.57, 0.83, 373.0),
    ('ATK-WDT-002',  8, 'Atatürk Bulvarı',            41.3286000, 36.2918000, 31.0, 4.28, 0.99, 409.0),
    ('ATK-WDT-002',  9, 'İsmet İnönü Bulvarı',        41.3318000, 36.2991000, 23.0, 4.99, 1.16, 446.0),
    ('ATK-WDT-002', 10, 'İsmet İnönü Bulvarı',        41.3360000, 36.3051000, 25.0, 5.68, 1.32, 484.0),
    ('ATK-WDT-002', 11, 'Adnan Menderes Bulvarı',     41.3408000, 36.2987000, 28.0, 6.44, 1.50, 522.0),
    ('ATK-WDT-002', 12, 'Adnan Menderes Bulvarı',     41.3433000, 36.2891000, 30.0, 7.28, 1.70, 560.0)
), atakum_trucks AS (
  SELECT id, truck_code
  FROM trucks
  WHERE truck_code IN ('ATK-WDT-001', 'ATK-WDT-002')
)
INSERT INTO telemetry (
  truck_id, timestamp, lat, lng, speed_kmh, distance_km, fuel_liters,
  waste_kg, co2_kg, co_kg, fuel_type, odometer_km, fuel_total_liters,
  street_name
)
SELECT
  truck.id,
  NOW() - ((12 - route.sequence_no) * INTERVAL '3 seconds'),
  route.lat,
  route.lng,
  route.speed_kmh,
  route.distance_km,
  route.fuel_liters,
  route.waste_kg,
  ROUND((route.fuel_liters * 2.68)::numeric, 3),
  ROUND((route.fuel_liters * 0.007)::numeric, 4),
  'diesel',
  12500 + route.distance_km,
  3100 + route.fuel_liters,
  route.street_name
FROM route_points AS route
JOIN atakum_trucks AS truck USING (truck_code)
WHERE NOT EXISTS (
  SELECT 1
  FROM telemetry existing
  WHERE existing.truck_id = truck.id
    AND existing.street_name IS NOT NULL
);
