/* ================================================================
   pca.js  —  Posto di Comando Avanzato
   Depends on: supabase.js, state.js, ui.js, auth.js
================================================================ */

/* ── OWN STATE (no shared state.js needed) ─────────────────── */
const PCA = {
  map:          null,
  markers:      {},
  incMarkers:   {},
  layers: { risorse: null, coordinatori: null, attivi: null, chiusi: null },  
  activeLayers: new Set(['base', 'risorse', 'coordinatori', 'attivi']),
  allIncidents: [],
  allResources: [],
  resource:     null,   // the logged-in PCA resource row
  event:        null,   // the active event row
  eventId:      null,
  operator:     null,   // the selected personnel (can be null if skipped)
  activeFilters: new Set(),  // null | 'free' | 'recent'
};

/* ── LAUNCH DASHBOARD ──────────────────────────────────────── */
async function loadPCAView() {
  const resource = STATE.resource;
  const event    = STATE.event;   // auth.js already fetched it

  PCA.resource = resource;
  PCA.event    = event;
  PCA.eventId  = event?.id || resource?.event_id;
  PCA.operator = STATE.personnel; // ← picks up cached personnel too

  // Header
  document.getElementById('header-event-name').textContent =
    event?.name?.toUpperCase() || 'EVENTO';
 
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
  initRouter();
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
  PCA.layers.chiusi        = L.layerGroup();
}
 
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
    .not('status', 'in', '("cancelled")')
    .order('updated_at', { ascending: false });
 
  if (error) { console.error(error); return; }
  PCA.allIncidents = data || [];
 
  renderIncidentPanels();
  updateHeaderStats();
  PCA.allIncidents.forEach(i => { 
    if (i.geom && i.status !== 'in_progress_in_pma') updateIncidentMarker(i); 
  });
  // Refresh PMA page if active
if (document.getElementById('pma-tabs')) refreshPCAView();
if (document.getElementById('soccorsi-body')) renderSoccorsiTables();
if (document.getElementById('moduli-body'))   renderModuliTables();
}
 
