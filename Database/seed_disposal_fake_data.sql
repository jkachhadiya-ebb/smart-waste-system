-- ============================================================================
-- Fake data seed for the DISPOSAL tab (municipality_id = 1 / Koblenz)
-- Only fills tables that are currently EMPTY: waste_rules, landfill_sites,
-- disposal_events. Existing data in municipalities & trucks is left untouched.
--
-- disposal_events has a BEFORE INSERT trigger (fn_apply_disposal_event) that
-- auto-computes the per-material split, load volume, and landfill usage from
-- total_weight_kg. So we only supply total_weight_kg + keys; the 0 placeholders
-- for the computed columns are overwritten by the trigger.
-- ============================================================================

BEGIN;

-- 1) Waste split rules for the municipality (default 30/24/28/11/7) ----------
INSERT INTO waste_rules (municipality_id)
VALUES (1)
ON CONFLICT (municipality_id) DO NOTHING;

-- 2) Landfill site for the municipality --------------------------------------
INSERT INTO landfill_sites (municipality_id, name, capacity_m3, used_m3, density_kg_per_m3)
VALUES (1, 'Koblenz Central Landfill', 12000.000, 0.000, 500.00)
ON CONFLICT (municipality_id) DO NOTHING;

-- 3) ~135 disposal events spread over the last 45 days (every 8 hours),
--    rotating across trucks 1-5, with random total weights 2000-9000 kg.
--    Inserted in chronological order so landfill usage accumulates correctly.
INSERT INTO disposal_events (
  municipality_id, landfill_site_id, truck_id, occurred_at, total_weight_kg,
  bio_kg, plastic_kg, cardboard_kg, metal_kg, other_kg, load_volume_m3,
  landfill_used_before_m3, landfill_used_after_m3
)
SELECT
  1,
  lf.id,
  1 + (s.n % 5),                                            -- truck 1..5
  now() - ((134 - s.n) * interval '8 hours'),              -- chronological
  round((2000 + random() * 7000)::numeric, 0),             -- 2000-9000 kg
  0, 0, 0, 0, 0, 0, 0, 0                                    -- trigger overwrites
FROM generate_series(0, 134) AS s(n)
CROSS JOIN (SELECT id FROM landfill_sites WHERE municipality_id = 1) AS lf
ORDER BY s.n;

COMMIT;

-- Summary
SELECT 'landfill_sites' AS tbl, count(*) AS rows FROM landfill_sites
UNION ALL SELECT 'waste_rules', count(*) FROM waste_rules
UNION ALL SELECT 'disposal_events', count(*) FROM disposal_events;
