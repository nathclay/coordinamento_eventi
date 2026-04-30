/* ================================================================
   js/map.js
   Leaflet map instances for mobile views.
   - Mini map: info panel (static, shows initial resource position)
   - Coordinator map: full map with resource + incident markers
   Depends on: state.js
================================================================ */

let miniMapInstance      = null;
let mapInstance = null;
let gridLayerGroup = null;
let gridLabelsLayer = null;
let poiLayerGroup  = null;
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
    zoomControl:     true,
    attributionControl: true,
  }).setView([lat, lng], zoom);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CartoDB',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(mapInstance);

  const LayerControl = L.Control.extend({
      onAdd: function() {
        const div = L.DomUtil.create('div');
        div.innerHTML = `
          <div style="background:white;border-radius:8px;padding:4px;
            box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:4px;">
          <button id="btn-toggle-grid" onclick="toggleGridLayer()" style="
            padding:6px 10px;border-radius:6px;border:none;cursor:pointer;
            background:#f5f5f5;color:#333;font-size:12px;font-weight:700;">
            🗂 Griglia
          </button>
          <button id="btn-toggle-poi" onclick="togglePoiLayer()" style="
            padding:6px 10px;border-radius:6px;border:none;cursor:pointer;
            background:#f5f5f5;color:#333;font-size:12px;font-weight:700;">
            📍 Punti
          </button>
          </div>`;
        L.DomEvent.disableClickPropagation(div);
        return div;
      }
    });
    new LayerControl({ position: 'topright' }).addTo(mapInstance);

  const SendPositionControl = L.Control.extend({
    onAdd: function() {
      const div = L.DomUtil.create('div');
      div.innerHTML = `
        <button id="btn-map-send-position" style="
          padding:9px 14px;border-radius:var(--radius);
          border:1.5px solid var(--border-bright);background:white;
          color:#333;font-size:12px;font-weight:600;
          font-family:var(--font);cursor:pointer;
          box-shadow:0 1px 5px rgba(0,0,0,0.3);">
          📍 Invia posizione
        </button>`;
      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  new SendPositionControl({ position: 'bottomleft' }).addTo(mapInstance);

  const CercaControl = L.Control.extend({
    onAdd: function() {
      const div = L.DomUtil.create('div');
      div.innerHTML = `
        <button id="btn-map-cerca" style="
          padding:9px 14px;border-radius:var(--radius);
          border:1.5px solid var(--blue);background:white;
          color:#1060cc;font-size:12px;font-weight:700;
          font-family:var(--font);cursor:pointer;
          box-shadow:0 1px 5px rgba(0,0,0,0.3);">
          🔍 Cerca
        </button>`;
      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  new CercaControl({ position: 'bottomright' }).addTo(mapInstance);

    await loadEventGeoLayers();
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

    let zoneLabel = '';
    if (STATE.event?.is_grid) {
      const label = await getZoneLabel(lat, lng);
      zoneLabel = ` · ${label}`;
    }

    const popup = `<strong>${STATE.resource.resource}</strong><br>
      <span style="font-size:11px;color:#8b949e;">Ultima pos: ${lastSeen}<br>Settore: ${zoneLabel}</span>`;



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

  await refreshEnRouteMarker();


  // Sector resources — coordinator only
  if (STATE.resource.resource_type !== 'LDC') return;

  const resources = await fetchSectorResources();

  for (const r of resources) {
    const rcs  = r.resources_current_status;
    if (!rcs?.geom) continue;

    const [lng, lat] = rcs.geom.coordinates;
    const status  = rcs.status || 'free';
    const lastSeen = rcs.location_updated_at
      ? new Date(rcs.location_updated_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : '—';
    let zoneLabel = '';
    if (STATE.event?.is_grid) {
      const label = await getZoneLabel(lat, lng);
      zoneLabel = ` · ${label}`;
    }

    const popup = `<strong>${r.resource}</strong><br>
      <span style="font-size:11px;color:#8b949e;">Ultima pos: ${lastSeen}<br>Settore: ${zoneLabel}</span>`;


    if (mapMarkers[r.id]) {
      mapMarkers[r.id].setLatLng([lat, lng]);
      mapMarkers[r.id].setIcon(resourceIcon(r, status));
      mapMarkers[r.id].getPopup().setContent(popup);
    } else {
      mapMarkers[r.id] = L.marker([lat, lng], { icon: resourceIcon(r, status) })
        .addTo(mapInstance)
        .bindPopup(popup);
    }
  }
}

async function refreshEnRouteMarker() {

  if (!mapInstance) return;

  // Find any incident where this resource is en_route_to_incident
  const enRouteInc = (STATE.incidents || []).find(i =>
    (i.incident_responses || []).some(r =>
      r.resource_id === STATE.resource.id &&
      r.outcome === 'en_route_to_incident'
    )
  );

  // Remove existing marker if no longer en route
  if (!enRouteInc) {
    if (mapMarkers['enroute']) {
      mapInstance.removeLayer(mapMarkers['enroute']);
      delete mapMarkers['enroute'];
    }
    return;
  }

  if (!enRouteInc.geom?.coordinates) return;
  const [lng, lat] = enRouteInc.geom.coordinates;

  const triageColors = { red: '#e53935', yellow: '#fdd835', green: '#43a047', white: '#bdbdbd' };
  const color = triageColors[enRouteInc.current_triage] || '#1e7fff';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="13" fill="${color}" stroke="#fff" stroke-width="3"/>
      <text x="16" y="21" text-anchor="middle" font-size="14" font-weight="bold" fill="#fff">!</text>
    </svg>`;

  const icon = L.divIcon({ html: svg, className: '', iconSize: [32,32], iconAnchor: [16,16] });

  const popup = `
    <div style="font-family:system-ui;min-width:140px;">
      <div style="font-weight:700;font-size:13px;margin-bottom:6px;">
        📍 Da raggiungere
      </div>
      <div style="font-size:12px;color:#666;margin-bottom:8px;">
        ${enRouteInc.location_description || enRouteInc.incident_type || '—'}
      </div>
      <button onclick="openIncidentDetail('${enRouteInc.id}')" style="
        width:100%;padding:7px;border-radius:6px;
        background:#1e7fff;color:white;border:none;
        font-size:12px;font-weight:700;cursor:pointer;">
        Apri intervento
      </button>
    </div>`;

  if (mapMarkers['enroute']) {
    mapMarkers['enroute'].setLatLng([lat, lng]);
    mapMarkers['enroute'].getPopup().setContent(popup);
  } else {
    mapMarkers['enroute'] = L.marker([lat, lng], { icon, zIndexOffset: 500 })
      .addTo(mapInstance)
      .bindPopup(popup);
  }

  // Fly to it on first load
  if (!mapMarkers['enroute']._flownTo) {
    mapInstance.setView([lat, lng], 16);
    mapMarkers['enroute']._flownTo = true;
    mapMarkers['enroute'].openPopup();
  }
}

function invalidateMap() {
  if (mapInstance) setTimeout(() => mapInstance.invalidateSize(), 50);
}

async function updateMapZone(lat, lng) {
  if (!STATE.event?.is_grid) return;

  const el = document.getElementById('map-sector-value');
  if (!el) return;

  const { data } = await db.rpc('get_zone_for_point', {
    p_event_id: STATE.resource.event_id,
    p_lng:      lng,
    p_lat:      lat,
  });

  el.textContent = (data && data.length > 0) ? data[0].grid_label : 'Fuori Zona';
  if (data && data.length > 0) {
    el.textContent = data[0].grid_label;
    el.style.color = 'var(--text-primary)';
  } else {
    el.textContent = 'Fuori zona';
    el.style.color = 'var(--text-secondary)';
  }
}

async function getZoneLabel(lat, lng) {
  const { data } = await db.rpc('get_zone_for_point', {
    p_event_id: STATE.resource.event_id,
    p_lng:      lng,
    p_lat:      lat,
  });
  return (data?.length) ? data[0].grid_label : 'nd';
}

async function updateMapKm(lat, lng) {
  if (!STATE.event?.is_route) return;

  const el = document.getElementById('map-km-value');
  if (!el) return;

  const { data } = await db.rpc('get_nearest_route_marker', {
    p_event_id: STATE.resource.event_id,
    p_lng:      lng,
    p_lat:      lat,
  });

  if (data && data.length > 0) {
    const m = data[0];
    const label = m.label ? `${m.km} — ${m.label}` : `${m.km}`;
    el.textContent = label;
    el.style.color = 'var(--text-primary)';
  } else {
    el.textContent = '—';
    el.style.color = 'var(--text-secondary)';
  }
}

async function refreshMapInfoBar() {
  const ev = STATE.event;

  // Row 1 — last position time
  const pos = await fetchResourcePosition();
  const timeEl = document.getElementById('map-position-time');
  if (pos?.updated_at) {
    timeEl.textContent = new Date(pos.updated_at)
      .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  } else {
    timeEl.textContent = 'nd';
  }

  // Send position button
  const sendBtn = document.getElementById('btn-map-send-position');
  if (sendBtn && !sendBtn.dataset.wired) {
    sendBtn.dataset.wired = '1';
    sendBtn.addEventListener('click', async () => {
      if (!STATE.event?.is_active) {
        showToast('Evento non attivo — invio posizione disabilitato', 'error');
        return;
      }
      sendBtn.textContent = '📍 Localizzazione...';
      sendBtn.disabled = true;
      try {
        const pos = await getCurrentPosition();
        await insertLocation(pos.coords);
        document.getElementById('map-position-time').textContent =
          new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        await refreshMapMarkers();
        await updateMapZone(pos.coords.latitude, pos.coords.longitude);  
        await updateMapKm(pos.coords.latitude, pos.coords.longitude);  
        showToast('Posizione inviata ✓', 'success');
      } catch (_) {
        showToast('GPS non disponibile', 'error');
      } finally {
        sendBtn.textContent = '📍 Invia posizione attuale';
        sendBtn.disabled = false;
      }
    });
  }

  // Row 2 — sector (is_grid)
  const sectorRow = document.getElementById('map-sector-row');
  if (ev?.is_grid) {
    sectorRow.style.display = '';
    // Seed with last known position
    if (pos?.geom?.coordinates) {
      const [lng, lat] = pos.geom.coordinates;
      updateMapZone(lat, lng);
    }
    // Register GPS callback once
    if (!sectorRow.dataset.zoneWired) {
      sectorRow.dataset.zoneWired = '1';
      onLocationSent(coords => updateMapZone(coords.latitude, coords.longitude));
    }
  }

  // Row 3 — km (is_route)
  const kmRow = document.getElementById('map-km-row');
  if (ev?.is_route) {
    kmRow.style.display = '';
    // Seed with last known position
    if (pos?.geom?.coordinates) {
      const [lng, lat] = pos.geom.coordinates;
      updateMapKm(lat, lng);
    }
    // Register GPS callback once
    if (!kmRow.dataset.kmWired) {
      kmRow.dataset.kmWired = '1';
      onLocationSent(coords => updateMapKm(coords.latitude, coords.longitude));
    }
  }
  await initCercaPanel();
}

async function loadEventGeoLayers() {
  if (!mapInstance || !STATE.event) return;
  const ev = STATE.event;

  if (ev.is_route) {
    const { data } = await db
      .from('event_route')
      .select('geom, name')
      .eq('event_id', STATE.resource.event_id);

    (data || []).forEach(row => {
      if (!row.geom) return;
      const geom = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
      if (geom.crs) delete geom.crs;
      L.geoJSON({ type: 'Feature', geometry: geom, properties: {} }, {
        style: { color: '#f0883e', weight: 3, opacity: 0.8 },
      }).bindPopup(`<strong>${row.name || 'Percorso'}</strong>`)
        .addTo(mapInstance);
    });
  }

  if (ev.is_grid) {
    const { data } = await db
      .from('grid')
      .select('geom, label')
      .eq('event_id', STATE.resource.event_id);

    gridLayerGroup = L.layerGroup();
    (data || []).forEach(row => {
      if (!row.geom) return;
      const geom = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
      if (geom.crs) delete geom.crs;
      L.geoJSON({ type: 'Feature', geometry: geom, properties: {} }, {
        style: { color: '#58a6ff', weight: 1.5, opacity: 0.7, fillOpacity: 0.08, fillColor: '#58a6ff' },
      }).bindPopup(`<strong>${row.label || '—'}</strong>`)
        .addTo(gridLayerGroup);
    });
    if (data?.length) addGridAxisLabels(data, mapInstance);
  }

  const { data: pois } = await db
    .from('event_poi')
    .select('geom, label, poi_type')
    .eq('event_id', STATE.resource.event_id);

  if (pois?.length) {
    poiLayerGroup = L.layerGroup();
    pois.forEach(row => {
      if (!row.geom?.coordinates) return;
      const [lng, lat] = row.geom.coordinates;
      L.marker([lat, lng], { icon: poiIcon(row.poi_type) })  // ← use poiIcon
        .bindPopup(`<strong>${row.label || '—'}</strong>${row.poi_type ? `<br><span style="font-size:11px;color:#888">${row.poi_type}</span>` : ''}`)
        .addTo(poiLayerGroup);
    });
  }

}

function toggleGridLayer() {
  if (!gridLayerGroup || !mapInstance) return;
  const btn = document.getElementById('btn-toggle-grid');
  if (mapInstance.hasLayer(gridLayerGroup)) {
    mapInstance.removeLayer(gridLayerGroup);
    if (gridLabelsLayer) mapInstance.removeLayer(gridLabelsLayer);
    if (btn) { btn.style.background = '#f5f5f5'; btn.style.color = '#333'; }
  } else {
    mapInstance.addLayer(gridLayerGroup);
    if (gridLabelsLayer) mapInstance.addLayer(gridLabelsLayer);
    if (btn) { btn.style.background = 'var(--blue-dim)'; btn.style.color = '#1060cc'; }
  }
}

function togglePoiLayer() {
  if (!poiLayerGroup || !mapInstance) return;
  const btn = document.getElementById('btn-toggle-poi');
  if (mapInstance.hasLayer(poiLayerGroup)) {
    mapInstance.removeLayer(poiLayerGroup);
    if (btn) { btn.style.background = '#f5f5f5'; btn.style.color = '#333'; }
  } else {
    mapInstance.addLayer(poiLayerGroup);
    if (btn) { btn.style.background = 'var(--blue-dim)'; btn.style.color = '#1060cc'; }
  }
}

const POI_ICONS = {
  PMA: { svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="22" height="22" rx="4" fill="#e53935"/>
    <path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>
  </svg>` },

  Campo: { svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="22" height="22" rx="4" fill="#2e7d32"/>
    <ellipse cx="12" cy="12" rx="5" ry="5" fill="none" stroke="#fff" stroke-width="1.5"/>
    <path d="M7 7l10 10M17 7L7 17" stroke="#fff" stroke-width="1" opacity="0.5"/>
    <circle cx="12" cy="12" r="2" fill="#fff"/>
  </svg>` },

  Stadio: { svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="22" height="22" rx="4" fill="#1565c0"/>
    <ellipse cx="12" cy="13" rx="8" ry="5" fill="none" stroke="#fff" stroke-width="1.5"/>
    <path d="M4 13V9a8 5 0 0116 0v4" stroke="#fff" stroke-width="1.5" fill="none"/>
    <path d="M4 9c0-2.8 3.6-5 8-5s8 2.2 8 5" stroke="#fff" stroke-width="1" opacity="0.5" fill="none"/>
  </svg>` },

  utilità: { svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="22" height="22" rx="4" fill="#f57c00"/>
    <path d="M12 4l1.5 4.5H18l-3.75 2.7 1.5 4.5L12 13.2l-3.75 2.5 1.5-4.5L6 8.5h4.5z" fill="#fff"/>
  </svg>` },

  default: { svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="22" height="22" rx="4" fill="#ffa657"/>
    <circle cx="12" cy="12" r="4" fill="#fff"/>
  </svg>` },
};

function poiIcon(poi_type) {
  const def = POI_ICONS[poi_type] || POI_ICONS.default;
  const encoded = btoa(unescape(encodeURIComponent(def.svg)));
  return L.divIcon({
    className: '',
    html: `<img src="data:image/svg+xml;base64,${encoded}"
      style="width:28px;height:28px;border-radius:6px;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);" />`,
    iconSize:    [28, 28],
    iconAnchor:  [14, 14],
    popupAnchor: [0, -18],
  });
}

function addGridAxisLabels(cells, map) {
  gridLabelsLayer = L.layerGroup();

  cells.forEach(row => {
    const geom = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
    if (geom.crs) delete geom.crs;
    const b = L.geoJSON({ type: 'Feature', geometry: geom }).getBounds();

    L.marker([b.getNorth(), b.getEast()], {
      icon: L.divIcon({
        className: '',
        html: `<div style="font-size:9px;font-weight:700;color:#000000;
          font-family:system-ui,sans-serif;white-space:nowrap;
          opacity:0.8;">${row.label || '—'}</div>`,
        iconSize: [28, 14],
        iconAnchor: [28, 0],
      }),
      interactive: false,
      zIndexOffset: -200,
    }).addTo(gridLabelsLayer);
  });
}

let _cercaGridLayer  = null;
let _cercaPoiMarker  = null;

async function initCercaPanel() {

  const btn   = document.getElementById('btn-map-cerca');
  const panel = document.getElementById('map-cerca-panel');
  if (!btn || !panel) return;
  if (btn.dataset.cercaWired) return;
  btn.dataset.cercaWired = '1';

  const ev = STATE.event;

  // Fetch grid labels
  if (ev?.is_grid) {
    const { data: cells } = await db
      .from('grid')
      .select('id, label, geom')
      .eq('event_id', STATE.resource.event_id)
      .order('label');

    const gridSelect = document.getElementById('cerca-grid-select');

    if (cells?.length) {
      cells.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
      );

      gridSelect.innerHTML = '<option value="">— Seleziona zona —</option>' +
        cells.map(c => `<option value="${c.id}">${c.label}</option>`).join('');

    gridSelect.addEventListener('change', () => {
      const cell = cells.find(c => c.id === gridSelect.value);
      if (!cell) return;
      clearCercaLayers();
      const geom = typeof cell.geom === 'string' ? JSON.parse(cell.geom) : cell.geom;
      if (geom.crs) delete geom.crs;
      _cercaGridLayer = L.geoJSON({ type:'Feature', geometry: geom }, {
        style: { color: '#ffd700', weight: 3, opacity: 1, fillOpacity: 0.25, fillColor: '#ffd700' }  // ← yellow
      }).addTo(mapInstance);

      const b = _cercaGridLayer.getBounds();
      const center = b.getCenter();
      _cercaPoiMarker = L.marker([center.lat, center.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="font-size:16px;font-weight:800;color:#000;
            font-family:system-ui,sans-serif;white-space:nowrap;
            text-shadow:0 0 4px #fff,0 0 4px #fff;">
            ${cell.label}
          </div>`,
          iconAnchor: [20, 10],
        }),
        interactive: false,
        zIndexOffset: 100,
      }).addTo(mapInstance);

      mapInstance.fitBounds(_cercaGridLayer.getBounds(), { padding: [20, 20] });
    });
    }
  }

  // Fetch POI
  const { data: pois, error: poiError } = await db
    .from('event_poi')
    .select('id, label, poi_type, geom')
    .eq('event_id', STATE.resource.event_id)
    .order('label');

  const poiSelect = document.getElementById('cerca-poi-select');
  const POI_TYPE_ORDER = ['PMA', 'Stadio', 'Campo'];

  if (pois?.length) {
      pois.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
      );
    const groups = {};
    pois.forEach(p => {
      const type = p.poi_type || 'Altro';
      if (!groups[type]) groups[type] = [];
      groups[type].push(p);
    });

    const sortedGroups = Object.entries(groups).sort(([a], [b]) => {
      const ai = POI_TYPE_ORDER.indexOf(a);
      const bi = POI_TYPE_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    poiSelect.innerHTML = '<option value="">— Seleziona punto —</option>' +
        sortedGroups.map(([type, items]) => `
          <optgroup label="${type}">
            ${items.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}
          </optgroup>`
        ).join('');

      poiSelect.addEventListener('change', () => {
        const poi = pois.find(p => p.id === poiSelect.value);
        if (!poi?.geom?.coordinates) return;
        clearCercaLayers();
        const [lng, lat] = poi.geom.coordinates;
        _cercaPoiMarker = L.marker([lat, lng])
          .addTo(mapInstance)
          .bindPopup(`<strong>${poi.label}</strong>`)
          .openPopup();
        mapInstance.setView([lat, lng], 17);
      });
    }

  

  // Toggle panel open/close
  btn.addEventListener('click', () => {
    const isOpen = panel.style.display === 'flex';
    panel.style.display = isOpen ? 'none' : 'flex';
    panel.style.flexDirection = 'column';
    if (isOpen) clearCercaLayers();
  });

  // Close button
  document.getElementById('btn-cerca-close')
    ?.addEventListener('click', () => {
      panel.style.display = 'none';
      clearCercaLayers();
      document.getElementById('cerca-grid-select').value = '';
      document.getElementById('cerca-poi-select').value = '';
    });
}

function clearCercaLayers() {
  if (_cercaGridLayer) { mapInstance.removeLayer(_cercaGridLayer); _cercaGridLayer = null; }
  if (_cercaPoiMarker) { mapInstance.removeLayer(_cercaPoiMarker); _cercaPoiMarker = null; }
}