// Geo helpers used by the surveyor app to soft-warn (never block) when the
// device's GPS position is far from the settlement the surveyor opened a
// session for. The backend already flags >5km as `far_from_settlement`; we
// nudge at 2km so the surveyor knows BEFORE submitting that their response
// will be flagged for review.

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg) { return (deg * Math.PI) / 180; }

// Standard haversine. Inputs are GeoJSON-style [lng, lat] pairs to match the
// shape we send to the backend (`client_geo: { type: 'Point', coordinates: [lng, lat] }`).
// Returns metres between the two surface points.
export function haversineMeters([lng1, lat1], [lng2, lat2]) {
  if ([lng1, lat1, lng2, lat2].some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return Number.NaN;
  }
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// Captures the device location and reports back what happened. Three outcomes:
//   - { status: 'granted',     coords }  — user allowed and we got a fix
//   - { status: 'denied',      coords: null } — PositionError code === 1
//   - { status: 'unavailable', coords: null } — timeout, no API, or other error
// SessionStart uses this to differentiate "user actively denied" (educate
// them about Settings) from "GPS just isn't responding" (probably temporary).
export function tryCaptureLocation(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return resolve({ status: 'unavailable', coords: null });
    }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ status: 'unavailable', coords: null });
    }, timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ status: 'granted', coords: pos.coords });
      },
      (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // PositionError codes: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
        const status = err && err.code === 1 ? 'denied' : 'unavailable';
        resolve({ status, coords: null });
      },
      { timeout: timeoutMs, enableHighAccuracy: false, maximumAge: 60_000 },
    );
  });
}

// Decides whether to show the soft-warning modal before a response submit.
// Returns null when the warning shouldn't fire — the submit handler then
// proceeds straight to the network. Returns { km, accuracyM } when it
// SHOULD fire so the modal can render specifics.
//
// `coords` is the browser's GeolocationCoordinates (.latitude, .longitude,
// .accuracy). `settlementGeo` is the { lat, lng } pair we get from the
// settlements list. Threshold defaults to 2km.
export function distanceWarning(coords, settlementGeo, thresholdM = 2000) {
  if (!coords || !settlementGeo) return null;
  if (typeof settlementGeo.lat !== 'number' || typeof settlementGeo.lng !== 'number') return null;
  if (typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') return null;

  const meters = haversineMeters(
    [coords.longitude, coords.latitude],
    [settlementGeo.lng, settlementGeo.lat],
  );
  if (!Number.isFinite(meters) || meters <= thresholdM) return null;

  return {
    meters,
    km: Math.round((meters / 1000) * 10) / 10, // 1 decimal place
    accuracyM: typeof coords.accuracy === 'number' ? Math.round(coords.accuracy) : null,
  };
}
