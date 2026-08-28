/* Pure great-circle geometry — no DOM, no state, no network.
   Used by the map's "nearby places" feature to turn a set of reverse-
   geocoded candidate points into real distances from the selected location. */

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/* Haversine great-circle distance between two lat/lon points, in kilometres.
   Accurate enough at the tens-of-kilometres scale "nearby" operates at —
   this app has no need for ellipsoidal (Vincenty) precision. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* A point `distanceKm` from (lat, lon) along `bearingDeg` (0 = north,
   clockwise, same convention as core/units.js compass()). Flat-earth
   approximation — fine at the tens-of-kilometres probe radius this is used
   for; the error only becomes noticeable over hundreds of kilometres. */
export function offsetPoint(lat, lon, bearingDeg, distanceKm) {
  const bearingRad = toRad(bearingDeg);
  const latRad = toRad(lat);
  const dLatDeg = ((distanceKm / EARTH_RADIUS_KM) * Math.cos(bearingRad) * 180) / Math.PI;
  const dLonDeg =
    ((distanceKm / EARTH_RADIUS_KM) * Math.sin(bearingRad) * 180) / Math.PI / Math.cos(latRad);
  return { lat: lat + dLatDeg, lon: lon + dLonDeg };
}
