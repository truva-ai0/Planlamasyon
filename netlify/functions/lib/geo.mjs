export function geometryCenter(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates;
    return validPoint(lat, lon) ? { lat: Number(lat), lon: Number(lon) } : null;
  }
  const bbox = geometryBbox(geometry);
  if (!bbox) return null;
  return { lat: (bbox.minLat + bbox.maxLat) / 2, lon: (bbox.minLon + bbox.maxLon) / 2 };
}

export function geometryBbox(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  const values = [];
  collectCoordinates(geometry.coordinates, values, 0);
  if (!values.length) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const [lon, lat] of values) {
    if (!validPoint(lat, lon)) continue;
    minLat = Math.min(minLat, Number(lat));
    maxLat = Math.max(maxLat, Number(lat));
    minLon = Math.min(minLon, Number(lon));
    maxLon = Math.max(maxLon, Number(lon));
  }
  if (minLat > maxLat || minLon > maxLon) return null;
  return { minLat, maxLat, minLon, maxLon };
}

export function haversineMeters(a, b) {
  if (!a || !b || !validPoint(a.lat, a.lon) || !validPoint(b.lat, b.lon)) return null;
  const radius = 6371008.8;
  const lat1 = toRad(Number(a.lat));
  const lat2 = toRad(Number(b.lat));
  const dLat = toRad(Number(b.lat) - Number(a.lat));
  const dLon = toRad(Number(b.lon) - Number(a.lon));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistance(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value)) return null;
  if (value < 1000) return `${Math.max(1, Math.round(value / 10) * 10)} m`;
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value / 1000)} km`;
}

function collectCoordinates(value, target, depth) {
  if (depth > 9 || !Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    target.push([value[0], value[1]]);
    return;
  }
  for (const item of value) collectCoordinates(item, target, depth + 1);
}

function validPoint(lat, lon) {
  const y = Number(lat);
  const x = Number(lon);
  return Number.isFinite(y) && Number.isFinite(x) && y >= -90 && y <= 90 && x >= -180 && x <= 180;
}

function toRad(value) {
  return value * Math.PI / 180;
}
