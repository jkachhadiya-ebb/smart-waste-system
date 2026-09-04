-- Keep both Atakum demo trucks on verified urban Atakum road corridors.
UPDATE municipalities
SET address_lat = 41.3380390,
    address_lng = 36.2720070,
    address_text = 'Atakum, Samsun, Turkey',
    updated_at = NOW()
WHERE municipality_code = 'TR-SAM-ATAKUM';

DELETE FROM telemetry
WHERE truck_id IN (
  SELECT id FROM trucks WHERE municipality_id = (
    SELECT id FROM municipalities WHERE municipality_code = 'TR-SAM-ATAKUM'
  )
);

WITH route_points(truck_code, sequence_no, street_name, lat, lng, speed_kmh, distance_km, fuel_liters, waste_kg) AS (
  VALUES
    -- Truck 1: Atatürk Boulevard, west to east through the Atakum urban corridor.
    ('ATK-WDT-001',  1, 'Atatürk Bulvarı - Gülhan Petrol Kavşağı', 41.3667610, 36.2293920, 22.0, 0.00, 0.00, 220.0),
    ('ATK-WDT-001',  2, 'Atatürk Bulvarı', 41.3644100, 36.2311800, 28.0, 0.30, 0.07, 238.0),
    ('ATK-WDT-001',  3, 'Atatürk Bulvarı', 41.3618200, 36.2331400, 30.0, 0.64, 0.15, 257.0),
    ('ATK-WDT-001',  4, 'Atatürk Bulvarı', 41.3589100, 36.2353500, 31.0, 1.02, 0.24, 278.0),
    ('ATK-WDT-001',  5, 'Atatürk Bulvarı - Vatan Caddesi Kavşağı', 41.3526500, 36.2402430, 25.0, 1.83, 0.43, 301.0),
    ('ATK-WDT-001',  6, 'Atatürk Bulvarı', 41.3492200, 36.2449500, 29.0, 2.36, 0.55, 326.0),
    ('ATK-WDT-001',  7, 'Atatürk Bulvarı', 41.3461800, 36.2502600, 30.0, 2.91, 0.68, 352.0),
    ('ATK-WDT-001',  8, 'Atatürk Bulvarı', 41.3434200, 36.2557200, 27.0, 3.47, 0.81, 379.0),
    ('ATK-WDT-001',  9, 'Atatürk Bulvarı - R.T.E. Bulvarı Kavşağı', 41.3409360, 36.2612570, 22.0, 4.02, 0.94, 407.0),
    ('ATK-WDT-001', 10, 'Atatürk Bulvarı', 41.3390100, 36.2666500, 28.0, 4.52, 1.05, 436.0),
    ('ATK-WDT-001', 11, 'Atatürk Bulvarı - Alparslan Bulvarı Kavşağı', 41.3369450, 36.2725770, 21.0, 5.08, 1.18, 466.0),
    ('ATK-WDT-001', 12, 'Atatürk Bulvarı', 41.3348700, 36.2782500, 29.0, 5.62, 1.31, 497.0),
    ('ATK-WDT-001', 13, 'Atatürk Bulvarı', 41.3329600, 36.2840500, 31.0, 6.16, 1.44, 529.0),
    ('ATK-WDT-001', 14, 'Atatürk Bulvarı', 41.3311600, 36.2897600, 30.0, 6.69, 1.56, 552.0),
    ('ATK-WDT-001', 15, 'Atatürk Bulvarı', 41.3292100, 36.2948200, 26.0, 7.17, 1.67, 576.0),
    ('ATK-WDT-001', 16, 'Atatürk Bulvarı - İsmet İnönü Kavşağı', 41.3271300, 36.2990100, 18.0, 7.60, 1.77, 600.0),

    -- Truck 2: inland municipal collection corridor, west to east.
    ('ATK-WDT-002',  1, 'İsmet İnönü Bulvarı - Ali Gaffar Okkan Kavşağı', 41.3437930, 36.2452380, 18.0, 0.00, 0.00, 180.0),
    ('ATK-WDT-002',  2, 'İsmet İnönü Bulvarı', 41.3427600, 36.2479200, 23.0, 0.26, 0.06, 199.0),
    ('ATK-WDT-002',  3, 'İsmet İnönü Bulvarı', 41.3416800, 36.2505400, 25.0, 0.52, 0.12, 219.0),
    ('ATK-WDT-002',  4, 'İsmet İnönü Bulvarı', 41.3405200, 36.2531700, 27.0, 0.79, 0.18, 240.0),
    ('ATK-WDT-002',  5, 'İsmet İnönü Bulvarı', 41.3389300, 36.2560200, 24.0, 1.12, 0.26, 262.0),
    ('ATK-WDT-002',  6, 'İsmet İnönü Bulvarı - R.T.E. Bulvarı Kavşağı', 41.3369700, 36.2588580, 19.0, 1.48, 0.34, 285.0),
    ('ATK-WDT-002',  7, 'Recep Tayyip Erdoğan Bulvarı', 41.3379300, 36.2600200, 22.0, 1.62, 0.37, 309.0),
    ('ATK-WDT-002',  8, 'Recep Tayyip Erdoğan Bulvarı', 41.3390100, 36.2607600, 24.0, 1.75, 0.40, 334.0),
    ('ATK-WDT-002',  9, 'Atatürk Bulvarı - R.T.E. Bulvarı Kavşağı', 41.3407170, 36.2609680, 17.0, 1.94, 0.45, 360.0),
    ('ATK-WDT-002', 10, 'Atatürk Bulvarı', 41.3396300, 36.2641500, 25.0, 2.23, 0.52, 387.0),
    ('ATK-WDT-002', 11, 'Atatürk Bulvarı', 41.3384700, 36.2674500, 27.0, 2.54, 0.59, 415.0),
    ('ATK-WDT-002', 12, 'Adnan Menderes Bulvarı', 41.3380390, 36.2720070, 20.0, 2.92, 0.68, 444.0),
    ('ATK-WDT-002', 13, 'Adnan Menderes Bulvarı', 41.3391800, 36.2760800, 23.0, 3.29, 0.76, 474.0),
    ('ATK-WDT-002', 14, 'Adnan Menderes Bulvarı', 41.3402600, 36.2801200, 25.0, 3.66, 0.85, 505.0),
    ('ATK-WDT-002', 15, 'Adnan Menderes Bulvarı', 41.3413100, 36.2840500, 24.0, 4.02, 0.93, 537.0),
    ('ATK-WDT-002', 16, 'Adnan Menderes Bulvarı', 41.3423600, 36.2879000, 18.0, 4.38, 1.01, 570.0)
), atakum_trucks AS (
  SELECT id, truck_code FROM trucks
  WHERE truck_code IN ('ATK-WDT-001', 'ATK-WDT-002')
)
INSERT INTO telemetry (
  truck_id, timestamp, lat, lng, speed_kmh, distance_km, fuel_liters,
  waste_kg, co2_kg, co_kg, fuel_type, odometer_km, fuel_total_liters, street_name
)
SELECT
  truck.id,
  NOW() - ((16 - route.sequence_no) * INTERVAL '3 seconds'),
  route.lat, route.lng, route.speed_kmh, route.distance_km, route.fuel_liters,
  route.waste_kg,
  ROUND((route.fuel_liters * 2.68)::numeric, 3),
  ROUND((route.fuel_liters * 0.007)::numeric, 4),
  'diesel', 12500 + route.distance_km, 3100 + route.fuel_liters, route.street_name
FROM route_points AS route
JOIN atakum_trucks AS truck USING (truck_code);
