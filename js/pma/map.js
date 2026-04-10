/* ================================================================
   js/map.js
   Leaflet map instances for mobile views.
   - Mini map: info panel (static, shows initial resource position)
   - Coordinator map: full map with resource + incident markers
   Depends on: state.js
================================================================ */

let miniMapInstance      = null;
let coordinatorMapInstance = null;

/* ----------------------------------------------------------------
   MINI MAP — info panel, static overview
---------------------------------------------------------------- */
function initMiniMap() {
  if (miniMapInstance) return;
  if (!STATE.event)    return;
  if (typeof L === 'undefined') return;

  const lat = STATE.event.center_lat || 41.9;
  const lng = STATE.event.center_lng || 12.5;

  miniMapInstance = L.map('mini-map', {
    zoomControl:       false,
    dragging:          false,
    scrollWheelZoom:   false,
    touchZoom:         false,
    doubleClickZoom:   false,
    attributionControl: false,
  }).setView([lat, lng], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
  }).addTo(miniMapInstance);

  // Mark initial position if resource has a geom
  // (coordinates resolved by RPC — for now use event center as placeholder)
  L.circleMarker([lat, lng], {
    radius: 8, color: '#1e7fff', fillColor: '#1e7fff', fillOpacity: 0.4,
    weight: 2,
  }).addTo(miniMapInstance);
}

function invalidateMiniMap() {
  if (miniMapInstance) setTimeout(() => miniMapInstance.invalidateSize(), 50);
}

/* ----------------------------------------------------------------
   COORDINATOR MAP — full interactive map
---------------------------------------------------------------- */
function initCoordinatorMap() {
  if (coordinatorMapInstance) return;
  if (!STATE.event)            return;
  if (typeof L === 'undefined') return;

  const lat  = STATE.event.center_lat  || 41.9;
  const lng  = STATE.event.center_lng  || 12.5;
  const zoom = STATE.event.default_zoom || 14;

  coordinatorMapInstance = L.map('coordinator-map', {
    zoomControl: true,
    attributionControl: true,
  }).setView([lat, lng], zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18,
  }).addTo(coordinatorMapInstance);

  // TODO Phase 2: load resource markers via get_active_event_assets() RPC
  // TODO Phase 2: load incident markers via get_active_event_incidents() RPC
  // TODO Phase 2: subscribe to Realtime to move markers live
}

function invalidateCoordinatorMap() {
  if (coordinatorMapInstance) setTimeout(() => coordinatorMapInstance.invalidateSize(), 50);
}