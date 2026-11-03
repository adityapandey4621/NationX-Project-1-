export interface Coords {
  lat: number;
  lng: number;
}

/** Parse the "lat,lng" cookie value; anything malformed or out of range is ignored (never trusted). */
export function parseCoords(raw: string | undefined | null): Coords | null {
  if (!raw) return null;
  const m = /^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)$/.exec(raw.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

/** Round to 3 decimals (~110 m): enough for "1.2 km away", not enough to point at a house. */
export function serializeCoords({ lat, lng }: Coords): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/** "350 m", "1.2 km", "12 km". Returns null when the distance is unknown (never a guess). */
export function formatDistance(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km) || km < 0) return null;
  if (km < 1) return `${Math.max(Math.round(km * 10) * 100, 100)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}