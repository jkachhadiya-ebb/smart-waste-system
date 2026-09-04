-- Exact road-following routes requested for the two Atakum trucks.
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS route_sequence INTEGER;

DELETE FROM telemetry
WHERE truck_id IN (
  SELECT tr.id
  FROM trucks tr
  JOIN municipalities m ON m.id = tr.municipality_id
  WHERE m.municipality_code = 'TR-SAM-ATAKUM'
);

WITH route_points(truck_code, sequence_no, street_name, lat, lng) AS (
  VALUES
    -- Truck 1: Hobi Bahçeleri Karşısı to Çavuş Cd. via the supplied road waypoints.
    ('ATK-WDT-001',  1, 'Hobi Bahçeleri Karşısı / Kıbrıs Caddesi', 41.332572, 36.233086),
    ('ATK-WDT-001',  2, 'Kıbrıs Caddesi', 41.334632, 36.237854),
    ('ATK-WDT-001',  3, 'Kıbrıs Caddesi', 41.336438, 36.241187),
    ('ATK-WDT-001',  4, 'Kıbrıs Caddesi', 41.337675, 36.243300),
    ('ATK-WDT-001',  5, 'Atakent Bulvarı', 41.339417, 36.245580),
    ('ATK-WDT-001',  6, 'Atakent Bulvarı', 41.340516, 36.244708),
    ('ATK-WDT-001',  7, 'Atakent Bulvarı', 41.342268, 36.243238),
    ('ATK-WDT-001',  8, 'Atatürk Bulvarı 3. Kısım', 41.343412, 36.244787),
    ('ATK-WDT-001',  9, 'Atatürk Bulvarı 3. Kısım', 41.344211, 36.244719),
    ('ATK-WDT-001', 10, 'Atatürk Bulvarı 3. Kısım', 41.346753, 36.242237),
    ('ATK-WDT-001', 11, 'Atatürk Bulvarı Yanyolu', 41.348014, 36.244416),
    ('ATK-WDT-001', 12, 'Atatürk Bulvarı Yanyolu', 41.347018, 36.246702),
    ('ATK-WDT-001', 13, 'Atatürk Bulvarı Yanyolu', 41.344973, 36.248096),
    ('ATK-WDT-001', 14, 'Atatürk Bulvarı Yanyolu', 41.345459, 36.249055),
    ('ATK-WDT-001', 15, 'Atatürk Bulvarı 3. Kısım', 41.349933, 36.243835),
    ('ATK-WDT-001', 16, 'Atatürk Bulvarı 3. Kısım', 41.352493, 36.241021),
    ('ATK-WDT-001', 17, 'Atatürk Bulvarı 3. Kısım', 41.352876, 36.240290),
    ('ATK-WDT-001', 18, 'Atatürk Bulvarı 3. Kısım', 41.351942, 36.241305),
    ('ATK-WDT-001', 19, 'Atatürk Bulvarı 3. Kısım', 41.349210, 36.244440),
    ('ATK-WDT-001', 20, 'Atatürk Bulvarı 3. Kısım', 41.345862, 36.248145),
    ('ATK-WDT-001', 21, 'Atatürk Bulvarı 3. Kısım', 41.345293, 36.248824),
    ('ATK-WDT-001', 22, 'Atatürk Bulvarı 3. Kısım', 41.347834, 36.246226),
    ('ATK-WDT-001', 23, 'Atatürk Bulvarı 3. Kısım', 41.352493, 36.241021),
    ('ATK-WDT-001', 24, 'Atatürk Bulvarı 5. Kısım', 41.353701, 36.239602),
    ('ATK-WDT-001', 25, 'Adnan Menderes Bulvarı 3. Kısım', 41.357028, 36.237713),
    ('ATK-WDT-001', 26, 'Adnan Menderes Bulvarı 3. Kısım', 41.358574, 36.236859),
    ('ATK-WDT-001', 27, 'Çavuş Caddesi / Körfez Mahallesi', 41.359477, 36.236478),

    -- Truck 2: Hobi Bahçeleri Karşısı to 208. Sk. in İlkadım via the supplied eastern waypoint.
    ('ATK-WDT-002',  1, 'Hobi Bahçeleri Karşısı / Kıbrıs Caddesi', 41.332572, 36.233086),
    ('ATK-WDT-002',  2, 'Kıbrıs Caddesi', 41.334632, 36.237854),
    ('ATK-WDT-002',  3, 'Kıbrıs Caddesi', 41.336438, 36.241187),
    ('ATK-WDT-002',  4, 'Kıbrıs Caddesi', 41.337675, 36.243300),
    ('ATK-WDT-002',  5, 'Abdullah Gül Bulvarı', 41.339417, 36.245580),
    ('ATK-WDT-002',  6, 'Abdullah Gül Bulvarı', 41.340143, 36.247510),
    ('ATK-WDT-002',  7, 'Abdullah Gül Bulvarı', 41.339568, 36.249462),
    ('ATK-WDT-002',  8, 'Abdullah Gül Bulvarı', 41.338640, 36.252951),
    ('ATK-WDT-002',  9, 'İsmet İnönü Bulvarı', 41.336552, 36.258989),
    ('ATK-WDT-002', 10, 'İsmet İnönü Bulvarı', 41.333531, 36.264077),
    ('ATK-WDT-002', 11, 'İsmet İnönü Bulvarı', 41.332459, 36.268577),
    ('ATK-WDT-002', 12, 'İsmet İnönü Bulvarı', 41.332132, 36.270261),
    ('ATK-WDT-002', 13, 'İsmet İnönü Bulvarı', 41.331201, 36.273697),
    ('ATK-WDT-002', 14, 'İsmet İnönü Bulvarı', 41.330322, 36.278607),
    ('ATK-WDT-002', 15, 'İsmet İnönü Bulvarı', 41.329087, 36.282179),
    ('ATK-WDT-002', 16, 'İsmet İnönü Bulvarı', 41.326884, 36.286650),
    ('ATK-WDT-002', 17, 'İsmet İnönü Bulvarı', 41.324780, 36.290578),
    ('ATK-WDT-002', 18, 'İsmet İnönü Bulvarı', 41.323986, 36.295473),
    ('ATK-WDT-002', 19, 'Atatürk Bulvarı / supplied waypoint', 41.324443, 36.297332),
    ('ATK-WDT-002', 20, 'Barış Bulvarı bağlantısı', 41.322824, 36.295901),
    ('ATK-WDT-002', 21, 'Barış Bulvarı bağlantısı', 41.323579, 36.293155),
    ('ATK-WDT-002', 22, 'Barış Bulvarı bağlantısı', 41.323213, 36.289908),
    ('ATK-WDT-002', 23, '301. Sokak bağlantısı', 41.321063, 36.288470),
    ('ATK-WDT-002', 24, '208. Sokak', 41.319226, 36.287226),
    ('ATK-WDT-002', 25, '208. Sokak No:7, Karasamsun', 41.319223, 36.288154)
), atakum_trucks AS (
  SELECT id, truck_code FROM trucks
  WHERE truck_code IN ('ATK-WDT-001', 'ATK-WDT-002')
)
INSERT INTO telemetry (
  truck_id, timestamp, lat, lng, speed_kmh, distance_km, fuel_liters,
  waste_kg, co2_kg, co_kg, fuel_type, odometer_km, fuel_total_liters,
  street_name, route_sequence
)
SELECT
  truck.id,
  NOW() + route.sequence_no * INTERVAL '3 seconds',
  route.lat,
  route.lng,
  CASE
    WHEN route.sequence_no = 1
      OR (route.truck_code = 'ATK-WDT-001' AND route.sequence_no = 27)
      OR (route.truck_code = 'ATK-WDT-002' AND route.sequence_no = 25)
    THEN 0 ELSE 24
  END,
  ROUND(((route.sequence_no - 1) * 0.30)::numeric, 2),
  ROUND(((route.sequence_no - 1) * 0.07)::numeric, 3),
  180 + route.sequence_no * 8,
  ROUND((((route.sequence_no - 1) * 0.07) * 2.68)::numeric, 3),
  ROUND((((route.sequence_no - 1) * 0.07) * 0.007)::numeric, 4),
  'diesel',
  12500 + ((route.sequence_no - 1) * 0.30),
  3100 + ((route.sequence_no - 1) * 0.07),
  route.street_name,
  route.sequence_no
FROM route_points route
JOIN atakum_trucks truck USING (truck_code);