function renderIncidentPanels() {
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
  if (document.getElementById('pma-tabs')) refreshPCAView();
  if (document.getElementById('soccorsi-body')) renderSoccorsiTables();
  if (document.getElementById('moduli-body'))   renderModuliTables();

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
 
/* ── UNIFIED INCIDENT DETAIL MODAL ────────────────────────── */

/* ── ASSESSMENT BUILDER ────────────────────────────────────── */
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
      </div>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default;"
        title="${a.description ?? ''}">${a.description ?? '—'}</td>
    </div>`;
}

async function openIncidentDetailModal(incidentId) {
  const { data: inc, error } = await db
    .from('incidents')
    .select(`
      *,
      incident_responses(
        id, role, outcome, assigned_at, released_at, notes, hospital_info,
        resources!incident_responses_resource_id_fkey(id, resource, resource_type)
      ),
      patient_assessments(
        id, assessed_at, response_id, triage,
        conscious, respiration, circulation, walking, minor_injuries,
        heart_rate, spo2, breathing_rate, blood_pressure, temperature, gcs_total, iv_access, bed_number_pma,
        description, clinical_notes,
        personnel:assessed_by(name, surname)
      )
    `)
    .eq('id', incidentId)
    .single();

  if (error || !inc) return;

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

/* ── OUTCOME CHANGE WITH INLINE CONFIRM ────────────────────── */
// Store pending outcome per response id
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

  const updates = { outcome: pending.outcome };
  if (!['en_route_to_incident','treating',
        'en_route_to_pma','en_route_to_hospital'].includes(pending.outcome)) {
    updates.released_at = new Date().toISOString();
  }

  const { error } = await db
    .from('incident_responses')
    .update(updates)
    .eq('id', responseId);

  delete _pendingOutcome[responseId];

  if (error) { showToast('Errore aggiornamento esito', 'error'); return; }
  showToast('Esito aggiornato ✓', 'success');

  // Refresh modal in place + background data
  openIncidentDetailModal(incidentId);
  loadAllIncidents();
  loadAllResources();
}

/* ── ADD RESOURCE MODAL ────────────────────────────────────── */
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

  const { error } = await db.from('incident_responses').insert({
    event_id:    PCA.eventId,
    incident_id: incidentId,
    resource_id: resourceId,
    outcome,
    role:        'backup',
    assigned_at: new Date().toISOString(),
  });

  if (error) { errEl.textContent = error.message; return; }
  showToast('Risorsa aggiunta ✓', 'success');
  closeModal('modal-add-resource');
  openIncidentDetailModal(incidentId);
  loadAllIncidents();
  loadAllResources();
}

/* ── CLOSE INCIDENT MODAL ──────────────────────────────────── */
function openCloseIncidentModal(incidentId) {
  document.getElementById('ci-error').textContent = '';
  document.getElementById('ci-confirm').onclick = () => confirmCloseIncident(incidentId);
  openModal('modal-close-incident');
}

async function confirmCloseIncident(incidentId) {
  const outcome = document.getElementById('ci-outcome').value;
  const errEl   = document.getElementById('ci-error');
  errEl.textContent = '';

  const { error } = await db
    .from('incident_responses')
    .update({ outcome, released_at: new Date().toISOString() })
    .eq('incident_id', incidentId)
    .in('outcome', ['en_route_to_incident','treating',
                    'en_route_to_pma','en_route_to_hospital']);

  if (error) { errEl.textContent = error.message; return; }
  showToast('Soccorso chiuso ✓', 'success');
  closeModal('modal-close-incident');
  closeModal('modal-incident');
  loadAllIncidents();
  loadAllResources();
}
 
/* ── RESOURCE DETAIL MODAL ─────────────────────────────────── */
async function openResourceDetailModal(resourceId) {
  const resource = PCA.allResources.find(r => r.id === resourceId);
  if (!resource) return;
 
  const rcs    = resource.resources_current_status;
  const status = rcs?.status || 'free';
 
  const { data: crew } = await db
    .from('personnel')
    .select('id, name, surname, role, number, comitato')
    .eq('resource', resourceId)
    .order('name');
 
  const crewRows = (crew || []).length === 0 
    ? '<div class="empty-state">Nessun membro</div>'
    : `<div style="display:grid;grid-template-columns:1fr 80px 100px 90px;gap:4px;
        padding:4px 0;border-bottom:2px solid var(--border-bright);margin-bottom:2px;">
        <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Nome</span>
        <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Ruolo</span>
        <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Comitato</span>
        <span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Telefono</span>
      </div>` +
    (crew || []).map(p => `
      <div style="display:grid;grid-template-columns:1fr 80px 100px 90px;gap:4px;
        padding:6px 0;border-bottom:1px solid var(--border);align-items:center;">
        <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${p.name} ${p.surname}</span>
        <span style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;">${p.role || '—'}</span>
        <span style="font-size:11px;color:var(--text-secondary);">${p.comitato || '—'}</span>
        ${p.number 
          ? `<a href="tel:${p.number}" style="font-size:11px;color:var(--blue);text-decoration:none;">📞 ${p.number}</a>` 
          : '<span style="font-size:11px;color:var(--text-muted);">—</span>'}
      </div>`).join('');

  const { data: incidents } = await db
    .from('incident_responses')
    .select('incident_id, outcome, assigned_at, incidents(incident_type, current_triage, status)')
    .eq('resource_id', resourceId)
    .order('assigned_at', { ascending: false });

  document.getElementById('modal-resource-title').textContent = resource.resource;
  document.getElementById('modal-resource-body').innerHTML = `
    <div class="detail-row" style="margin-bottom:8px;"><span>Tipo</span><span>${resource.resource_type}</span></div>
    <div class="detail-row" style="margin-bottom:8px;"><span>Stato</span>
      <span><span class="rc-status-badge ${status}">${statusItalian(status)}</span></span></div>
    <div class="detail-row" style="margin-bottom:8px;"><span>Interventi attivi</span><span>${rcs?.active_responses || 0}</span></div>
    <div class="detail-row" style="margin-bottom:8px;"><span>Interventi totali</span><span>${incidents?.length || 0}</span></div>
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
  if (error) { showToast('Errore aggiornamento stato', 'error'); return; }
  showToast(`Risorsa ${statusItalian(status)}`, 'success');
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
    showToast('Intervento creato ✓', 'success');
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
    showToast('Non trovato', 'error');
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
