/* ================================================================
   pca.js  —  Posto di Comando Avanzato
   Fully standalone. Owns its own auth, state, and boot flow.
   Only depends on: supabase.js (for the db client)
================================================================ */

/* ── OWN STATE (no shared state.js needed) ─────────────────── */
const PCA = {
  map:          null,
  markers:      {},
  incMarkers:   {},
  layers:       { ambulanze: null, pma: null, incidents: null },
  activeLayers: new Set(['base', 'risorse', 'coordinatori', 'attivi', 'chiusi']),
  allIncidents: [],
  allResources: [],
  resource:     null,   // the logged-in PCA resource row
  event:        null,   // the active event row
  eventId:      null,
  operator:     null,   // the selected personnel (can be null if skipped)
  activeFilters: new Set(),  // null | 'free' | 'recent'
};

/* ── BOOT — called on window load ──────────────────────────── */
async function bootPCA() {
  // Wire login form
  document.getElementById('login-form')
    .addEventListener('submit', handlePCALogin);

  // Check for existing session
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    showScreen('screen-login');
    return;
  }

  // Session exists — verify it belongs to a PCA resource
  const { data: resource } = await db
    .from('resources')
    .select('*, event_radio_channels(channel_name, description)')
    .eq('user_email', session.user.email)
    .single();

  if (!resource || resource.resource_type !== 'PCA') {
    await db.auth.signOut();
    showScreen('screen-login');
    setLoginError('Accesso non autorizzato. Questa pagina è riservata al Posto di Comando.');
    return;
  }

  await launchDashboard(resource);
}

/* ── LOGIN FORM ────────────────────────────────────────────── */
async function handlePCALogin(e) {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('btn-login');
  setLoginError('');
  btn.disabled = true;
  btn.textContent = 'Accesso...';

  try {
    const { error: authError } = await db.auth.signInWithPassword({ email, password });
    if (authError) throw new Error('Email o password errati.');

    const { data: resource } = await db
      .from('resources')
      .select('*, event_radio_channels(channel_name, description)')
      .eq('user_email', email)
      .single();

    if (!resource) throw new Error('Nessuna risorsa associata a questa email.');
    if (resource.resource_type !== 'PCA') {
      await db.auth.signOut();
      throw new Error('Accesso non autorizzato. Questa pagina è riservata al Posto di Comando.');
    }

    await launchDashboard(resource);

  } catch (err) {
    setLoginError(err.message);
    btn.disabled = false;
    btn.textContent = 'Accedi';
  }
}

function setLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) el.textContent = msg;
}

