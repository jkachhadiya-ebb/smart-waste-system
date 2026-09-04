require('dotenv').config();
const pool = require('../src/db');

const routes = [
  {
    truckCode: 'ATK-WDT-001',
    destination: [41.3613112, 36.2401953],
    url: 'https://router.project-osrm.org/route/v1/driving/36.2332122,41.3320241;36.245574,41.347759;36.243744,41.350078;36.242201,41.351238;36.2401953,41.3613112?overview=full&geometries=geojson&steps=true',
  },
  {
    truckCode: 'ATK-WDT-002',
    destination: [41.3189724, 36.288154],
    url: 'https://router.project-osrm.org/route/v1/driving/36.2332122,41.3320241;36.296867,41.324408;36.288154,41.3189724?overview=full&geometries=geojson&steps=true',
  },
];

function routePoints(result, destination) {
  const points = [];
  for (const leg of result.routes[0].legs) {
    for (const step of leg.steps) {
      const streetName = step.name || 'Atakum road';
      for (const [lng, lat] of step.geometry.coordinates) {
        const previous = points[points.length - 1];
        if (!previous || previous.lat !== lat || previous.lng !== lng) {
          points.push({ lat, lng, streetName });
        }
      }
    }
  }
  points[0] = {
    lat: 41.3320241,
    lng: 36.2332122,
    streetName: 'Hobi Bahçeleri Karşısı, Çobanlı, Aydınlık Cd.',
  };
  points[points.length - 1] = {
    lat: destination[0],
    lng: destination[1],
    streetName: 'Destination',
  };
  return points;
}

async function main() {
  const client = await pool.connect();
  try {
    const downloaded = [];
    for (const route of routes) {
      const response = await fetch(route.url);
      if (!response.ok) throw new Error(`Routing request failed: ${response.status}`);
      const result = await response.json();
      if (result.code !== 'Ok' || !result.routes?.[0]) throw new Error('No road route returned');
      downloaded.push({ ...route, points: routePoints(result, route.destination) });
    }

    await client.query('BEGIN');
    for (const route of downloaded) {
      const truckResult = await client.query('SELECT id FROM trucks WHERE truck_code = $1', [route.truckCode]);
      const truckId = truckResult.rows[0]?.id;
      if (!truckId) throw new Error(`Truck not found: ${route.truckCode}`);
      await client.query('DELETE FROM telemetry WHERE truck_id = $1', [truckId]);

      for (let index = 0; index < route.points.length; index += 1) {
        const point = route.points[index];
        const atEndpoint = index === 0 || index === route.points.length - 1;
        const distanceKm = index * 0.05;
        const fuelLiters = distanceKm * 0.23;
        await client.query(
          `INSERT INTO telemetry (
             truck_id, timestamp, lat, lng, speed_kmh, distance_km, fuel_liters,
             waste_kg, co2_kg, co_kg, fuel_type, odometer_km, fuel_total_liters,
             street_name, route_sequence
           ) VALUES ($1, NOW() + ($2 * INTERVAL '3 seconds'), $3, $4, $5, $6, $7,
                     $8, $9, $10, 'diesel', $11, $12, $13, $14)`,
          [
            truckId, index + 1, point.lat, point.lng, atEndpoint ? 0 : 24,
            distanceKm, fuelLiters, 180 + index * 2,
            fuelLiters * 2.68, fuelLiters * 0.007,
            12500 + distanceKm, 3100 + fuelLiters, point.streetName, index + 1,
          ]
        );
      }
      console.log(`${route.truckCode}: inserted ${route.points.length} road points`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
