/* ================================================================
   js/views/pca.js  —  Posto di Comando Avanzato
   Main dashboard view: map, incident panels, resource panels,
   all modals, geo layers, realtime subscription.

   Depends on: supabase.js, state.js, ui.js, pca-rpc.js,
               router.js, Leaflet
   Entry point: loadPCAView() called by auth.js after login.
================================================================ */

/* ── OWN STATE ─────────────────── */
let _geoLayerDefs = [];
let _geoLayerData = {};
let _incidentRefreshTimer = null;
let _resourceRefreshTimer = null;
let _dispositivoRefreshTimer = null;

const PCA = {
  map:          null,
  markers:      {},
  incMarkers:   {},
  layers: { risorse: null, coordinatori: null, attivi: null, chiusi: null },  
  geoLayers:    {},   
  activeLayers: new Set(['base', 'risorse', 'coordinatori', 'attivi']),
  allIncidents: [],
  allResources: [],
  resource:     null,   // the logged-in PCA resource row
  event:        null,   // the active event row
  eventId:      null,
  operator:     null,   // the selected personnel (can be null if skipped)
  activeFilters: new Set(),  // null | 'free' | 'recent'
  _baseTile:    null,
};

/* ================================================================
   INIT
   loadPCAView      — entry point called by auth.js after login.
                      Wires all buttons, starts clocks, initialises
                      map, loads data, starts Realtime.
   startClocks      — ticks the wall clock and race elapsed timer.
   subscribePCA     — single Realtime channel for incidents,
                      responses and resource status.
================================================================ */
async function loadPCAView() {
  const resource = STATE.resource;
  const event    = STATE.event;   // auth.js already fetched it

  PCA.resource = resource;
  PCA.event    = event;
  PCA.eventId  = event?.id || resource?.event_id;
  PCA.operator = STATE.personnel; // ← picks up cached personnel too

  console.log('[boot] PCA.event:', PCA.event);
  console.log('[boot] current_session:', PCA.event?.current_session);

  // Header
  document.getElementById('header-event-name').textContent =
    event?.name?.toUpperCase() || 'EVENTO';
 
  // Modal close buttons
  document.querySelectorAll('.modal-close, [data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.close || btn.closest('.modal-overlay')?.id;
      if (id) {
        closeModal(id);
        // Destroy mini map if closing new incident modal
        if (id === 'modal-new-incident' && _niMap) {
          _niMap.remove();
          _niMap = null;
        }
      }
    });
  });
 
  // Bottom bar
  document.getElementById('btn-new-incident')?.addEventListener('click', openNewIncidentModal);
  document.getElementById('btn-free-units')?.addEventListener('click', filterFreeUnits);
  document.getElementById('btn-recent-pos')?.addEventListener('click', flyToRecentPositions);
  document.getElementById('btn-search')?.addEventListener('click', focusMapSearch);
 
  // Map layer toggles
  document.querySelectorAll('.map-layer-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleMapLayer(btn.dataset.layer, btn));
  });

  // Panel resize
  initPanelResize();
 
  // Clocks
  startClocks(event?.start_time);
 
  // Show dashboard
  initRouter();
  showScreen('screen-main');
 
  // Map
  await initPCAMap(event);
  await loadGeoLayers();

  // Data
  await Promise.all([loadAllIncidents(), loadAllResources()]);
 
  // Realtime
  subscribePCA();
}
 
function startClocks(startTime) {
  function tick() {
    const now = new Date();
    const nowEl = document.getElementById('clock-now');
    if (nowEl) nowEl.textContent =
      now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
 
    const raceEl = document.getElementById('clock-race');
    if (raceEl && startTime) {
      const diff = now - new Date(startTime);
      if (diff < 0) {
        raceEl.textContent = '--:--';
      } else {
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        raceEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      }
    }
  }
  tick();
  setInterval(tick, 15000);
}

function subscribePCA() {
  if (!PCA.eventId) return;

  db.channel('pca-incidents')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' },
      () => { console.log('[rt] incidents'); scheduleIncidentRefresh(); })
    .subscribe();

  db.channel('pca-responses')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incident_responses' },
      () => { console.log('[rt] responses'); scheduleIncidentRefresh(); })
    .subscribe();

  db.channel('pca-locations')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resources_current_status' },
      (payload) => { console.log('[rt] location fired', payload); scheduleResourceRefresh(); })
    .subscribe((status, err) => console.log('[rt] locations status:', status, err ?? ''));

  db.channel('pca-resources')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' },
      () => scheduleDispositivoRefresh())
    .subscribe();

  db.channel('pca-personnel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'personnel' },
      () => scheduleDispositivoRefresh())
    .subscribe();
}

function scheduleIncidentRefresh() {
  clearTimeout(_incidentRefreshTimer);
  _incidentRefreshTimer = setTimeout(() => onIncidentChange(), 300);
}

function scheduleResourceRefresh() {
  clearTimeout(_resourceRefreshTimer);
  _resourceRefreshTimer = setTimeout(() => onResourceChange(), 300);
}

function scheduleDispositivoRefresh() {
  clearTimeout(_dispositivoRefreshTimer);
  _dispositivoRefreshTimer = setTimeout(() => onDispositivoChange(), 300);
}

async function onIncidentChange() {
  const data = await fetchPCAIncidents(PCA.eventId);
  PCA.allIncidents = data.filter(i => !isPMAOnly(i));

  if (document.getElementById('list-active-incidents')) {
    renderIncidentPanels();
    updateHeaderStats();
    PCA.allIncidents.forEach(i => {
      if (i.geom && i.status !== 'in_progress_in_pma') updateIncidentMarker(i);
    });
  }
  if (document.getElementById('soccorsi-body'))  renderSoccorsiTables();
  if (document.getElementById('pma-tabs'))        refreshPCAView();
  if (document.getElementById('hospital-body'))   renderOspedalizzazioni();
}

async function onResourceChange() {
  const data = await fetchPCAResources(PCA.eventId);
  PCA.allResources = data;

  if (document.getElementById('list-all-resources')) {
    const pmas   = PCA.allResources.filter(r => r.resource_type === 'PMA');
    const others = PCA.allResources.filter(r => !['PMA','PCA','LDC'].includes(r.resource_type));
    renderPMAList(pmas);
    renderResourceList('list-all-resources', others);
    document.getElementById('badge-resources-count').textContent = others.length;
    PCA.allResources.forEach(r => {
      const rcs = r.resources_current_status;
      if (rcs?.geom) updateResourceMarker(r, rcs.status || 'free', rcs.geom);
    });
  }
  if (document.getElementById('moduli-body'))   renderModuliTables();
  if (document.getElementById('soccorsi-body')) renderSoccorsiTables();
}

async function onDispositivoChange() {
  if (document.getElementById('disp-body')) await renderDispositivo();
}

// Convert session number to date label
function sessionLabel(n) {
  const start = PCA.event?.start_time;
  if (!start) return `Giornata ${n}`;
  const d = new Date(start);
  d.setDate(d.getDate() + (n - 1));
  return d.toLocaleDateString('it-IT', { weekday:'short', day:'numeric', month:'long' });
}

// Build the session dropdown HTML — pass current selected value and callback name
function buildSessionBar(selected, callbackName) {
  const max = PCA.event?.current_session || 1;
  if (max <= 1) return '';
  const opts = Array.from({ length: max }, (_, i) => i + 1)
    .map(s => `<option value="${s}" ${s === selected ? 'selected' : ''}>${sessionLabel(s)}</option>`)
    .join('');
  return `
    <div style="display:flex;align-items:center;gap:8px;padding:0 0 12px;">
      <label style="font-size:12px;font-weight:600;color:#8b949e;">Giornata:</label>
      <select onchange="${callbackName}(parseInt(this.value))"
        style="padding:5px 10px;border-radius:var(--radius);
          border:1.5px solid var(--border-bright);background:#161b22;
          color:#e6edf3;font-family:var(--font);font-size:13px;
          cursor:pointer;color-scheme:dark;">
        ${opts}
        <option value="-1" ${selected === -1 ? 'selected' : ''}>Tutte le giornate</option>
      </select>
    </div>`;
}

/* ================================================================
   MAP — SETUP
   initPCAMap          — creates the Leaflet instance and base layers.
   loadGeoLayers       — fetches all geo tables (route, grid, fixed,
                         markers, poi) and builds toggle buttons.
   buildGeoLayer       — renders a single geo table as a LayerGroup.
   toggleGeoLayer      — shows/hides a geo layer by key.
   switchBasemap       — swaps between voyager and satellite tiles.
   toggleMapLayer      — shows/hides resource/incident layers.
   toggleMapPanel      — collapses/expands the map control panel.
================================================================ */
async function initPCAMap(event) {
  const lat  = event?.center_lat  || 41.9;
  const lng  = event?.center_lng  || 12.5;
  const zoom = event?.default_zoom || 14;
 
  PCA.map = L.map('map', { zoomControl: true }).setView([lat, lng], zoom);
 
  PCA._baseTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CartoDB',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(PCA.map);
 
  PCA.layers.risorse       = L.layerGroup().addTo(PCA.map);
  PCA.layers.coordinatori  = L.layerGroup().addTo(PCA.map);
  PCA.layers.attivi        = L.layerGroup().addTo(PCA.map);
  PCA.layers.chiusi        = L.layerGroup();
}

