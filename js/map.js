/* ================================================================
   js/map.js
   Leaflet map instances for mobile views.
   - Mini map: info panel (static, shows initial resource position)
   - Coordinator map: full map with resource + incident markers
   Depends on: state.js
================================================================ */

let miniMapInstance      = null;
let mapInstance = null;
const mapMarkers    = {};  // resource_id -> L.marker

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
   ICONS
---------------------------------------------------------------- */
function ownResourceIcon() {
  const r = STATE.resource;
  const label = (r.resource || r.resource_type || '?').substring(0, 8);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="38" height="48" viewBox="0 0 38 48">
      <rect x="1" y="1" width="36" height="30" rx="6" fill="#1e7fff" stroke="#ffffff" stroke-width="2.5"/>
      <text x="19" y="20" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,sans-serif" font-size="9" font-weight="700" fill="#ffffff">${label}</text>
      <polygon points="14,31 24,31 19,40" fill="#1e7fff" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="19" cy="44" r="3" fill="#ffffff" opacity="0.9"/>
    </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [38, 48], iconAnchor: [19, 44], popupAnchor: [0, -48] });
}

function resourceIcon(resource, status) {
  const colors = { free: '#3fb950', busy: '#f0883e', stopped: '#484f58' };
  const color  = colors[status] || colors.free;
  const label  = resource.resource_type === 'LDC'
    ? 'LDC ' + (resource.resource || '').replace(/[^0-9]/g, '')
    : (resource.resource || resource.resource_type || '?').substring(0, 8);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="38" height="42" viewBox="0 0 38 42">
      <rect x="1" y="1" width="36" height="30" rx="6" fill="#161b22" stroke="${color}" stroke-width="2"/>
      <text x="19" y="20" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,sans-serif" font-size="9" font-weight="700" fill="${color}">${label}</text>
      <polygon points="14,31 24,31 19,40" fill="${color}"/>
    </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [38, 42], iconAnchor: [19, 40], popupAnchor: [0, -42] });
}

/* ----------------------------------------------------------------
   MAP — full interactive map
---------------------------------------------------------------- */
async function initMap() {
  if (mapInstance) {
    await refreshMapMarkers();
    return;
  }
  if (!STATE.event)             return;
  if (typeof L === 'undefined') return;

  const lat  = STATE.event.center_lat  || 41.9;
  const lng  = STATE.event.center_lng  || 12.5;
  const zoom = STATE.event.default_zoom || 14;

  mapInstance = L.map('map', {
    zoomControl: true,
    attributionControl: true,
  }).setView([lat, lng], zoom);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CartoDB',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(mapInstance);

  await refreshMapMarkers();
}

async function refreshMapMarkers() {
  if (!mapInstance) return;

  // Own position
  const ownPos = await fetchResourcePosition();
  if (ownPos?.geom) {
    const [lng, lat] = ownPos.geom.coordinates;
    const lastSeen = ownPos.updated_at
      ? new Date(ownPos.updated_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : '—';
    const popup = `<strong>${STATE.resource.resource}</strong><br>
      <span style="font-size:11px;color:#8b949e;">Ultima pos: ${lastSeen}</span>`;

    if (mapMarkers['own']) {
      mapMarkers['own'].setLatLng([lat, lng]);
      mapMarkers['own'].getPopup().setContent(popup);
    } else {
      mapMarkers['own'] = L.marker([lat, lng], { icon: ownResourceIcon(), zIndexOffset: 1000 })
        .addTo(mapInstance)
        .bindPopup(popup);
      mapInstance.setView([lat, lng], mapInstance.getZoom());
    }
  }

  // Sector resources — coordinator only
  if (STATE.resource.resource_type !== 'LDC') return;

  const resources = await fetchSectorResources();

  resources.forEach(r => {
    const rcs  = r.resources_current_status;
    if (!rcs?.geom) return;

    const [lng, lat] = rcs.geom.coordinates;
    const status  = rcs.status || 'free';
    const lastSeen = rcs.location_updated_at
      ? new Date(rcs.location_updated_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : '—';
    const popup = `<strong>${r.resource}</strong><br>
      <span style="font-size:11px;color:#8b949e;">${r.resource_type} · Ultima pos: ${lastSeen}</span>`;

    if (mapMarkers[r.id]) {
      mapMarkers[r.id].setLatLng([lat, lng]);
      mapMarkers[r.id].setIcon(resourceIcon(r, status));
      mapMarkers[r.id].getPopup().setContent(popup);
    } else {
      mapMarkers[r.id] = L.marker([lat, lng], { icon: resourceIcon(r, status) })
        .addTo(mapInstance)
        .bindPopup(popup);
    }
  });
}

function invalidateMap() {
  if (mapInstance) setTimeout(() => mapInstance.invalidateSize(), 50);
}