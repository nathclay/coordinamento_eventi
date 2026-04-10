/* ================================================================
   js/location.js
   Foreground GPS tracking — sends positions to location_history.
   Depends on: rpc.js, state.js
================================================================ */

const LOCATION_THROTTLE_MS = 15000; // max one insert per 15 seconds
let lastLocationSent = 0;
let watchId = null;

function startLocationTracking() {
  if (!('geolocation' in navigator)) {
    console.warn('Geolocation not available on this device.');
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    pos => onPosition(pos),
    err => console.warn('GPS error:', err.message),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
  );
}

function stopLocationTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

async function onPosition(pos) {
  const now = Date.now();
  if (now - lastLocationSent < LOCATION_THROTTLE_MS) return;
  if (!STATE.isOnline) return; // no point trying if offline
  lastLocationSent = now;

  await insertLocation(pos.coords);
}

// One-shot: get current position (used by incident form for geolocation)
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 30000,
    });
  });
}