function addGridAxisLabels(cells, map) {
  const TOLERANCE = 0.0001;

  // Compute centroid for each cell
  const cellData = cells.map(row => {
    const geom = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
    if (geom.crs) delete geom.crs;
    const b = L.geoJSON({ type: 'Feature', geometry: geom }).getBounds();
    return {
      lat: (b.getNorth() + b.getSouth()) / 2,
      lng: (b.getEast()  + b.getWest())  / 2,
      north: b.getNorth(),
      west:  b.getWest(),
    };
  });

  // Unique columns by longitude, sorted west→east → A, B, C...
  const uniqueLngs = [...new Set(
    cellData.map(c => Math.round(c.lng / TOLERANCE) * TOLERANCE)
  )].sort((a, b) => b - a);

  // Unique rows by latitude, sorted north→south → 1, 2, 3...
  const uniqueLats = [...new Set(
    cellData.map(c => Math.round(c.lat / TOLERANCE) * TOLERANCE)
  )].sort((a, b) => a - b);

  const gridNorth = Math.max(...cellData.map(c => c.north));
  const gridWest  = Math.min(...cellData.map(c => c.west));

  const labelStyle = `
    font-size:11px;font-weight:700;color:var(--text-secondary, #888);
    font-family:system-ui,sans-serif;white-space:nowrap;`;

  // Letters along the top
  uniqueLngs.forEach((lng, i) => {
    const letter = String.fromCharCode(65 + i); // A=65
    L.marker([gridNorth, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="${labelStyle}">${letter}</div>`,
        iconSize:   [20, 16],
        iconAnchor: [10, -4],  // sits just above the top edge
      }),
      interactive: false,
      zIndexOffset: -200,
    }).addTo(map);
  });

  // Numbers along the left
  uniqueLats.forEach((lat, i) => {
    L.marker([lat, gridWest], {
      icon: L.divIcon({
        className: '',
        html: `<div style="${labelStyle}">${i + 1}</div>`,
        iconSize:   [20, 16],
        iconAnchor: [24, 8],   // sits just left of the west edge
      }),
      interactive: false,
      zIndexOffset: -200,
    }).addTo(map);
  });
}

async function loadGeoLayers() {
  const tables = [
    { key: 'route',   table: 'event_route',     label: 'Percorso',        },
    { key: 'grid',    table: 'grid',             label: 'Griglia',         },
    { key: 'fixed',   table: 'fixed_resources',  label: 'Risorse fisse',   },
    { key: 'markers', table: 'markers_route',    label: 'Marker percorso', },
    { key: 'poi',     table: 'event_poi',        label: 'POI',             },
  ];

  _geoLayerDefs = tables;
  const togglesEl  = document.getElementById('geo-layer-toggles');
  const sectionEl  = document.getElementById('geo-layers-section');
  let anyVisible   = false;

  for (const def of tables) {
    const data = await fetchGeoLayer(PCA.eventId, def.table);

    if (!data || data.length === 0) continue;
    anyVisible = true;
    _geoLayerData[def.key] = data;

    const layer = buildGeoLayer(def, data);
    PCA.geoLayers[def.key] = layer;
    if (def.key === 'grid') addGridAxisLabels(data, layer);  

    const color = GEO_STYLES[def.key]?.color || '#fff';
    const row = document.createElement('div');
    row.className = 'geo-layer-row';
    row.innerHTML = `
      <button class="map-layer-btn" data-geo="${def.key}"
        style="border-left:3px solid ${color};"
        onclick="toggleGeoLayer('${def.key}', this)">${def.label}</button>
      <button class="geo-style-btn" title="Stile"
        onclick="openGeoStyleModal('${def.key}','${def.label}')">⚙</button>`;
    togglesEl?.appendChild(row);
  }

  if (anyVisible && sectionEl) sectionEl.style.display = '';
}

function buildGeoLayer(def, rows) {
  const group = L.layerGroup();
  const s     = GEO_STYLES[def.key];

  rows.forEach(row => {
    if (!row.geom) return;
    const geom = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom;
    if (geom.crs) delete geom.crs;

    if (def.key === 'route') {
      L.geoJSON({ type: 'Feature', geometry: geom, properties: {} }, {
        style: { color: s.color, weight: s.weight, opacity: s.opacity },
      }).bindPopup(`<strong>${row.name || 'Percorso'}</strong>`).addTo(group);
    }
    else if (def.key === 'grid') {
      const cellLayer = L.geoJSON({ type: 'Feature', geometry: geom, properties: {} }, {
        style: { color: s.color, weight: s.weight, opacity: s.opacity,
                fillOpacity: s.fillOpacity, fillColor: s.color },
      }).bindPopup(`<strong>${row.label || '—'}</strong>`).addTo(group);

    }
    else if (def.key === 'fixed' || def.key === 'markers' || def.key === 'poi') {
      if (!geom.coordinates) return;
      const [lng, lat] = geom.coordinates;
      const label = def.key === 'markers'
        ? (row.km != null ? 'km ' + row.km : row.label || '—')
        : (row.name || row.label || '—');
      let icon;
      if (s.markerType === 'label') {
        const fontSize  = s.radius;        
        const padding   = 10;
        const boxW      = Math.max(40, label.length * (fontSize * 0.65) + padding * 2);
        const boxH      = fontSize + 14;
        const arrowY    = boxH + 1;
        const arrowTip  = boxH + 10;
        const totalH    = boxH + 10;
        const safeLbl = label
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        const svg = `
          <svg xmlns="http://www.w3.org/2000/svg"
            width="${boxW}" height="${totalH}"
            viewBox="0 0 ${boxW} ${totalH}">
            <rect x="1" y="1" width="${boxW-2}" height="${boxH}"
              rx="5" fill="#161b22" stroke="${s.color}" stroke-width="2"
              opacity="${s.opacity}"/>
            <text x="${boxW/2}" y="${boxH/2+1}" text-anchor="middle"
              dominant-baseline="middle" font-family="system-ui,sans-serif"
              font-size="${fontSize}" font-weight="700" fill="${s.color}">
              ${safeLbl}
            </text>
            <polygon
              points="${boxW/2-6},${arrowY} ${boxW/2+6},${arrowY} ${boxW/2},${arrowTip}"
              fill="${s.color}" opacity="${s.opacity}"/>
          </svg>`;
        icon = L.divIcon({
          html: svg, className: '',
          iconSize:    [boxW, totalH],
          iconAnchor:  [boxW/2, totalH],
          popupAnchor: [0, -totalH],
        });
      } else {
        icon = L.divIcon({
          html: `<div style="width:${s.radius*2}px;height:${s.radius*2}px;border-radius:50%;
            background:${s.color};border:2px solid #0d1117;opacity:${s.opacity};"></div>`,
          className: '',
          iconSize:   [s.radius*2, s.radius*2],
          iconAnchor: [s.radius, s.radius],
        });
      }
      L.marker([lat, lng], { icon })
        .bindPopup(`<strong>${label}</strong>`)
        .addTo(group);
    }
  });
  return group;
}

function toggleGeoLayer(key, btn) {
  const layer = PCA.geoLayers[key];
  if (!layer || !PCA.map) return;
  if (PCA.map.hasLayer(layer)) {
    PCA.map.removeLayer(layer);
    btn.classList.remove('active');
  } else {
    PCA.map.addLayer(layer);
    btn.classList.add('active');
  }
}