/* ── PERSONNEL SCREEN ─────────────────────────────────────── */
async function showPersonnelScreen(resource) {
  document.getElementById('personnel-resource-name').textContent = resource.resource;
 
  const { data: personnel } = await db
    .from('personnel')
    .select('id, name, surname, role')
    .eq('resource', resource.id)
    .order('name');
 
  const list = document.getElementById('personnel-list');
  list.innerHTML = '';
 
  if (!personnel || personnel.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <div class="empty-text">Nessun membro registrato per questa risorsa</div>
      </div>`;
  } else {
    personnel.forEach(p => {
      const card = document.createElement('div');
      card.className = 'personnel-card';
      card.innerHTML = `
        <div class="personnel-avatar">👤</div>
        <div class="personnel-info">
          <div class="personnel-name">${p.name} ${p.surname}</div>
          <div class="personnel-role">${p.role || '—'}</div>
        </div>
        <span class="personnel-arrow">›</span>`;
      card.addEventListener('click', () => {
        PCA.operator = p;
        launchDashboard(resource);
      });
      list.appendChild(card);
    });
  }
 
  document.getElementById('personnel-skip').addEventListener('click', () => {
    PCA.operator = null;
    launchDashboard(resource);
  });
 
  showScreen('screen-personnel');
}


/* ── LAUNCH DASHBOARD ──────────────────────────────────────── */
async function launchDashboard(resource) {
  // Load active event
  const { data: event } = await db
    .from('events')
    .select('*')
    .eq('is_active', true)
    .single();
 
  PCA.resource = resource;
  PCA.event    = event;
  PCA.eventId  = event?.id || resource.event_id;
 
  // Header
  document.getElementById('header-event-name').textContent =
    event?.name?.toUpperCase() || 'EVENTO';
 
  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await db.auth.signOut();
    location.reload();
  });
 
  // Modal close buttons
  document.querySelectorAll('.modal-close, [data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.close || btn.closest('.modal-overlay')?.id;
      if (id) closeModal(id);
    });
  });
 
  // Bottom bar
  document.getElementById('btn-new-incident').addEventListener('click', openNewIncidentModal);
  document.getElementById('btn-free-units').addEventListener('click', filterFreeUnits);
  document.getElementById('btn-recent-pos').addEventListener('click', flyToRecentPositions);
  document.getElementById('btn-search').addEventListener('click', focusMapSearch);
 
  // Map layer toggles
  document.querySelectorAll('.map-layer-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleMapLayer(btn.dataset.layer, btn));
  });
 
  // Panel resize
  initPanelResize();
 
  // Clocks
  startClocks(event?.start_time);
 
  // Show dashboard
  showScreen('screen-main');
 
  // Map
  await initPCAMap(event);
 
  // Data
  await Promise.all([loadAllIncidents(), loadAllResources()]);
 
  // Realtime
  subscribePCA();
}
 
/* ── CLOCKS ────────────────────────────────────────────────── */
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
 
/* ── MAP ───────────────────────────────────────────────────── */
async function initPCAMap(event) {
  const lat  = event?.center_lat  || 41.9;
  const lng  = event?.center_lng  || 12.5;
  const zoom = event?.default_zoom || 14;
 
  PCA.map = L.map('map', { zoomControl: true }).setView([lat, lng], zoom);
 
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CartoDB',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(PCA.map);
 
  PCA.layers.risorse       = L.layerGroup().addTo(PCA.map);
  PCA.layers.coordinatori  = L.layerGroup().addTo(PCA.map);
  PCA.layers.attivi        = L.layerGroup().addTo(PCA.map);
}
 
function resourceIcon(resource, status) {
  const colors = { free: '#3fb950', busy: '#f0883e', stopped: '#484f58' };
  const color  = colors[status] || colors.free;
  const label  = resource.resource_type || '?';
  const svg = `
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
 
function updateResourceMarker(resource, status, geom) {
  if (!PCA.map || !geom) return;
  const [lng, lat] = geom.coordinates;
  const layer = resource.resource_type === 'LDC'
    ? PCA.layers.coordinatori
    : PCA.layers.risorse;

  const fullResource = PCA.allResources.find(r => r.id === resource.id);
  const lastPos = formatTime(fullResource?.resources_current_status?.location_updated_at);
  const popup = `
    <strong style="font-size:13px;">${resource.resource}</strong><br>
    <span style="font-size:11px;color:#8b949e;">
      Ultima pos: ${lastPos}
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
  const incLayer = ['open','in_progress','in_progress_in_pma'].includes(incident.status)
    ? PCA.layers.attivi
    : PCA.layers.chiusi;

  const popup = `
    <strong style="font-size:13px;">${formatIncidentType(incident.incident_type)}</strong><br>
    <span style="font-size:11px;color:#8b949e;">
      ${incident.patient_name || incident.patient_identifier || 'Paziente anonimo'}
    </span><br>
    <span style="font-size:11px;color:#8b949e;">
      Ore ${formatTime(incident.created_at)}
    </span>
    <button onclick="openIncidentDetailModal('${incident.id}')" class="map-popup-btn">
      Dettagli →
    </button>`;

  if (PCA.incMarkers[incident.id]) {
    PCA.incMarkers[incident.id].setLatLng([lat, lng]);
    PCA.incMarkers[incident.id].setIcon(incidentIcon(incident.current_triage));
    PCA.incMarkers[incident.id].getPopup().setContent(popup);
  } else {
    const marker = L.marker([lat, lng], { icon: incidentIcon(incident.current_triage) })
      .addTo(incLayer)
      .bindPopup(popup);
    PCA.incMarkers[incident.id] = marker;
  }
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
 
/* ── INCIDENTS ─────────────────────────────────────────────── */
async function loadAllIncidents() {
  const { data, error } = await db
    .from('incidents')
    .select(`
      id, incident_type, status, current_triage,
      patient_name, patient_identifier, patient_age, created_at, updated_at, geom, description,
      incident_responses(
        id, outcome, resource_id,
        resources!incident_responses_resource_id_fkey(resource, resource_type)
      )
    `)
    .eq('event_id', PCA.eventId)
    .neq('status', 'cancelled')
    .order('updated_at', { ascending: false });
 
  if (error) { console.error(error); return; }
  PCA.allIncidents = data || [];
 
  renderIncidentPanels();
  updateHeaderStats();
  PCA.allIncidents.forEach(i => { if (i.geom) updateIncidentMarker(i); });
}
 
function renderIncidentPanels() {
  const active = PCA.allIncidents.filter(i =>
    ['open', 'in_progress'].includes(i.status)
  );
  const closed = PCA.allIncidents.filter(i =>
    ['resolved', 'taken_to_hospital'].includes(i.status)
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
/* ── RESOURCES ─────────────────────────────────────────────── */
async function loadAllResources() {
  const { data, error } = await db
    .from('resources')
    .select(`
      id, resource, resource_type, notes,
      resources_current_status(status, active_responses, geom, location_updated_at, last_response_at)
    `)
    .eq('event_id', PCA.eventId)
    .order('resource');
 
  if (error) { console.error(error); return; }
  PCA.allResources = data || [];
 
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
  if (PCA.activeFilter === 'free') {
    resources = resources.filter(r => r.resources_current_status?.status === 'free');
  } else if (PCA.activeFilter === 'recent') {
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
/* ── HEADER STATS ──────────────────────────────────────────── */
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
 
/* ── INCIDENT DETAIL MODAL ─────────────────────────────────── */
async function openIncidentDetailModal(incidentId) {
  const { data: inc, error } = await db
    .from('incidents')
    .select(`
      *,
      incident_responses(
        id, role, outcome, assigned_at, released_at, notes, hospital_info,
        resources!incident_responses_resource_id_fkey(resource, resource_type)
      ),
      patient_assessments(
        id, assessed_at, triage, conscious, respiration, circulation,
        heart_rate, spo2, breathing_rate, blood_pressure, temperature, gcs_total, description, clinical_notes
      )
    `)
    .eq('id', incidentId)
    .single();
 
  if (error || !inc) return;
 
  document.getElementById('modal-incident-title').textContent =
    `${formatIncidentType(inc.incident_type)} — ${inc.patient_name || 'Anonimo'}`;
 
  const triage = inc.current_triage;
  const triageBadge = triage
    ? `<span class="triage-badge ${triage}">${triage.toUpperCase()}</span>`
    : '<span style="color:var(--text-muted)">—</span>';
 
  const responses = (inc.incident_responses || []).map(r => `
    <div class="response-entry">
      <div class="response-outcome-dot ${r.outcome}"></div>
      <div style="flex:1">
        <strong>${r.resources?.resource || '—'}</strong>
        <span style="color:var(--text-muted);font-size:11px;margin-left:6px;">${formatOutcome(r.outcome)}</span>
      </div>
      <div style="font-size:10px;color:var(--text-muted)">${formatTime(r.assigned_at)}</div>
    </div>`).join('');
 
  const assessments = [...(inc.patient_assessments || [])]
    .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at))
    .map(a => `
      <div class="assessment-entry">
        <div class="assessment-time">${new Date(a.assessed_at).toLocaleString('it-IT')}</div>
        <div class="vitals-grid">
          ${a.heart_rate     ? `<div class="vital-item"><strong>${a.heart_rate}</strong>FC</div>` : ''}
          ${a.spo2           ? `<div class="vital-item"><strong>${a.spo2}%</strong>SpO2</div>` : ''}
          ${a.blood_pressure ? `<div class="vital-item"><strong>${a.blood_pressure}</strong>PA</div>` : ''}
          ${a.breathing_rate ? `<div class="vital-item"><strong>${a.breathing_rate}</strong>FR</div>` : ''}
          ${a.temperature    ? `<div class="vital-item"><strong>${a.temperature}°</strong>Temp</div>` : ''}
          ${a.gcs_total      ? `<div class="vital-item"><strong>${a.gcs_total}</strong>GCS</div>` : ''}
        </div>
        ${a.clinical_notes ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:6px;">${a.clinical_notes}</div>` : ''}
      </div>`).join('') || '<div class="empty-state">Nessun rilevamento</div>';
 
  document.getElementById('modal-incident-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-section">
        <div class="detail-label">Paziente</div>
        <div class="detail-row"><span>Nome</span><span>${inc.patient_name || '—'}</span></div>
        <div class="detail-row"><span>Identificativo</span><span>${inc.patient_identifier || '—'}</span></div>
        <div class="detail-row"><span>Età</span><span>${inc.patient_age || '—'}</span></div>
        <div class="detail-row"><span>Triage</span><span>${triageBadge}</span></div>
        <div class="detail-row"><span>Tipo</span><span>${formatIncidentType(inc.incident_type)}</span></div>
        <div class="detail-row"><span>Stato</span><span><span class="ic-status-tag ${inc.status}">${inc.status}</span></span></div>
        <div class="detail-row"><span>Ora</span><span>${formatTime(inc.created_at)}</span></div>
        ${inc.description ? `<div style="margin-top:10px;"><div class="detail-label">Note</div>
          <div style="font-size:12px;color:var(--text-secondary);">${inc.description}</div></div>` : ''}
        <div class="detail-label" style="margin-top:14px;">Risorse coinvolte</div>
        ${responses || '<div class="empty-state">Nessuna risposta</div>'}
      </div>
      <div class="detail-section">
        <div class="detail-label">Rilevamenti clinici</div>
        ${assessments}
      </div>
    </div>`;
 
  openModal('modal-incident');
}
 
/* ── RESOURCE DETAIL MODAL ─────────────────────────────────── */
async function openResourceDetailModal(resourceId) {
  const resource = PCA.allResources.find(r => r.id === resourceId);
  if (!resource) return;
 
  const rcs    = resource.resources_current_status;
  const status = rcs?.status || 'free';
 
  const { data: crew } = await db
    .from('personnel')
    .select('id, name, surname, role, number')
    .eq('resource', resourceId)
    .order('name');
 
  const crewRows = (crew || []).map(p => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;
      border-bottom:1px solid var(--border);font-size:12px;align-items:center;">
      <span style="color:var(--text-primary);font-weight:600;">${p.name} ${p.surname}</span>
      <span style="color:var(--text-muted);text-transform:uppercase;font-size:10px;">${p.role || '—'}</span>
      ${p.number ? `<a href="tel:${p.number}" style="color:var(--blue);text-decoration:none;font-size:11px;">📞 ${p.number}</a>` : ''}
    </div>`).join('') || '<div class="empty-state">Nessun membro</div>';
 
  document.getElementById('modal-resource-title').textContent = resource.resource;
  document.getElementById('modal-resource-body').innerHTML = `
    <div class="detail-row" style="margin-bottom:8px;"><span>Tipo</span><span>${resource.resource_type}</span></div>
    <div class="detail-row" style="margin-bottom:8px;"><span>Stato</span>
      <span><span class="rc-status-badge ${status}">${statusItalian(status)}</span></span></div>
    <div class="detail-row" style="margin-bottom:8px;"><span>Interventi attivi</span><span>${rcs?.active_responses || 0}</span></div>
    <div class="detail-row" style="margin-bottom:12px;"><span>Ultima posizione</span><span>${formatTime(rcs?.location_updated_at)}</span></div>
    ${resource.notes ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;
      padding:8px;background:var(--bg);border-radius:var(--radius);">${resource.notes}</div>` : ''}
    <div class="detail-label">Equipaggio</div>
    ${crewRows}`;
 
  document.getElementById('btn-stop-resource').onclick = () => setResourceStatus(resourceId, 'stopped');
  document.getElementById('btn-free-resource').onclick = () => setResourceStatus(resourceId, 'free');
  openModal('modal-resource');
}
 
async function setResourceStatus(resourceId, status) {
  const { error } = await db
    .from('resources_current_status')
    .update({ status })
    .eq('resource_id', resourceId);
  if (error) { showPCAToast('Errore aggiornamento stato', 'error'); return; }
  showPCAToast(`Risorsa ${statusItalian(status)}`, 'success');
  closeModal('modal-resource');
  await loadAllResources();
}
 
/* ── NEW INCIDENT MODAL ────────────────────────────────────── */
async function openNewIncidentModal() {
  const select = document.getElementById('ni-resource');
  select.innerHTML = '<option value="">— Senza risorsa —</option>' +
    PCA.allResources
      .filter(r => r.resource_type !== 'PMA')
      .map(r => `<option value="${r.id}">${r.resource} (${r.resource_type})</option>`)
      .join('');
  document.getElementById('ni-error').textContent = '';
  document.getElementById('btn-submit-incident').onclick = submitNewIncident;
  openModal('modal-new-incident');
}
 
async function submitNewIncident() {
  const btn   = document.getElementById('btn-submit-incident');
  const errEl = document.getElementById('ni-error');
  errEl.textContent = '';
  btn.disabled = true;
 
  const params = {
    p_event_id:           PCA.eventId,
    p_resource_id:        document.getElementById('ni-resource').value || null,
    p_personnel_id:       null,
    p_incident_type:      document.getElementById('ni-type').value,
    p_lng: null, p_lat: null,
    p_patient_name:       document.getElementById('ni-patient-name').value.trim() || null,
    p_patient_age:        null,
    p_patient_gender:     null,
    p_patient_identifier: document.getElementById('ni-patient-id').value.trim() || null,
    p_initial_outcome:    document.getElementById('ni-outcome').value,
    p_conscious: null, p_respiration: null, p_circulation: null,
    p_walking: null, p_minor_injuries: null,
    p_heart_rate: null, p_spo2: null, p_breathing_rate: null,
    p_blood_pressure: null, p_temperature: null,
    p_triage:             document.getElementById('ni-triage').value || null,
    p_description:        document.getElementById('ni-description').value.trim() || null,
    p_clinical_notes:     null,
  };
 
  try {
    const { error } = await db.rpc('create_incident_with_assessment', params);
    if (error) throw error;
    closeModal('modal-new-incident');
    showPCAToast('Intervento creato ✓', 'success');
    await loadAllIncidents();
  } catch (err) {
    errEl.textContent = err.message || 'Errore nella creazione.';
  } finally {
    btn.disabled = false;
  }
}
 
/* ── MAP BUTTONS ───────────────────────────────────────────── */
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
    showPCAToast('Non trovato', 'error');
  }
}
 
/* ── REALTIME ──────────────────────────────────────────────── */
function subscribePCA() {
  if (!PCA.eventId) return;
  db.channel(`pca-${PCA.eventId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents',
      filter: `event_id=eq.${PCA.eventId}` }, () => loadAllIncidents())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incident_responses',
      filter: `event_id=eq.${PCA.eventId}` }, () => loadAllIncidents())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resources_current_status',
      filter: `event_id=eq.${PCA.eventId}` }, () => loadAllResources())
    .subscribe();
}
 
/* ── PANEL RESIZE ──────────────────────────────────────────── */
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
 
/* ── MODAL HELPERS ─────────────────────────────────────────── */
function openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
 
/* ── SCREEN HELPER ─────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  if (id === 'screen-main' && PCA.map) setTimeout(() => PCA.map.invalidateSize(), 100);
}
 
/* ── FORMAT HELPERS ────────────────────────────────────────── */
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
