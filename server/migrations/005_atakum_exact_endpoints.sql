-- Preserve the user's exact collection origin and destination coordinates.
UPDATE telemetry t
SET lat = 41.3320241, lng = 36.2332122,
    street_name = 'Hobi Bahçeleri Karşısı, Çobanlı, Aydınlık Cd.'
FROM trucks tr
WHERE tr.id = t.truck_id
  AND tr.truck_code IN ('ATK-WDT-001', 'ATK-WDT-002')
  AND t.route_sequence = 1;

UPDATE telemetry t
SET lat = 41.3613112, lng = 36.2401953,
    street_name = 'Körfez Mahallesi, Çavuş Cd. No:20'
FROM trucks tr
WHERE tr.id = t.truck_id
  AND tr.truck_code = 'ATK-WDT-001'
  AND t.route_sequence = 27;

UPDATE telemetry t
SET lat = 41.3189724, lng = 36.2881540,
    street_name = 'Karasamsun, 208. Sk. No:7'
FROM trucks tr
WHERE tr.id = t.truck_id
  AND tr.truck_code = 'ATK-WDT-002'
  AND t.route_sequence = 25;