function switchBasemap(style) {
  if (!PCA.map || !PCA._baseTile) return;
  PCA.map.removeLayer(PCA._baseTile);

  const urls = {
    voyager:   'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  };
  const attributions = {
    voyager:   '© OpenStreetMap © CartoDB',
    satellite: '© Esri © USGS',
  };

  PCA._baseTile = L.tileLayer(urls[style], {
    attribution: attributions[style],
    maxZoom: 19,
    subdomains: style === 'voyager' ? 'abcd' : '',
  }).addTo(PCA.map);

  // Make sure base tile is below everything
  PCA._baseTile.bringToBack();
}

function toggleMapLayer(layerName, btn) {
  if (layerName === 'base') return;
  const layer = PCA.layers[layerName];
  if (!layer) return;
  if (PCA.activeLayers.has(layerName)) {
    PCA.map.removeLayer(layer);
    PCA.activeLayers.delete(layerName);
    btn.classList.remove('active');
  } else {
    PCA.map.addLayer(layer);
    PCA.activeLayers.add(layerName);
    btn.classList.add('active');
  }
}

function toggleMapPanel() {
  const body    = document.getElementById('map-ctrl-body');
  const chevron = document.getElementById('map-ctrl-chevron');
  const open    = body.style.display !== 'none';
  body.style.display  = open ? 'none' : '';
  chevron.textContent = open ? '▸' : '▾';
}

/* ================================================================
   MAP — CONTROLS
   filterFreeUnits       — toggles "show only free units" filter.
   flyToRecentPositions  — toggles "show only recently seen" filter.
   applyMapFilter        — applies active filters to resource markers.
   focusMapSearch        — prompt-based resource search, flies to marker.
================================================================ */
function filterFreeUnits() {
  PCA.activeFilters.has('free') ? PCA.activeFilters.delete('free') : PCA.activeFilters.add('free');
  document.getElementById('btn-free-units').classList.toggle('active', PCA.activeFilters.has('free'));
  applyMapFilter();
}

function flyToRecentPositions() {
  PCA.activeFilters.has('recent') ? PCA.activeFilters.delete('recent') : PCA.activeFilters.add('recent');
  document.getElementById('btn-recent-pos').classList.toggle('active', PCA.activeFilters.has('recent'));
  applyMapFilter();
}

function applyMapFilter() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  PCA.allResources.forEach(r => {
    const marker = PCA.markers[r.id];
    if (!marker) return;
    const rcs = r.resources_current_status;
    let visible = true;
    if (PCA.activeFilters.has('free') && rcs?.status !== 'free') visible = false;
    if (PCA.activeFilters.has('recent')) {
      const t = rcs?.location_updated_at;
      if (!t || new Date(t).getTime() <= cutoff) visible = false;
    }
    const layer = r.resource_type === 'LDC' ? PCA.layers.coordinatori : PCA.layers.risorse;
    if (visible) {
      if (!layer.hasLayer(marker)) layer.addLayer(marker);
    } else {
      if (layer.hasLayer(marker)) layer.removeLayer(marker);
    }
  });
}
 
function focusMapSearch() {
  const q = prompt('Cerca risorsa:');
  if (!q) return;
  const r = PCA.allResources.find(res => res.resource.toLowerCase().includes(q.toLowerCase()));
  if (r?.resources_current_status?.geom) {
    const [lng, lat] = r.resources_current_status.geom.coordinates;
    PCA.map.setView([lat, lng], 16);
  } else {
    showToast('Non trovato', 'error');
  }
}

/* ================================================================
   MAP — GEO LAYER STYLES
   GEO_STYLES        — default style config per layer key.
   openGeoStyleModal — opens the style editor for a given layer.
   applyGeoStyle     — reads modal inputs, rebuilds layer with new style.
================================================================ */
const GEO_STYLES = {
  route:   { color: '#f0883e', weight: 3,    opacity: 0.8, fillOpacity: 0 },
  grid:    { color: '#58a6ff', weight: 1.5,  opacity: 0.7, fillOpacity: 0.08 },
  fixed:   { color: '#bc8cff', radius: 6,  opacity: 1, markerType: 'dot' },
  markers: { color: '#ffffff', radius: 4,  opacity: 1, markerType: 'label' },
  poi:     { color: '#ffa657', radius: 6,  opacity: 1, markerType: 'dot' },
};

function openGeoStyleModal(key, label) {
  const s    = GEO_STYLES[key];
  const isLine = key === 'route';
  const isPoly = key === 'grid';
  const isPt   = ['fixed','markers','poi'].includes(key);

  document.getElementById('geo-style-title').textContent = `Stile — ${label}`;

  document.getElementById('geo-style-body').innerHTML = `
    <div class="form-group">
      <label>Colore</label>
      <input type="color" id="gs-color" value="${s.color}"
        style="width:100%;height:36px;border:none;background:none;cursor:pointer;" />
    </div>
    ${(isLine) ? `
    <div class="form-group">
      <label>Spessore linea (${s.weight}px)</label>
      <input type="range" id="gs-weight" min="1" max="10" step="0.5" value="${s.weight}"
        oninput="this.previousElementSibling.textContent='Spessore linea ('+this.value+'px)'"
        style="width:100%;" />
    </div>` : ''}
    ${(isPt) ? `
    <div class="form-group">
      <label>Tipo marker</label>
      <div style="display:flex;gap:6px;">
        <button type="button" class="pca-yn-btn ${s.markerType === 'dot'   ? 'active-yes' : ''}"
          onclick="this.closest('.form-group').querySelectorAll('.pca-yn-btn').forEach(b=>b.classList.remove('active-yes'));this.classList.add('active-yes');document.getElementById('gs-marker-type').value='dot'">
          Punto
        </button>
        <button type="button" class="pca-yn-btn ${s.markerType === 'label' ? 'active-yes' : ''}"
          onclick="this.closest('.form-group').querySelectorAll('.pca-yn-btn').forEach(b=>b.classList.remove('active-yes'));this.classList.add('active-yes');document.getElementById('gs-marker-type').value='label'">
          Etichetta
        </button>
      </div>
      <input type="hidden" id="gs-marker-type" value="${s.markerType}" />
    </div>
    <div class="form-group">
      <label id="gs-radius-label">${s.markerType === 'label' ? `Dimensione testo (${s.radius}px)` : `Dimensione punto (${s.radius}px)`}</label>
      <input type="range" id="gs-radius" min="6" max="24" step="1" value="${s.radius}"
        oninput="this.previousElementSibling.textContent=
          (document.getElementById('gs-marker-type').value==='label'?'Dimensione testo':'Dimensione punto')
          +' ('+this.value+'px)'"
        style="width:100%;" />
    </div>` : ''}
    <div class="form-group">
      <label>Opacità contorni (${Math.round(s.opacity * 100)}%)</label>
      <input type="range" id="gs-opacity" min="0" max="1" step="0.05" value="${s.opacity}"
        oninput="this.previousElementSibling.textContent='Opacità ('+Math.round(this.value*100)+'%)'"
        style="width:100%;" />
    </div>
    ${(isPoly) ? `
    <div class="form-group">
      <label>Opacità riempimento (${Math.round(s.fillOpacity * 100)}%)</label>
      <input type="range" id="gs-fill-opacity" min="0" max="1" step="0.05" value="${s.fillOpacity}"
        oninput="this.previousElementSibling.textContent='Opacità riempimento ('+Math.round(this.value*100)+'%)'"
        style="width:100%;" />
    </div>` : ''}`;

  document.getElementById('geo-style-save').onclick = () => applyGeoStyle(key);
  openModal('modal-geo-style');
}

function applyGeoStyle(key) {
  const s = GEO_STYLES[key];
  s.color = document.getElementById('gs-color')?.value || s.color;
  const w = document.getElementById('gs-weight');
  const r = document.getElementById('gs-radius');
  const o = document.getElementById('gs-opacity');
  const f = document.getElementById('gs-fill-opacity');
  const mt = document.getElementById('gs-marker-type');
  if (mt) s.markerType = mt.value;
  if (w) s.weight      = parseFloat(w.value);
  if (r) s.radius      = parseFloat(r.value);
  if (o) s.opacity     = parseFloat(o.value);
  if (f) s.fillOpacity = parseFloat(f.value);

  // Rebuild the layer with new styles
  const layer = PCA.geoLayers[key];
  const wasOn = layer && PCA.map.hasLayer(layer);

  // Find the raw data and rebuild
  const def = _geoLayerDefs.find(d => d.key === key);
  const data = _geoLayerData[key];
  if (!def || !data) { closeModal('modal-geo-style'); return; }

  if (layer) {
    PCA.map.removeLayer(layer);
    layer.clearLayers();
  }

  const newLayer = buildGeoLayer(def, data);
  PCA.geoLayers[key] = newLayer;
  if (wasOn) PCA.map.addLayer(newLayer);

  // Update color indicator on button
  const btn = document.querySelector(`[data-geo="${key}"]`);
  if (btn) btn.style.borderLeftColor = s.color;

  closeModal('modal-geo-style');
}

/* ================================================================
   MAP — MARKERS & ICONS
   resourceIcon         — SVG divIcon for a resource, coloured by status.
   incidentIcon         — SVG divIcon for an incident, coloured by triage.
   updateResourceMarker — creates or updates a resource marker on the map.
   updateIncidentMarker — creates or updates an incident marker, moving
                          it between active/closed layers as status changes.
================================================================ */
function resourceIcon(resource, status) {
  const colors = { free: '#3fb950', busy: '#f0883e', stopped: '#484f58' };
  const color  = colors[status] || colors.free;
  const label = resource.resource_type === 'LDC'
    ? 'LDC ' + (resource.resource || '').replace(/[^0-9]/g, '')
    : (resource.resource || resource.resource_type || '?').substring(0, 8);  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="38" height="42" viewBox="0 0 38 42">
      <rect x="1" y="1" width="36" height="30" rx="6" fill="#161b22" stroke="${color}" stroke-width="2"/>
      <text x="19" y="20" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,sans-serif" font-size="9" font-weight="700" fill="${color}">${label}</text>
      <polygon points="14,31 24,31 19,40" fill="${color}"/>
    </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [38, 42], iconAnchor: [19, 40], popupAnchor: [0, -42] });
}
 
function incidentIcon(triage) {
  const colors = { red: '#e24b4a', yellow: '#d29922', green: '#3fb950', white: '#cccccc' };
  const color  = colors[triage] || '#8b949e';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="9" fill="${color}" stroke="#0d1117" stroke-width="2"/>
      <text x="11" y="15" text-anchor="middle" font-family="system-ui" font-size="11" fill="#0d1117" font-weight="700">!</text>
    </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -14] });
}
 
async function updateResourceMarker(resource, status, geom) {
  if (!PCA.map || !geom) return;
  const [lng, lat] = geom.coordinates;
  const layer = resource.resource_type === 'LDC'
    ? PCA.layers.coordinatori
    : PCA.layers.risorse;

  const fullResource = PCA.allResources.find(r => r.id === resource.id);
  const lastPos = formatTime(fullResource?.resources_current_status?.location_updated_at);
  let zoneLabel = '';
  if (PCA.event?.is_grid) {
    const zone = await fetchZoneForPoint(PCA.eventId, lat, lng);
    if (zone) zoneLabel = `<br><span style="font-size:11px;color:#58a6ff;">🗂 ${zone.grid_label}</span>`;
  }

  const popup = `
    <strong style="font-size:13px;">${resource.resource}</strong><br>
    <span style="font-size:11px;color:#8b949e;">
        Ultima pos: ${lastPos}<br>
        ${PCA.event?.is_grid ? `Settore: ${zoneLabel}<br>` : ''}
      </span>
    <button onclick="openResourceDetailModal('${resource.id}')" class="map-popup-btn">
      Dettagli →
    </button>`;
  if (PCA.markers[resource.id]) {
    PCA.markers[resource.id].setLatLng([lat, lng]);
    PCA.markers[resource.id].setIcon(resourceIcon(resource, status));
    PCA.markers[resource.id].getPopup().setContent(popup);
  } else {
    const marker = L.marker([lat, lng], { icon: resourceIcon(resource, status) })
      .addTo(layer)
      .bindPopup(popup);
    PCA.markers[resource.id] = marker;
  }
}

function updateIncidentMarker(incident) {
  if (!PCA.map || !incident.geom) return;
  const [lng, lat] = incident.geom.coordinates;

  const isActive = ['open','in_progress'].includes(incident.status);
  const targetLayer = isActive ? PCA.layers.attivi : PCA.layers.chiusi;
  const resource = incident.incident_responses?.map(r => r.resources?.resource).filter(Boolean).join(', ') || '—';
  const triage   = incident.current_triage || 'null';
  const triageLabels = { red: 'Rosso', yellow: 'Giallo', green: 'Verde', white: 'Bianco' };
  const triageText = triageLabels[incident.current_triage] || 'ND';
  const popup = `
    <strong style="font-size:13px;">Intervento</strong><br>
    <span style="font-size:11px;color:#8b949e;">Risorsa: ${resource}</span><br>
    <span style="font-size:11px;color:#8b949e;">Codice: ${triageText}</span><br>
    <span style="font-size:11px;color:#8b949e;">Ore ${formatTime(incident.created_at)}</span>
    <button onclick="openIncidentDetailModal('${incident.id}')" class="map-popup-btn">Dettagli →</button>`;

  if (PCA.incMarkers[incident.id]) {
    const marker = PCA.incMarkers[incident.id];
    // Move to correct layer if needed — safely check both layers
    [PCA.layers.attivi, PCA.layers.chiusi].forEach(l => {
      if (l && l.hasLayer(marker)) l.removeLayer(marker);
    });
    if (targetLayer) targetLayer.addLayer(marker);
    marker.setLatLng([lat, lng]);
    marker.setIcon(incidentIcon(incident.current_triage));
    marker.getPopup().setContent(popup);
  } else {
    if (!targetLayer) return;
    const marker = L.marker([lat, lng], { icon: incidentIcon(incident.current_triage) })
      .addTo(targetLayer)
      .bindPopup(popup);
    PCA.incMarkers[incident.id] = marker;
  }
}
 
/* ================================================================
   INCIDENTS — DATA
   isPMAOnly            — returns true if all responses are PMA type
                          (used to filter walk-ins from the main list).
   loadAllIncidents     — fetches all non-cancelled incidents, updates
                          PCA.allIncidents, redraws panels and markers.
   renderIncidentPanels — splits incidents into active/closed and
                          renders both lists in the left panel.
   renderIncidentList   — renders a single list of incident cards.
   selectIncident       — flies to the incident marker if visible,
                          otherwise opens the detail modal.
   updateHeaderStats    — updates the triage count badges in the header.
================================================================ */
function isPMAOnly(incident) {
  const responses = incident.incident_responses || [];
  if (responses.length === 0) return false;
  return responses.every(r => r.resources?.resource_type === 'PMA');
}

async function loadAllIncidents() {
  if (!document.getElementById('list-active-incidents')) return;
    const data = await fetchPCAIncidents(PCA.eventId);
    console.log('[incidents] loaded:', data?.length, 'session:', PCA.event?.current_session);

    PCA.allIncidents = data.filter(i => !isPMAOnly(i));


  renderIncidentPanels();
  updateHeaderStats();
  PCA.allIncidents.forEach(i => { 
    if (i.geom && i.status !== 'in_progress_in_pma') updateIncidentMarker(i); 
  });
}
 
function renderIncidentPanels() {
  const activeEl = document.getElementById('badge-active-count');
  const closedEl = document.getElementById('badge-closed-count');
  if (!activeEl || !closedEl) return;  // ← not on home page, skip

  const active = PCA.allIncidents.filter(i =>
    ['open', 'in_progress'].includes(i.status)
  );
  const closed = PCA.allIncidents.filter(i =>
    ['resolved', 'taken_to_hospital', 'in_progress_in_pma'].includes(i.status)
  );
 
  document.getElementById('badge-active-count').textContent = active.length;
  document.getElementById('badge-closed-count').textContent = closed.length;
  renderIncidentList('list-active-incidents', active);
  renderIncidentList('list-closed-incidents', closed);
}
 
function renderIncidentList(containerId, incidents) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (incidents.length === 0) {
    el.innerHTML = '<div class="empty-state">Nessun soccorso</div>';
    return;
  }
  const statusLabel = {
    open: 'Aperto', in_progress: 'In corso', in_progress_in_pma: 'In PMA',
    resolved: 'Risolto', taken_to_hospital: 'Ospedale', cancelled: 'Annullato'
  };
  el.innerHTML = incidents.map(i => {
    const triage   = i.current_triage || 'none';
    const resource = i.incident_responses?.map(r => r.resources?.resource).filter(Boolean).join(', ') || '—';
    const patient  = i.patient_name || i.patient_identifier || 'Paziente anonimo';
 return `
  <div class="incident-card" onclick="selectIncident('${i.id}')">
    <div class="ic-top">
      <div class="ic-triage-dot ${triage}"></div>
      <span class="ic-type">${i.description || '—'}</span>
      <span class="ic-time">${formatTime(i.created_at)}</span>
    </div>
    <div class="ic-meta">${resource}</div>
    <div class="ic-resource">
      <span class="ic-status-tag ${i.status}">${statusLabel[i.status] || i.status}</span>
    </div>
  </div>`;
  }).join('');
}
 
function selectIncident(incidentId) {
  const marker = PCA.incMarkers[incidentId];
  if (marker && PCA.map) {
    PCA.map.setView(marker.getLatLng(), 17);
    marker.openPopup();
  } else {
    openIncidentDetailModal(incidentId);
  }
}

function updateHeaderStats() {
  const active = PCA.allIncidents.filter(i =>
    ['open', 'in_progress'].includes(i.status)
  );
  const count = t => active.filter(i => i.current_triage === t).length;
 
  document.getElementById('val-active').textContent  = active.length;
  document.getElementById('val-red').textContent     = count('red');
  document.getElementById('val-yellow').textContent  = count('yellow');
  document.getElementById('val-green').textContent   = count('green');
  document.getElementById('val-white').textContent   = count('white');
  document.getElementById('val-none').textContent    = active.filter(i => !i.current_triage).length;
 
  // 2. RESOURCES: Count Busy units EXCLUDING PMA and LDC
  const busyFieldUnits = PCA.allResources.filter(r => 
    r.resource_type !== 'PMA' && r.resource_type !== 'LDC' &&
    r.resources_current_status?.status === 'busy'
  ).length;
  document.getElementById('val-busy').textContent = busyFieldUnits;

  const pmaActive = PCA.allResources
    .filter(r => r.resource_type === 'PMA')
    .reduce((sum, r) => sum + (r.resources_current_status?.active_responses || 0), 0);
  document.getElementById('val-pma').textContent = pmaActive;
}

/* ================================================================
   INCIDENTS — DETAIL MODAL
   buildAssessment       — builds the HTML block for a single
                           patient assessment entry.
   openIncidentDetailModal — fetches full incident data and renders
                             the detail modal (patient, assessment
                             history, response chain, action buttons).
   showOutcomeConfirm    — shows inline confirm UI when operator
                           selects a new outcome from the dropdown.
   cancelOutcomeChange   — dismisses inline confirm, resets select.
   confirmOutcomeChange  — commits the outcome change via rpc.
   openAddResourceModal  — populates and opens the add-resource modal.
   confirmAddResource    — inserts a new incident_response row.
   openCloseIncidentModal — opens the close-incident confirmation modal.
   confirmCloseIncident  — bulk-closes all active responses on incident.
================================================================ */
function buildAssessment(inc, a) {
  const triageLabels = { red: 'Rosso', yellow: 'Giallo', green: 'Verde', white: 'Bianco' };
  const yn = v => v === true
    ? '<span class="yn-yes">Sì</span>'
    : v === false ? '<span class="yn-no">No</span>' : '—';

  const responseResource = inc.incident_responses
    ?.find(r => r.id === a.response_id)?.resources?.resource || '—';

  return `
    <div class="assessment-entry">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:11px;color:var(--text-muted)">
          ${new Date(a.assessed_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
        </span>
        <span style="font-size:11px;color:var(--text-secondary)">${responseResource}</span>
      </div>
      <div class="vitals-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:8px;">
        <div class="vital-item"><strong>${yn(a.conscious)}</strong>Coscienza</div>
        <div class="vital-item"><strong>${yn(a.respiration)}</strong>Respiro</div>
        <div class="vital-item"><strong>${yn(a.circulation)}</strong>Circolo</div>
        <div class="vital-item"><strong>${yn(a.walking)}</strong>Cammina</div>
        <div class="vital-item"><strong>${yn(a.minor_injuries)}</strong>Prob. min.</div>
        <div class="vital-item"><strong>${triageLabels[a.triage] || '—'}</strong>Triage</div>
      </div>
      <div class="vitals-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:8px;">
        ${a.heart_rate     ? `<div class="vital-item"><strong>${a.heart_rate}</strong>FC</div>` : ''}
        ${a.spo2           ? `<div class="vital-item"><strong>${a.spo2}%</strong>SpO2</div>` : ''}
        ${a.breathing_rate ? `<div class="vital-item"><strong>${a.breathing_rate}</strong>FR</div>` : ''}
        ${a.blood_pressure ? `<div class="vital-item"><strong>${a.blood_pressure}</strong>PA</div>` : ''}
        ${a.temperature    ? `<div class="vital-item"><strong>${a.temperature}°</strong>Temp</div>` : ''}
        ${a.gcs_total      ? `<div class="vital-item"><strong>${a.gcs_total}</strong>GCS</div>` : ''}
        ${a.hgt            ? `<div class="vital-item"><strong>${a.hgt}</strong>HGT</div>` : ''}
        ${a.iv_access != null ? `<div class="vital-item"><strong>${yn(a.iv_access)}</strong>Acc. venoso</div>` : ''}

      </div>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default;"
        title="${a.description ?? ''}">Descr: ${a.description ?? '—'}</td>
    </div>`;
}

async function openIncidentDetailModal(incidentId) {
  const inc = await fetchIncidentDetail(incidentId);
  if (!inc) return;

  const isActive = ['open', 'in_progress'].includes(inc.status);
  const triageLabels = { red: 'Rosso', yellow: 'Giallo', green: 'Verde', white: 'Bianco' };
  const triage = inc.current_triage || 'none';

  // ── Title
  document.getElementById('modal-incident-title').innerHTML =
    `Soccorso &mdash; <span class="triage-pill ${triage}">${triageLabels[triage] || 'Nessun codice'}</span>`;


  const sorted = [...(inc.patient_assessments || [])]
    .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at));

  const latestAssessment = sorted.length > 0
    ? buildAssessment(inc, sorted[0])
    : '<div class="empty-state">Nessun rilevamento</div>';

  const historyBlock = sorted.length > 1 ? `
    <div style="margin-top:8px;">
      <button onclick="this.nextElementSibling.style.display=
        this.nextElementSibling.style.display==='none'?'block':'none';
        this.textContent=this.textContent.includes('Mostra')?
        'Nascondi precedenti':'Mostra precedenti (${sorted.length - 1})'"
        style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;padding:0;">
        Mostra precedenti (${sorted.length - 1})
      </button>
      <div style="display:none;">
      ${sorted.slice(1).map(a => buildAssessment(inc, a)).join('')}      </div>
    </div>` : '';

  // ── Response chain
  const responses = [...(inc.incident_responses || [])]
    .sort((a, b) => new Date(a.assigned_at) - new Date(b.assigned_at));

  const chainHTML = responses.length === 0
    ? '<div class="empty-state">Nessuna unità coinvolta</div>'
    : responses.map(r => {
        const isActiveResp = ['en_route_to_incident','treating',
          'en_route_to_pma','en_route_to_hospital'].includes(r.outcome);
        const canChange = isActiveResp && r.resources?.resource_type !== 'PMA';
        return `
          <div class="response-chain-row ${isActiveResp ? 'chain-active' : 'chain-done'}"
               id="chain-row-${r.id}">
            <div class="chain-dot ${r.outcome}"></div>
            <div class="chain-body">
              <span class="chain-resource">${r.resources?.resource || '—'}</span>
              <span class="chain-outcome">${formatOutcome(r.outcome)}</span>
            </div>
            <div class="chain-times">
              <span>${formatTime(r.assigned_at)}</span>
              ${r.released_at
                ? `<span class="chain-arrow">→</span><span>${formatTime(r.released_at)}</span>`
                : ''}
            </div>
            ${canChange ? `
              <div class="chain-actions">
                <select class="outcome-select"
                  onchange="showOutcomeConfirm('${r.id}', this.value, '${incidentId}', this)">
                  <option value="">— Cambia esito —</option>
                  <option value="treating">In trattamento</option>
                  <option value="en_route_to_incident">In arrivo</option>
                  <option value="treated_and_released">Trattato e dimesso</option>
                  <option value="en_route_to_pma">Verso PMA</option>
                  <option value="en_route_to_hospital">Verso ospedale</option>
                  <option value="taken_to_hospital">Arrivato in ospedale</option>
                  <option value="taken_to_pma">Arrivato al PMA</option>
                  <option value="consegnato_118">Consegnato 118</option>
                  <option value="refused_transport">Rifiuta trasporto</option>
                </select>
                <div class="outcome-confirm hidden" id="confirm-${r.id}">
                  <span class="confirm-label">Confermare?</span>
                  <button class="confirm-yes" 
                    onclick="confirmOutcomeChange('${r.id}', '${incidentId}')">✓</button>
                  <button class="confirm-no"
                    onclick="cancelOutcomeChange('${r.id}')">✗</button>
                </div>
              </div>` : ''}
          </div>`;
      }).join('');

  // ── Compose modal body
  document.getElementById('modal-incident-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-section">
        <div class="detail-label">Paziente</div>
        <div class="detail-row"><span>Nome</span><span>${inc.patient_name || '—'}</span></div>
        <div class="detail-row"><span>Identificativo</span><span>${inc.patient_identifier || '—'}</span></div>
        <div class="detail-row"><span>Età</span><span>${inc.patient_age || '—'}</span></div>
        <div class="detail-row"><span>Sesso</span><span>${inc.patient_gender || '—'}</span></div>
        ${inc.description ? `
          <div style="margin-top:10px;font-size:12px;color:var(--text-secondary);
            padding:8px;background:var(--bg);border-radius:var(--radius);
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default;"
            title="${inc.description}">
            ${inc.description}
          </div>` : ''}
        <div class="detail-label" style="margin-top:16px;">Ultimo rilevamento</div>
        ${latestAssessment}
        ${historyBlock}
      </div>
      <div class="detail-section">
        <div class="detail-label">Catena interventi</div>
        <div class="response-chain">${chainHTML}</div>
      </div>
    </div>`;

  // ── Footer
  const footer = document.getElementById('modal-incident-footer');

  if (isActive) {
    footer.innerHTML = `
      <button class="btn-secondary"
        onclick="openAddResourceModal('${incidentId}')">+ Aggiungi risorsa</button>
      <button class="btn-secondary" style="margin-left:auto;color:var(--red);border-color:var(--red);"
        onclick="openCloseIncidentModal('${incidentId}')">Chiudi soccorso</button>`;
  } else {
    footer.innerHTML = '';
  }

  openModal('modal-incident');
}

const _pendingOutcome = {};

function showOutcomeConfirm(responseId, outcome, incidentId, selectEl) {
  if (!outcome) return;
  _pendingOutcome[responseId] = { outcome, incidentId };
  const confirmEl = document.getElementById(`confirm-${responseId}`);
  if (confirmEl) confirmEl.classList.remove('hidden');
  if (selectEl)  selectEl.disabled = true;
}

function cancelOutcomeChange(responseId) {
  delete _pendingOutcome[responseId];
  const confirmEl = document.getElementById(`confirm-${responseId}`);
  if (confirmEl) confirmEl.classList.add('hidden');
  // Re-enable and reset the select
  const row = document.getElementById(`chain-row-${responseId}`);
  const sel = row?.querySelector('.outcome-select');
  if (sel) { sel.value = ''; sel.disabled = false; }
}

async function confirmOutcomeChange(responseId, incidentId) {
  const pending = _pendingOutcome[responseId];
  if (!pending) return;

  const ok = await updateResponseOutcome(responseId, pending.outcome);

  delete _pendingOutcome[responseId];

  if (!ok) { showToast('Errore aggiornamento esito', 'error'); return; }
  showToast('Esito aggiornato ✓', 'success');

  // Refresh modal in place + background data
  openIncidentDetailModal(incidentId);
  loadAllIncidents();
  loadAllResources();
}

function openAddResourceModal(incidentId) {
  const select = document.getElementById('ni-add-resource');
  const nonPMA = PCA.allResources.filter(r => !['PMA','PCA'].includes(r.resource_type));
  select.innerHTML = '<option value="">— Scegli —</option>' +
    nonPMA.map(r => {
      const status = r.resources_current_status?.status || 'free';
      return `<option value="${r.id}">
        ${r.resource} (${r.resource_type}) — ${statusItalian(status)}
      </option>`;
    }).join('');
  document.getElementById('ni-add-error').textContent = '';
  document.getElementById('ni-add-confirm').onclick = () => confirmAddResource(incidentId);
  openModal('modal-add-resource');
}

async function confirmAddResource(incidentId) {
  const resourceId = document.getElementById('ni-add-resource').value;
  const outcome    = document.getElementById('ni-add-outcome').value;
  const errEl      = document.getElementById('ni-add-error');
  errEl.textContent = '';
  if (!resourceId) { errEl.textContent = 'Seleziona una risorsa.'; return; }

  const ok = await insertIncidentResponse({
    eventId: PCA.eventId, incidentId, resourceId, outcome, role: 'backup',
  });

  if (!ok) { errEl.textContent = 'Errore durante l\'aggiunta.'; return; }
  showToast('Risorsa aggiunta ✓', 'success');
  closeModal('modal-add-resource');
  openIncidentDetailModal(incidentId);
  loadAllIncidents();
  loadAllResources();
}

function openCloseIncidentModal(incidentId) {
  document.getElementById('ci-error').textContent = '';
  document.getElementById('ci-confirm').onclick = () => confirmCloseIncident(incidentId);
  openModal('modal-close-incident');
}

async function confirmCloseIncident(incidentId) {
  const outcome = document.getElementById('ci-outcome').value;
  const errEl   = document.getElementById('ci-error');
  errEl.textContent = '';

  const ok = await closeIncidentResponses(incidentId, outcome);
  if (!ok) { errEl.textContent = 'Errore durante la chiusura.'; return; }

  showToast('Soccorso chiuso ✓', 'success');
  closeModal('modal-close-incident');
  closeModal('modal-incident');
  loadAllIncidents();
  loadAllResources();
}
 
/* ================================================================
   INCIDENTS — NEW INCIDENT MODAL
   NI_FORM / _ni* vars  — form state for the new incident modal.
                          Reset on every open, never on individual
                          input handlers.
   openNewIncidentModal — resets state, builds modal body HTML,
                          initialises mini Leaflet map for location pick.
   niSetYN / niSetTriage / niAdjustAge / niSelectGender
                        — input handlers that update NI_FORM state.
   submitNewIncident    — validates, builds RPC params, calls
                          createPCAIncident, refreshes data.
================================================================ */
const NI_FORM = {
  conscious: null, respiration: null, circulation: null,
  walking: null, minor_injuries: null, triage: null, iv_access: null
};
let _niAge    = null;
let _niGender = null;
let _niLat    = null;
let _niLng    = null;
let _niMap    = null;
let _niMarker = null;

async function openNewIncidentModal() {
  // Reset state
  Object.assign(NI_FORM, {
    conscious: true, respiration: true, circulation: true,
    walking: null, minor_injuries: null, triage: null, iv_access: null
  });
  _niAge = null; _niGender = null; _niLat = null; _niLng = null;
  _niMap = null; _niMarker = null;

  const resourceOpts = '<option value="">— Senza risorsa —</option>' +
    PCA.allResources
      .filter(r => !['PMA','PCA'].includes(r.resource_type))
      .map(r => {
        const status = r.resources_current_status?.status || 'free';
        return `<option value="${r.id}">${r.resource} (${r.resource_type}) — ${statusItalian(status)}</option>`;
      }).join('');

  document.getElementById('ni-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <div class="form-group">
        <label>Nome paziente</label>
        <input type="text" id="ni-patient-name" placeholder="—" />
      </div>
      <div class="form-group">
        <label>Pettorale / ID</label>
        <input type="text" id="ni-patient-id" placeholder="—" />
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <div class="form-group">
        <label>Età apparente</label>
        <div style="display:flex;align-items:center;justify-content:space-between;
          border:1px solid var(--border-bright);border-radius:var(--radius);
          background:var(--bg);height:38px;padding:0 10px;">
          <input id="ni-age-display" type="number" min="0" max="120"
            placeholder="—"
            oninput="_niAge = parseInt(this.value) || null"
            style="font-size:15px;font-weight:700;color:var(--text-primary);
              width:50px;border:none;background:transparent;outline:none;-moz-appearance:textfield;"
              class="no-spinner" />
          <div style="display:flex;gap:4px;">
            <button type="button" onclick="niAdjustAge(-10)"
              style="width:32px;height:28px;border-radius:var(--radius);
                border:1px solid var(--border-bright);background:var(--bg-hover);
                color:var(--text-primary);font-size:14px;font-weight:700;cursor:pointer;">−</button>
            <button type="button" onclick="niAdjustAge(10)"
              style="width:32px;height:28px;border-radius:var(--radius);
                border:1px solid var(--border-bright);background:var(--bg-hover);
                color:var(--text-primary);font-size:14px;font-weight:700;cursor:pointer;">+</button>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Sesso</label>
        <div style="display:flex;border-radius:var(--radius);overflow:hidden;
          border:1px solid var(--border-bright);height:38px;">
          ${['M','F','Altro'].map(g => `
            <button type="button" class="ni-gender-btn" data-gender="${g}"
              onclick="niSelectGender(this,'${g}')"
              style="flex:1;border:none;border-right:1px solid var(--border-bright);
                background:var(--bg);color:var(--text-primary);
                font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;">
              ${g}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="form-group" style="margin-bottom:12px;">
      <label>Descrizione</label>
      <textarea id="ni-description" rows="2"
        style="width:100%;padding:8px 10px;border-radius:var(--radius);
          border:1px solid var(--border-bright);background:var(--bg);
          font-family:var(--font);font-size:13px;color:var(--text-primary);resize:vertical;"
        placeholder="Dinamica, sintomi..."></textarea>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
      ${[['conscious','Coscienza',true],['respiration','Respiro',true]].map(([field,label,def]) => `
        <div class="form-group">
          <label style="font-size:11px;color:var(--text-secondary);">${label}</label>
          <div style="display:flex;gap:6px;margin-top:4px;">
            <button type="button" class="pca-yn-btn${def===false||NI_FORM[field]===false?' active-no':''}"
              onclick="niSetYN(this,'${field}',false)" style="flex:1;">No</button>
            <button type="button" class="pca-yn-btn${def===true||NI_FORM[field]===true?' active-yes':''}"
              onclick="niSetYN(this,'${field}',true)" style="flex:1;">Sì</button>
          </div>
        </div>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
      ${[['circulation','Circolo',true],['walking','Cammina',null]].map(([field,label,def]) => `
        <div class="form-group">
          <label style="font-size:11px;color:var(--text-secondary);">${label}</label>
          <div style="display:flex;gap:6px;margin-top:4px;">
            <button type="button" class="pca-yn-btn${def===false||NI_FORM[field]===false?' active-no':''}"
              onclick="niSetYN(this,'${field}',false)" style="flex:1;">No</button>
            <button type="button" class="pca-yn-btn${def===true||NI_FORM[field]===true?' active-yes':''}"
              onclick="niSetYN(this,'${field}',true)" style="flex:1;">Sì</button>
          </div>
        </div>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
      <div class="form-group">
        <label style="font-size:11px;color:var(--text-secondary);">Problema Minore</label>
        <div style="display:flex;gap:6px;margin-top:4px;">
          <button type="button" class="pca-yn-btn"
            onclick="niSetYN(this,'minor_injuries',false)" style="flex:1;">No</button>
          <button type="button" class="pca-yn-btn"
            onclick="niSetYN(this,'minor_injuries',true)" style="flex:1;">Sì</button>
        </div>
      </div>
      <div class="form-group">
        <label style="font-size:11px;color:var(--text-secondary);">Triage</label>
        <div style="display:flex;gap:4px;margin-top:4px;">
          ${['white','green','yellow','red'].map(t => `
            <button type="button" class="pca-triage-btn ${t} ni-triage-btn"
              onclick="niSetTriage('${t}')" data-triage="${t}" style="flex:1;">
              ${t === 'white' ? 'Bianco' : t === 'green' ? 'Verde'
                : t === 'yellow' ? 'Giallo' : 'Rosso'}
            </button>`).join('')}
        </div>
      </div>
    </div>


    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:4px;">
      <div class="form-group">
        <label>FR</label>
        <input type="number" id="ni-breathing-rate" placeholder="—" min="0" max="60" />
      </div>
      <div class="form-group">
        <label>SpO2</label>
        <input type="number" id="ni-spo2" placeholder="—" min="0" max="100" />
      </div>
      <div class="form-group">
        <label>FC</label>
        <input type="number" id="ni-heart-rate" placeholder="—" min="0" max="300" />
      </div>
      <div class="form-group">
        <label>PA</label>
        <input type="text" id="ni-blood-pressure" placeholder="—" />
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <button type="button" id="ni-extra-toggle"
        onclick="document.getElementById('ni-extra-params').style.display=
          document.getElementById('ni-extra-params').style.display==='none'?'grid':'none';
          this.textContent=this.textContent.includes('▸')?'▾ Meno parametri':'▸ Ulteriori parametri';"
        style="font-size:11px;color:var(--blue);background:none;border:none;
          cursor:pointer;padding:0;">▸ Ulteriori parametri</button>
      <div id="ni-extra-params" style="display:none;grid-template-columns:repeat(4,1fr);
        gap:8px;margin-top:8px;">
        <div class="form-group">
          <label>Temp</label>
          <input type="number" id="ni-temperature" placeholder="—" step="0.1" />
        </div>
        <div class="form-group">
          <label>GCS</label>
          <input type="number" id="ni-gcs" placeholder="—" min="3" max="15" />
        </div>
        <div class="form-group">
          <label>HGT</label>
          <input type="text" id="ni-hgt" placeholder="—" />
        </div>
        <div class="form-group">
          <label>Acc. venoso</label>
          <div style="display:flex;gap:6px;margin-top:4px;">
            <button type="button" class="pca-yn-btn"
              onclick="niSetYN(this,'iv_access',false)" style="flex:1;">No</button>
            <button type="button" class="pca-yn-btn"
              onclick="niSetYN(this,'iv_access',true)" style="flex:1;">Sì</button>
          </div>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <div class="form-group">
        <label>Posizione sulla mappa</label>
        <div id="ni-map-container" style="height:180px;border-radius:var(--radius);
          border:1px solid var(--border-bright);overflow:hidden;margin-top:4px;">
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">
          Clicca sulla mappa per posizionare il marker
        </div>
        <div id="ni-coords" style="font-size:10px;color:var(--text-secondary);margin-top:2px;"></div>
      </div>
      <div class="form-group">
        <label>Descrizione luogo</label>
        <textarea id="ni-location-desc" rows="4"
          style="width:100%;padding:8px 10px;border-radius:var(--radius);
            border:1px solid var(--border-bright);background:var(--bg);
            font-family:var(--font);font-size:13px;color:var(--text-primary);resize:vertical;"
          placeholder="Es. Km 12 del percorso, zona ristoro nord..."></textarea>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:4px;">
      <div class="form-group">
        <label>Risorsa assegnata</label>
        <select id="ni-resource">${resourceOpts}</select>
      </div>
      <div class="form-group">
        <label>Outcome iniziale</label>
        <select id="ni-outcome">
          <option value="treating">In trattamento</option>
          <option value="en_route_to_incident">In arrivo</option>
        </select>
      </div>
    </div>
    <div id="ni-error" class="error-msg"></div>`;

  document.getElementById('btn-submit-incident').onclick = submitNewIncident;
  openModal('modal-new-incident');

  // Init mini map after modal is visible
  setTimeout(() => {
    const center = PCA.map ? PCA.map.getCenter() : { lat: 41.9, lng: 12.5 };
    const zoom   = PCA.map ? PCA.map.getZoom()   : 14;

    _niMap = L.map('ni-map-container', { zoomControl: true })
      .setView([center.lat, center.lng], zoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CartoDB',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(_niMap);

    _niMap.on('click', e => {
      _niLat = e.latlng.lat;
      _niLng = e.latlng.lng;

      if (_niMarker) _niMarker.remove();
      _niMarker = L.marker([_niLat, _niLng]).addTo(_niMap);

      document.getElementById('ni-coords').textContent =
        `📍 ${_niLat.toFixed(6)}, ${_niLng.toFixed(6)}`;
    });
  }, 50);
}

function niSetYN(btn, field, value) {
  if (NI_FORM[field] === value) {
    NI_FORM[field] = null;
    btn.classList.remove('active-yes', 'active-no');
    return;
  }
  NI_FORM[field] = value;
  btn.closest('div').querySelectorAll('.pca-yn-btn').forEach(b =>
    b.classList.remove('active-yes', 'active-no'));
  btn.classList.add(value ? 'active-yes' : 'active-no');
}

function niSetTriage(triage) {
  NI_FORM.triage = triage;
  document.querySelectorAll('.ni-triage-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.triage === triage));
}

function niAdjustAge(delta) {
  if (_niAge === null) _niAge = 50;
  else _niAge = Math.max(0, Math.min(120, _niAge + delta));
  document.getElementById('ni-age-display').value = _niAge;
}

function niSelectGender(btn, gender) {
  _niGender = gender;
  document.querySelectorAll('.ni-gender-btn').forEach(b => {
    b.style.background = b.dataset.gender === gender ? 'var(--blue)' : 'var(--bg)';
    b.style.color      = b.dataset.gender === gender ? '#fff' : 'var(--text-primary)';
  });
}

async function submitNewIncident() {
  const btn   = document.getElementById('btn-submit-incident');
  const errEl = document.getElementById('ni-error');
  errEl.textContent = '';
  btn.disabled = true;

  const params = {
    p_event_id:              PCA.eventId,
    p_resource_id:           document.getElementById('ni-resource').value || null,
    p_reporting_resource_id: PCA.resource?.id || null,    
    p_personnel_id: PCA.operator?.id || null,
    p_incident_type:         null,
    p_lng:                   _niLng,
    p_lat:                   _niLat,
    p_patient_name:          document.getElementById('ni-patient-name').value.trim() || null,
    p_patient_age:           _niAge,
    p_patient_gender:        _niGender,
    p_patient_identifier:    document.getElementById('ni-patient-id').value.trim() || null,
    p_initial_outcome:       document.getElementById('ni-outcome').value,
    p_conscious:             NI_FORM.conscious,
    p_respiration:           NI_FORM.respiration,
    p_circulation:           NI_FORM.circulation,
    p_walking:               NI_FORM.walking,
    p_minor_injuries:        NI_FORM.minor_injuries,
    p_heart_rate:            parseInt(document.getElementById('ni-heart-rate').value)     || null,
    p_spo2:                  parseInt(document.getElementById('ni-spo2').value)           || null,
    p_breathing_rate:        parseInt(document.getElementById('ni-breathing-rate').value) || null,
    p_blood_pressure:        document.getElementById('ni-blood-pressure').value           || null,
    p_triage:                NI_FORM.triage,
    p_description:           document.getElementById('ni-description').value.trim()       || null,
    p_clinical_notes:        null,
    p_location_description:  document.getElementById('ni-location-desc').value.trim()    || null,
    p_temperature:           parseFloat(document.getElementById('ni-temperature').value) || null,
    p_gcs_total:             parseInt(document.getElementById('ni-gcs').value)           || null,
    p_hgt:                   document.getElementById('ni-hgt').value                     || null,
    p_iv_access:             NI_FORM.iv_access,
    p_session: PCA.event?.current_session || 1,
  };

  try {
    const result = await createPCAIncident(params);
    if (!result.ok) throw new Error(result.message);
    closeModal('modal-new-incident');

    // Destroy mini map
    if (_niMap) { _niMap.remove(); _niMap = null; }
    showToast('Intervento creato ✓', 'success');
    await loadAllIncidents();
  } catch (err) {
    errEl.textContent = err.message || 'Errore nella creazione.';
  } finally {
    btn.disabled = false;
  }
}

/* ================================================================
   RESOURCES — DATA
   loadAllResources  — fetches all resources with current status,
                       updates PCA.allResources, redraws panels
                       and map markers.
   renderPMAList     — renders the PMA section in the left panel.
   renderResourceList — renders the operative resources list,
                        applying any active map filters.
   selectResource    — flies to resource marker if visible,
                       otherwise opens the detail modal.
================================================================ */
async function loadAllResources() {
  if (!document.getElementById('list-all-resources')) return;
    const data = await fetchPCAResources(PCA.eventId);
    PCA.allResources = data;
   console.log('[fetch] resources returned:', data?.length, data);

  const pmas   = PCA.allResources.filter(r => r.resource_type === 'PMA');
  const others = PCA.allResources.filter(r => !['PMA', 'PCA', 'LDC'].includes(r.resource_type)); 
  
  renderPMAList(pmas);
  renderResourceList('list-all-resources', others);
  document.getElementById('badge-resources-count').textContent = others.length;
  PCA.allResources.forEach(r => {
    const rcs = r.resources_current_status;
    if (rcs?.geom) updateResourceMarker(r, rcs.status || 'free', rcs.geom);
  });
}
 
function renderPMAList(pmas) {
  const el = document.getElementById('list-pma-resources');
  if (!el) return;
  if (pmas.length === 0) { el.innerHTML = '<div class="empty-state">Nessun PMA</div>'; return; }
  el.innerHTML = pmas.map(r => {
    const rcs    = r.resources_current_status;
    const status = rcs?.status || 'free';
    return `
      <div class="resource-card pma-card" onclick="openResourceDetailModal('${r.id}')">
        <div class="rc-body">
          <div class="rc-name">${r.resource}</div>
          <div class="rc-detail">Pazienti in trattamento: <strong>${rcs?.active_responses || 0}</strong></div>
        </div>
      </div>`;
  }).join('');
}
 
function renderResourceList(containerId, resources) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (PCA.activeFilters.has('free')) {
    resources = resources.filter(r => r.resources_current_status?.status === 'free');
  } else if (PCA.activeFilters.has('recent')) {
    const cutoff = Date.now() - 15 * 60 * 1000;
    resources = resources.filter(r => {
      const t = r.resources_current_status?.location_updated_at;
      return t && new Date(t).getTime() > cutoff;
    });
  }
  if (resources.length === 0) { el.innerHTML = '<div class="empty-state">Nessuna risorsa</div>'; return; }
  el.innerHTML = resources.map(r => {
    const rcs    = r.resources_current_status;
    const status = rcs?.status || 'free';
    const active = rcs?.active_responses || 0;
    return `
      <div class="resource-card" onclick="selectResource('${r.id}')">
        <div class="rc-status-bar ${status}"></div>
        <div class="rc-body">
          <div class="rc-name">${r.resource}</div>
          <div class="rc-detail">Last Pos: ${formatTime(rcs?.location_updated_at)} · Last Int: ${formatTime(rcs?.last_response_at)}</div>
        </div>
        <div class="rc-right">
          <span class="rc-status-badge ${status}">${statusItalian(status)}</span>
          ${active > 0 ? `<span class="rc-count">${active} att.</span>` : ''}
        </div>
      </div>`;
  }).join('');
}
 
function selectResource(resourceId) {
  const marker = PCA.markers[resourceId];
  if (marker && PCA.map) {
    PCA.map.setView(marker.getLatLng(), 17);
    marker.openPopup();
  } else {
    openResourceDetailModal(resourceId);
  }
}

/* ================================================================
   RESOURCES — DETAIL MODAL
   openResourceDetailModal — fetches crew and incident history,
                             renders resource detail modal including
                             current zone if event has a grid.
   handleResourceStatus    — updates resource status via rpc,
                             shows toast, closes modal, refreshes list.
================================================================ */
async function openResourceDetailModal(resourceId) {
  const resource = PCA.allResources.find(r => r.id === resourceId);
  if (!resource) return;
 
  const rcs    = resource.resources_current_status;
  const status = rcs?.status || 'free';
 
  const [crew, history] = await Promise.all([
    fetchResourceCrew(resourceId),
    fetchResourceHistory(resourceId),
  ]);

  let zoneLabel = null;
  if (PCA.event?.is_grid && rcs?.geom?.coordinates) {
    const [lng, lat] = rcs.geom.coordinates;
    zoneLabel = (await fetchZoneForPoint(PCA.eventId, lat, lng))?.grid_label ?? null;
  }
  
  const crewRows = crew.length === 0
    ? '<div class="empty-state">Nessun membro</div>'
    : `<div style="display:grid;grid-template-columns:1fr 80px 100px 90px;gap:4px;
        padding:4px 0;border-bottom:2px solid var(--border-bright);margin-bottom:2px;">
        <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Nome</span>
        <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Ruolo</span>
        <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Comitato</span>
        <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Telefono</span>
      </div>` +
    crew.map(p => `
      <div style="display:grid;grid-template-columns:1fr 80px 100px 90px;gap:4px;
        padding:6px 0;border-bottom:1px solid var(--border);align-items:center;">
        <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${p.name} ${p.surname}</span>
        <span style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;">${p.role || '—'}</span>
        <span style="font-size:11px;color:var(--text-secondary);">${p.comitato || '—'}</span>
        ${p.number 
          ? `<a href="tel:${p.number}" style="font-size:11px;color:var(--blue);text-decoration:none;">📞 ${p.number}</a>` 
          : '<span style="font-size:11px;color:var(--text-muted);">—</span>'}
      </div>`).join('');


  document.getElementById('modal-resource-title').textContent = resource.resource;
  document.getElementById('modal-resource-body').innerHTML = `
    <div class="detail-row" style="margin-bottom:8px;"><span>Tipo</span><span>${resource.resource_type}</span></div>
    <div class="detail-row" style="margin-bottom:8px;"><span>Stato</span>
      <span><span class="rc-status-badge ${status}">${statusItalian(status)}</span></span></div>
    <div class="detail-row" style="margin-bottom:8px;"><span>Interventi attivi</span><span>${rcs?.active_responses || 0}</span></div>
    <div class="detail-row" style="margin-bottom:8px;"><span>Interventi totali</span><span>${history.length}</span></div>
    <div class="detail-row" style="margin-bottom:12px;"><span>Ultima posizione</span><span>${formatTime(rcs?.location_updated_at)}</span></div>
    ${zoneLabel ? `<div class="detail-row" style="margin-bottom:8px;"><span>Zona attuale</span><span style="font-weight:700;color:var(--blue);">${zoneLabel}</span></div>` : ''}
    ${resource.notes ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;
      padding:8px;background:var(--bg);border-radius:var(--radius);">${resource.notes}</div>` : ''}
    <div class="detail-label">Equipaggio</div>
    ${crewRows}`;
  openModal('modal-resource');
}
 
async function handleResourceStatus(resourceId, status) {
  const ok = await setResourceStatus(resourceId, status);
  if (!ok) { showToast('Errore aggiornamento stato', 'error'); return; }

  showToast(`Risorsa ${statusItalian(status)}`, 'success');
  closeModal('modal-resource');
  await loadAllResources();
}
 
/* ================================================================
   LAYOUT
   initPanelResize    — wires all drag handles (horizontal + vertical).
   setupVerticalResize — handles dragging between two stacked sections.
   setupResize        — handles dragging a panel's horizontal width.
================================================================ */
function initPanelResize() {
  // Horizontal (left/right panel width)
  setupResize('resize-left',  'panel-left',  160, 480, false);
  setupResize('resize-right', 'panel-right', 180, 480, true);
  // Vertical (sections inside left panel)
  setupVerticalResize('resize-incidents', 'section-active-inc', 'section-closed-inc');
  setupVerticalResize('resize-resources', 'section-pma',        'section-operative');
}
 
function setupVerticalResize(handleId, topId, bottomId) {
  const handle = document.getElementById(handleId);
  const top    = document.getElementById(topId);
  const bottom = document.getElementById(bottomId);
  if (!handle || !top || !bottom) return;
 
  let startY, startTopH, startBotH;
 
  handle.addEventListener('mousedown', e => {
    startY     = e.clientY;
    startTopH  = top.offsetHeight;
    startBotH  = bottom.offsetHeight;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    e.preventDefault();
  });
 
  function onMove(e) {
    const dy      = e.clientY - startY;
    const newTopH = Math.max(80, startTopH + dy);
    const newBotH = Math.max(80, startBotH - dy);
    top.style.flex    = 'none';
    bottom.style.flex = 'none';
    top.style.height    = newTopH + 'px';
    bottom.style.height = newBotH + 'px';
  }
  function onUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  }
}
 
function setupResize(handleId, panelId, min, max, isLeft) {
  const handle = document.getElementById(handleId);
  const panel  = document.getElementById(panelId);
  if (!handle || !panel) return;
  let startX, startW;
  handle.addEventListener('mousedown', e => {
    startX = e.clientX; startW = panel.offsetWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
  function onMove(e) {
    const dx = isLeft ? startX - e.clientX : e.clientX - startX;
    panel.style.width = Math.min(max, Math.max(min, startW + dx)) + 'px';
    if (PCA.map) PCA.map.invalidateSize();
  }
  function onUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
}
 
/* ================================================================
   HELPERS
   openModal / closeModal  — show/hide a modal overlay by id.
   showScreen              — switches the active screen, invalidates
                             map size when switching to screen-main.
   formatIncidentType      — incident_type enum → Italian label.
   formatOutcome           — outcome enum → Italian label.
   formatTime              — ISO timestamp → HH:MM string.
   statusItalian           — status enum → Italian label.
================================================================ */
function openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }

function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
 
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  if (id === 'screen-main' && PCA.map) setTimeout(() => PCA.map.invalidateSize(), 100);
}
 
function formatIncidentType(type) {
  return { medical:'Medico', trauma:'Trauma', cardiac:'Cardiaco',
    respiratory:'Respiratorio', environmental:'Ambientale', other:'Altro' }[type] || type;
}

function formatOutcome(outcome) {
  return {
    treating:'In trattamento', en_route_to_incident:'In arrivo',
    treated_and_released:'Dimesso', handed_off:'Passaggio consegne',
    en_route_to_pma:'Verso PMA', en_route_to_hospital:'Verso ospedale',
    taken_to_pma:'Arrivato al PMA', taken_to_hospital:'Arrivato in ospedale',
    refused_transport:'Rifiuta trasporto', consegnato_118:'Consegnato 118',
    cancelled:'Annullato'
  }[outcome] || outcome;
}

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
}

function statusItalian(s) {
  return { free:'Libera', busy:'In intervento', stopped:'Ferma' }[s] || s;
}
