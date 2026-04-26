/* ================================================================
   js/views/incidents.js
   Incident list, new incident form, detail modal, outcome flow.
   Depends on: rpc.js, ui.js, state.js, location.js
================================================================ */

/* ================================================================
   HELPERS AND LABELS
   setYNField / setAssessmentYN: programmatically set a Y/N button
   to active and update the corresponding state object.
   Used by the cascade logic (e.g. conscious=false → walking=false).
   Label maps: human-readable strings for incident types and statuses.
   CLINICAL_TYPES: resource types that show the clinical section (ASM/ASI/MM)
================================================================ */
function setYNField(field, value) {
  STATE.formData[field] = value;
  const container = document.querySelector(`.yn-btn[data-field="${field}"]`)
    ?.closest('.yn-buttons');
  if (!container) return;
  container.querySelectorAll('.yn-btn').forEach(b => b.classList.remove('active'));
  const target = container.querySelector(`.yn-btn[data-value="${value}"]`);
  if (target) target.classList.add('active');
}

function setAssessmentYN(field, value) {
  STATE.assessmentData[field] = value;
  const container = document.querySelector(`#modal-assessment .yn-btn[data-field="a_${field}"]`)
    ?.closest('.yn-buttons');
  if (!container) return;
  container.querySelectorAll('.yn-btn').forEach(b => b.classList.remove('active'));
  const target = container.querySelector(`.yn-btn[data-value="${value}"]`);
  if (target) target.classList.add('active');
}

const INCIDENT_TYPE_LABELS = {
  medical:       'Medico',
  trauma:        'Trauma',
  cardiac:       'Cardiaco',
  respiratory:   'Respiratorio',
  environmental: 'Ambientale',
  other:         'Altro',
};

const STATUS_LABELS = {
  open:              'Aperto',
  in_progress:       'In corso',
  in_progress_in_pma:'Al PMA',
  resolved:          'Risolto',
  taken_to_hospital: 'Ospedalizzato',
  cancelled:         'Annullato',
};

const CLINICAL_TYPES = ['ASM', 'ASI', 'MM'];

/* ================================================================
   SHARED HTML BUILDERS
   Pure functions — return HTML strings, no DOM side effects.
   Each builder corresponds to a form section reused across modals.
   buildPatientHTML(values)         — nome, pettorale, età, sesso
   buildBaseConditionsHTML(values)  — 5 Y/N vitals + descrizione
   buildClinicalHTML(values)        — triage, vitals, iv_access, note
   buildLocationTimeHTML()          — orario allertamento + GPS + map
   buildOutcomeOptionsHTML(...)     — closing outcome selector list
================================================================ */

function buildPatientHTML(values = {}) {
  const { name = '', identifier = '', age = '', gender = null } = values;
  return `
    <div class="form-section">
      <div class="form-section-title">Paziente</div>
      <div class="form-row" style="margin-bottom:10px;">
        <div class="input-group">
          <label>Nome - Cognome</label>
          <input type="text" id="f-patient-name" placeholder="—" value="${name}" />
        </div>
        <div class="input-group">
          <label>Pettorale</label>
          <input type="text" id="f-patient-id" placeholder="—" value="${identifier}" />
        </div>
      </div>
      <div class="form-row">
        <div class="input-group" style="flex:1;">
          <label>Età apparente</label>
          <div class="age-stepper">
            <input type="number" id="f-patient-age" class="age-input"
              value="${age}" min="0" max="120" />
            <div class="age-arrows">
              <button class="age-btn" id="age-up" type="button">▲</button>
              <button class="age-btn" id="age-down" type="button">▼</button>
            </div>
          </div>
        </div>
        <div class="input-group" style="flex:1;">
          <label>Sesso</label>
          <div class="seg-buttons" id="f-patient-gender-btns">
            <button class="seg-btn ${gender === 'M'     ? 'active' : ''}" data-value="M">M</button>
            <button class="seg-btn ${gender === 'F'     ? 'active' : ''}" data-value="F">F</button>
            <button class="seg-btn ${gender === 'altro' ? 'active' : ''}" data-value="altro">Altro</button>
          </div>
        </div>
      </div>
    </div>`;
}

function buildBaseConditionsHTML(values = {}, isAssessment = false, isClinical = false) {
  const fields = [
    { key: 'conscious',      label: 'Coscienza',       required: true },
    { key: 'respiration',    label: 'Respiro',          required: true },
    { key: 'circulation',    label: 'Circolo',          required: true },
    { key: 'walking',        label: 'Cammina',          required: false },
    { key: 'minor_injuries', label: 'Problema Minore',  required: false },
  ];
  const ynRows = fields.map((f, i) => {
    const isLast = i === fields.length - 1;
    const val = values[f.key];
    return `
      <div class="yn-field" ${isLast ? 'style="border-bottom:none;"' : ''}>
        <div class="yn-label">${f.label} ${f.required ? '<span class="required">*</span>' : ''}</div>
        <div class="yn-buttons">
          <button class="yn-btn yn-no  ${val === false ? 'active' : ''}"
            data-field="${f.key}" data-value="false">No / Non so</button>
          <button class="yn-btn yn-yes ${val === true  ? 'active' : ''}"
            data-field="${f.key}" data-value="true">Sì</button>
        </div>
      </div>`;
  }).join('');

  const basicVitals = (isAssessment && !isClinical) ? `
  <div class="form-row" style="margin-bottom:10px;">
        <div class="input-group" style="flex:1;">
          <label>FR</label>
          <input type="number" id="f-breathing-rate" placeholder="—" min="0" max="300"
            value="${values.breathing_rate || ''}" />
        </div>
        <div class="input-group" style="flex:1;">
          <label>SpO2</label>
          <input type="number" id="f-spo2" placeholder="—" min="0" max="100"
            value="${values.spo2 || ''}" />
        </div>
        <div class="input-group" style="flex:1;">
          <label>FC</label>
          <input type="number" id="f-heart-rate" placeholder="—" min="0" max="60"
            value="${values.heart_rate || ''}" />
        </div>
        <div class="input-group" style="flex:1;">
          <label>PA</label>
          <input type="text" id="f-blood-pressure" placeholder="—"
            value="${values.blood_pressure || ''}" />
        </div>
      </div>` : '';

  return `
    <div class="form-section">
      <div class="form-section-title">Condizioni di base</div>
      ${ynRows}
    </div>
    <div class="form-section">
      <div class="form-section-title">Descrizione <span class="required">*</span></div>
      <textarea id="f-description" rows="3"
        placeholder="Descrizione dell'intervento...">${values.description || ''}</textarea>
    </div>
    ${basicVitals}`;
}

function buildClinicalHTML(values = {}, isAssessment = false) {
  const triage = values.triage || null;
  const triageColors = { white: '⚪', green: '🟢', yellow: '🟡', red: '🔴' };
  const triageLabels = { white: 'Bianco', green: 'Verde', yellow: 'Giallo', red: 'Rosso' };

  return `
    <div class="form-section" id="section-clinical">
      <div class="form-section-title">Valutazione clinica</div>
      <div class="input-group" style="margin-bottom:10px;">
        <label>Triage <span class="required">*</span></label>
        <div class="triage-selector">
          ${['white','green','yellow','red'].map(t => `
            <button class="triage-btn ${t} ${triage === t ? 'selected' : ''}"
              data-triage="${t}">
              ${triageColors[t]} ${triageLabels[t]}
            </button>`).join('')}
        </div>
      </div>
      <div class="form-row" style="margin-bottom:10px;">
        <div class="input-group" style="flex:1;">
          <label>FR</label>
          <input type="number" id="f-breathing-rate" placeholder="—" min="0" max="300"
            value="${values.breathing_rate || ''}" />
        </div>
        <div class="input-group" style="flex:1;">
          <label>SpO2</label>
          <input type="number" id="f-spo2" placeholder="—" min="0" max="100"
            value="${values.spo2 || ''}" />
        </div>
        <div class="input-group" style="flex:1;">
          <label>FC</label>
          <input type="number" id="f-heart-rate" placeholder="—" min="0" max="60"
            value="${values.heart_rate || ''}" />
        </div>
        <div class="input-group" style="flex:1;">
          <label>PA</label>
          <input type="text" id="f-blood-pressure" placeholder="—"
            value="${values.blood_pressure || ''}" />
        </div>
      </div>
      ${isAssessment ? `
      <div class="form-row" style="margin-bottom:10px;">
        <div class="input-group" style="flex:1;">
          <label>Temp</label>
          <input type="number" id="f-temperature" placeholder="—" step="0.1"
            value="${values.temperature || ''}" />
        </div>
        <div class="input-group" style="flex:1;">
          <label>GCS</label>
          <input type="number" id="f-gcs" placeholder="—" min="3" max="15"
            value="${values.gcs_total || ''}" />
        </div>
        <div class="input-group" style="flex:1;">
          <label>HGT</label>
          <input type="text" id="f-hgt" placeholder="—"
            value="${values.hgt || ''}" />
        </div>
      </div>
      <div class="yn-field" style="border-bottom:none;">
        <div class="yn-label">Accesso venoso</div>
        <div class="yn-buttons">
          <button class="yn-btn yn-no  ${values.iv_access === false ? 'active' : ''}"
            data-field="iv_access" data-value="false">No</button>
          <button class="yn-btn yn-yes ${values.iv_access === true  ? 'active' : ''}"
            data-field="iv_access" data-value="true">Sì</button>
        </div>
      </div>` : ''}
      <div class="input-group" style="margin-top:10px;">
        <label>Note cliniche</label>
        <textarea id="f-clinical-notes" rows="2"
          placeholder="Osservazioni, sintomi...">${values.clinical_notes || ''}</textarea>
      </div>
    </div>`;
}

function buildLocationTimeHTML() {
  const now   = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
  return `
    <div class="form-section">
      <div class="form-section-title">Orario allertamento <span class="required">*</span></div>
      <input type="datetime-local" id="f-alert-time" value="${local}" />
    </div>
    <div class="form-section">
      <div class="form-section-title">Posizione</div>
      <button class="btn-get-location" id="btn-get-location" type="button">
        📍 Usa posizione attuale
      </button>
      <div id="location-display" class="location-display" style="display:none;">
        <span id="location-coords"></span>
        <span id="location-accuracy"></span>
      </div>
      <div id="location-map-container"
        style="display:none;margin-top:8px;border-radius:var(--radius);overflow:hidden;">
        <iframe id="location-map-img"
          style="width:100%;height:180px;border:none;display:block;" src="">
        </iframe>
      </div>
    </div>`;
}

function buildOutcomeOptionsHTML(pmaOptions, teamOptions, isClinical) {
  return `
    <div class="outcome-panel">
      <div class="outcome-opt" data-outcome-type="treated_and_released">
        <span>✔</span> Trattato e dimesso
      </div>
      <div class="outcome-opt" data-outcome-type="consegnato_squadra">
        <span>🤝</span> Consegnato ad altra squadra
      </div>
      <div class="outcome-detail" id="od-squadra" style="display:none;">
        <div class="outcome-detail-label">Quale squadra? <span class="required">*</span></div>
        <select id="od-squadra-select">
          <option value="">— Seleziona —</option>${teamOptions}
        </select>
      </div>
      <div class="outcome-opt" data-outcome-type="trasportato_pma">
        <span>🏥</span> Trasportato al PMA
      </div>
      <div class="outcome-detail" id="od-pma" style="display:none;">
        <div class="outcome-detail-label">Quale PMA? <span class="required">*</span></div>
        <select id="od-pma-select">
          <option value="">— Seleziona —</option>${pmaOptions}
        </select>
      </div>
      ${isClinical ? `
      <div class="outcome-opt" data-outcome-type="ospedalizzato">
        <span>🚑</span> Ospedalizzato
      </div>
      <div class="outcome-detail" id="od-ospedale" style="display:none;">
        <div class="outcome-detail-label">Ospedale <span class="required">*</span></div>
        <input type="text" id="od-ospedale-name" placeholder="Nome ospedale..." />
        <div class="outcome-detail-label" style="margin-top:6px;">Codice GIPSE <span class="required">*</span></div>
        <input type="text" id="od-gipse" placeholder="Codice GIPSE..." />
      </div>` : ''}
      <div class="outcome-opt" data-outcome-type="consegnato_118">
        <span>🚨</span> Consegnato al 118
      </div>
      <div class="outcome-opt" data-outcome-type="rifiuta_trasporto">
        <span>🚶</span> Rifiuta il trasporto
      </div>
      <div class="outcome-opt" data-outcome-type="annullato">
        <span>✕</span> Annullato / Falso allarme
      </div>
    </div>`;
}

function wireYNButtons(container, stateObj, cascadeFields = []) {
  container.querySelectorAll('.yn-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const value = btn.dataset.value === 'true';
      const isAlreadyActive = btn.classList.contains('active');

      btn.closest('.yn-buttons').querySelectorAll('.yn-btn')
        .forEach(b => b.classList.remove('active'));

      if (isAlreadyActive) {
        stateObj[field] = null;
      } else {
        btn.classList.add('active');
        if (field in stateObj) stateObj[field] = value;
        if (cascadeFields.includes(field) && value === false) {
          // set walking and minor_injuries to false in the same container
          container.querySelectorAll('.yn-btn[data-field="walking"], .yn-btn[data-field="minor_injuries"]')
            .forEach(b => b.classList.remove('active'));
          container.querySelector('.yn-btn[data-field="walking"][data-value="false"]')
            ?.classList.add('active');
          container.querySelector('.yn-btn[data-field="minor_injuries"][data-value="false"]')
            ?.classList.add('active');
          stateObj['walking'] = false;
          stateObj['minor_injuries'] = false;
        }
      }
    });
  });
}

function wireTriageButtons(container, stateObj) {
  container.querySelectorAll('.triage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.triage-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      stateObj.triage = btn.dataset.triage;
    });
  });
}
/* ================================================================
   LOAD & RENDER INCIDENTS
   loadIncidents()       — fetches from DB into STATE.incidents, then renders
   renderIncidents()     — splits incidents into 3 buckets (da raggiungere /
                           attivi / chiusi) and builds the panel list
   buildIncidentCard()   — builds a single incident card DOM element
   getIncidentStatusLabel() — returns the human-readable status badge text
                              for a given incident + this resource's response
================================================================ */
async function loadIncidents() {
  STATE.incidents = await fetchIncidents();
  renderIncidents();

}

function renderIncidents() {
  const activeList   = document.getElementById('active-incidents-list');
  const closedList   = document.getElementById('closed-incidents-list');
  const enRouteList  = document.getElementById('enroute-incidents-list');
  const emptyActive  = document.getElementById('empty-active');
  const emptyClosed  = document.getElementById('empty-closed');
  const enRouteSection = document.getElementById('enroute-section');

  const isCoord = STATE.resource.resource_type === 'LDC';
  let incidents = STATE.incidents;

  // Apply team filter if coordinator has one selected
  if (STATE.activeTeamFilter) {
    incidents = incidents.filter(i =>
      (i.incident_responses || []).some(
        r => r.resource_id === STATE.activeTeamFilter
      )
    );
  }

  const enRoute = isCoord ? [] : incidents.filter(i => {
    if (!i._isActive) return false;
    const myResponse = (i.incident_responses || [])
      .find(r => r.resource_id === STATE.resource.id);
    return myResponse?.outcome === 'en_route_to_incident';
  });

  const active = incidents.filter(i => {
    if (!i._isActive) return false;
    const myResponse = (i.incident_responses || [])
      .find(r => r.resource_id === STATE.resource.id);
    return myResponse?.outcome !== 'en_route_to_incident';
  });

  const closed = incidents.filter(i => !i._isActive);

  // En route section — only show if non-empty
  enRouteSection.style.display = enRoute.length > 0 ? 'block' : 'none';
  enRouteList.innerHTML = '';
  enRoute.forEach(i => enRouteList.appendChild(buildIncidentCard(i)));

  // Active
  activeList.innerHTML = '';
  activeList.appendChild(emptyActive);
  emptyActive.style.display = active.length === 0 ? 'flex' : 'none';
  active.forEach(i => activeList.appendChild(buildIncidentCard(i)));

  // Closed
  closedList.innerHTML = '';
  closedList.appendChild(emptyClosed);
  emptyClosed.style.display = closed.length === 0 ? 'flex' : 'none';
  closed.forEach(i => closedList.appendChild(buildIncidentCard(i)));

  const badge = document.getElementById('incidents-badge');
  const totalActive = enRoute.length + active.length;
  badge.textContent = totalActive;
  badge.classList.toggle('visible', totalActive > 0);
}

function buildIncidentCard(inc) {
  const card = document.createElement('div');
  card.className = 'incident-card-mobile';
  card.dataset.id = inc.id;

  const triage    = inc.current_triage || 'none';
  const patient   = inc.patient_name || inc.patient_identifier || 'Paziente sconosciuto';
  const lastUpdate = inc.updated_at || inc.created_at;
  const time = new Date(lastUpdate)
    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  const resources = (inc.incident_responses || [])
    .map(r => r.resources?.resource)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  const statusLabel = getIncidentStatusLabel(inc);

  card.innerHTML = `
    <div class="incident-card-top">
      <div class="triage-bar ${triage}"></div>
      <div class="incident-card-body">
      <div class="incident-patient">Nome: ${inc.patient_name ? '<strong>' + inc.patient_name + '</strong>' : '<strong>Ignoto</strong>'}</div>        
        <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;line-height:1.6;">
          Pettorale: ${inc.patient_identifier || 'ignoto'}<br>
          Età: ${inc.patient_age || 'ignoto'} · Sesso: ${inc.patient_gender || 'ignoto'}<br>Descr: ${inc.description || 'Nessuna'}
        </div>
      </div>
      <span class="incident-status-badge ${inc.status}">
        ${statusLabel}
      </span>
    </div>
    <div class="incident-card-footer">
      <span class="incident-footer-resource">
        ${resources.join(' · ') || STATE.resource.resource}
      </span>
      <span class="incident-footer-time">${time}</span>
    </div>
  `;

  card.addEventListener('click', () => openIncidentDetail(inc.id));
  return card;
}

function getIncidentStatusLabel(inc) {
  if (inc._isActive) {
    // Check if this resource is en route
    const myResponse = (inc.incident_responses || [])
      .find(r => r.resource_id === STATE.resource.id);
    if (myResponse?.outcome === 'en_route_to_pma')       return '🚑 → PMA';
    if (myResponse?.outcome === 'en_route_to_hospital')  return '🚑 → Ospedale';
    if (myResponse?.outcome === 'en_route_to_incident')  return '📍 Da raggiungere';
    return STATUS_LABELS[inc.status] || inc.status;
  }  
  // Closed — find this resource's response
  const myResponse = (inc.incident_responses || [])
    .find(r => r.resource_id === STATE.resource.id);

   if (!myResponse) return STATUS_LABELS[inc.status] || inc.status;

  switch (myResponse.outcome) {
    case 'treated_and_released': return '✔ Dimesso';
    case 'handed_off':           return '🤝 Consegnato';
    case 'taken_to_pma':         return '🏥 Al PMA';
    case 'taken_to_hospital':    return '🚑 Ospedalizzato';
    case 'consegnato_118':    return '🚨 Consegnato 118';
    case 'en_route_to_pma':      return '🚑 → PMA';
    case 'en_route_to_hospital': return '🚑 → Ospedale';
    case 'refused_transport':    return 'Rifiuta'
    case 'cancelled':            return '✕ Annullato';
    default: return STATUS_LABELS[inc.status] || inc.status;
  }
}

/* ================================================================
   OUTCOME HELPERS
   initOutcomePanel(containerEl) — wires click events on outcome options,
                                   shows/hides sub-detail panels (PMA select etc.)
   readOutcomePanel()            — reads the selected outcome from the panel,
                                   validates required fields, returns outcome data
   executeOutcome(responseId, outcomeData) — writes the outcome to the DB,
                                   handles handoff RPC or direct update
================================================================ */


function initOutcomePanel(containerEl) {
  const detailDivs = {
    consegnato_squadra: 'od-squadra',
    trasportato_pma:    'od-pma',
    ospedalizzato:      'od-ospedale',
  };

  containerEl.querySelectorAll('.outcome-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      containerEl.querySelectorAll('.outcome-opt')
        .forEach(o => o.classList.remove('selected'));
      Object.values(detailDivs).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      opt.classList.add('selected');
      STATE.formData.outcomeType = opt.dataset.outcomeType;
      const detailId = detailDivs[opt.dataset.outcomeType];
      if (detailId) {
        const el = document.getElementById(detailId);
        if (el) el.style.display = 'flex';
      }
    });
  });
}

function readOutcomePanel() {
  const type = STATE.formData.outcomeType;
  if (!type) { showToast('Seleziona un esito', 'error'); return null; }

  switch (type) {
    case 'treated_and_released':
      return { dbOutcome: 'treated_and_released' };
    case 'consegnato_squadra': {
      const toId = document.getElementById('od-squadra-select')?.value;
      if (!toId) { showToast('Seleziona la squadra ricevente', 'error'); return null; }
      return { dbOutcome: 'handed_off', toResourceId: toId };
    }
    case 'trasportato_pma': {
      const toId = document.getElementById('od-pma-select')?.value;
      if (!toId) { showToast('Seleziona il PMA', 'error'); return null; }
      return { dbOutcome: 'taken_to_pma', toResourceId: toId };
    }
    case 'ospedalizzato': {
      const hosp  = document.getElementById('od-ospedale-name')?.value.trim();
      const gipse = document.getElementById('od-gipse')?.value.trim();
      if (!hosp) { showToast("Inserisci il nome dell'ospedale", 'error'); return null; }
      if (!gipse) { showToast("Inserisci il codice GIPSE", 'error'); return null; }
      return { 
        dbOutcome: 'taken_to_hospital',
        dest_hospital: hosp,
        notes: `GIPSE: ${gipse}`
      };
    }
    case 'consegnato_118':
      return { dbOutcome: 'consegnato_118' };
    case 'rifiuta_trasporto':
      return { dbOutcome: 'refused_transport',
        notes: 'Paziente rifiuta il trasporto' };
    case 'annullato':
      return { dbOutcome: 'cancelled' };
    default:
      return null;
  }
}

async function executeOutcome(responseId, outcomeData) {
  const { dbOutcome, toResourceId, dest_hospital, notes } = outcomeData;

  if (toResourceId) {
    await db.rpc('handoff_incident', {
      p_from_response_id: responseId,
      p_to_resource_id:   toResourceId,
      p_to_personnel_id:  null,   // receiving team's personnel unknown at handoff time
      p_outcome:          dbOutcome,
      p_notes:            notes || null,
      p_hospital_info:    null,
    });
  } else {
    await updateResponseOutcome(responseId, dbOutcome, {
      notes:        notes        || null,
      dest_hospital: dest_hospital || null,
    });
  }
}


/* ================================================================
   NEW INCIDENT FORM
   openIncidentForm()   — builds modal body using shared HTML builders,
                          wires all events (Y/N, triage, gender, location,
                          status selector, submit), then opens the modal
                          and auto-fetches GPS position
   submitIncident()     — validates form, builds RPC params, calls
                          create_incident_with_assessment, handles offline queue
================================================================ */
async function openIncidentForm() {

  // Reset state
  STATE.formData = {
    triage: null, conscious: true, respiration: true, circulation: true,
    walking: null, minor_injuries: null, gender: null,
    status: 'in_progress', outcomeType: null, lat: null, lng: null,
  };

  const isClinical = CLINICAL_TYPES.includes(STATE.resource.resource_type);

  // Fetch resources for outcome panel (only needed if we show it, but fetch early)
  const allResources  = await fetchEventResources();
  const pmaOptions    = allResources.filter(r => r.resource_type === 'PMA')
    .map(r => `<option value="${r.id}">${r.resource}</option>`).join('');
  const teamOptions   = allResources.filter(r => !['PMA','LDC','PCA'].includes(r.resource_type))
    .map(r => `<option value="${r.id}">${r.resource} (${r.resource_type})</option>`).join('');

  // Build modal body
  const body = document.querySelector('#modal-incident .modal-body');
  body.innerHTML = `
    ${buildPatientHTML()}
    ${buildBaseConditionsHTML({ conscious: true, respiration: true, circulation: true }, false, isClinical)}
    ${isClinical ? buildClinicalHTML() : ''}
    ${buildLocationTimeHTML()}

    <div class="form-section">
      <div class="form-section-title">Stato attuale</div>
      <div class="status-selector">
        <div class="status-option selected" id="status-opt-active">
          <span class="status-option-icon">🚨</span>
          <div>
            <div style="font-weight:bold;">In corso</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
              Sto ancora trattando il paziente
            </div>
          </div>
        </div>
        <div class="status-option" id="status-opt-resolved">
          <span class="status-option-icon">✅</span>
          <div>
            <div style="font-weight:bold;">Già risolto</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
              Intervento concluso — seleziona esito
            </div>
          </div>
        </div>
      </div>
      <div id="form-outcome-panel"></div>
    </div>

    <button class="btn-submit-incident" id="btn-submit-incident">
      Registra Intervento
    </button>
  `;

  // Wire Y/N buttons
  wireYNButtons(body, STATE.formData, ['conscious', 'respiration', 'circulation']);

  // Wire triage
  if (isClinical) wireTriageButtons(body, STATE.formData);

  // Wire gender
  body.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.formData.gender = btn.dataset.value;
    });
  });

  // Wire age steppers
  body.querySelector('#age-up')?.addEventListener('click', () => {
    const input = body.querySelector('#f-patient-age');
    input.value = Math.min((parseInt(input.value) || 40) + 10, 120);
  });
  body.querySelector('#age-down')?.addEventListener('click', () => {
    const input = body.querySelector('#f-patient-age');
    input.value = Math.max((parseInt(input.value) || 60) - 10, 0);
  });

  // Wire location button
  body.querySelector('#btn-get-location')?.addEventListener('click', async () => {
    const btn = body.querySelector('#btn-get-location');
    btn.textContent = '📍 Localizzazione...';
    try {
      const pos = await getCurrentPosition();
      STATE.formData.lat = pos.coords.latitude;
      STATE.formData.lng = pos.coords.longitude;
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      body.querySelector('#location-coords').textContent = `${lat}, ${lng}`;
      body.querySelector('#location-accuracy').textContent =
        `Accuratezza: ±${Math.round(pos.coords.accuracy)}m`;
      body.querySelector('#location-display').style.display = 'flex';
      body.querySelector('#location-map-img').src =
        `https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lng)-0.002},${parseFloat(lat)-0.002},${parseFloat(lng)+0.002},${parseFloat(lat)+0.002}&layer=mapnik&marker=${lat},${lng}`;
      body.querySelector('#location-map-container').style.display = 'block';
      btn.textContent = '📍 Aggiorna posizione';
      btn.classList.add('got');
    } catch (_) {
      btn.textContent = '📍 Usa posizione attuale';
      showToast('GPS non disponibile — premi il pulsante per riprovare', 'error', 4000);
    }
  });

  // Wire status selector
  body.querySelector('#status-opt-active')?.addEventListener('click', () => {
    STATE.formData.status = 'in_progress';
    STATE.formData.outcomeType = null;
    body.querySelector('#status-opt-active').classList.add('selected');
    body.querySelector('#status-opt-resolved').classList.remove('selected');
    body.querySelector('#form-outcome-panel').innerHTML = '';
  });

  body.querySelector('#status-opt-resolved')?.addEventListener('click', () => {
    STATE.formData.status = 'resolved';
    STATE.formData.outcomeType = null;
    body.querySelector('#status-opt-active').classList.remove('selected');
    body.querySelector('#status-opt-resolved').classList.add('selected');
    const panel = body.querySelector('#form-outcome-panel');
    panel.innerHTML = buildOutcomeOptionsHTML(pmaOptions, teamOptions, isClinical);
    initOutcomePanel(panel);
  });

  // Wire submit
  body.querySelector('#btn-submit-incident').addEventListener('click', submitIncident);

  openModal('modal-incident');

  // Auto-fetch location
  const locBtn = body.querySelector('#btn-get-location');
  locBtn.textContent = '📍 Localizzazione...';
  getCurrentPosition()
    .then(pos => {
      STATE.formData.lat = pos.coords.latitude;
      STATE.formData.lng = pos.coords.longitude;
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      body.querySelector('#location-coords').textContent = `${lat}, ${lng}`;
      body.querySelector('#location-accuracy').textContent =
        `Accuratezza: ±${Math.round(pos.coords.accuracy)}m`;
      body.querySelector('#location-display').style.display = 'flex';
      body.querySelector('#location-map-img').src =
        `https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lng)-0.002},${parseFloat(lat)-0.002},${parseFloat(lng)+0.002},${parseFloat(lat)+0.002}&layer=mapnik&marker=${lat},${lng}`;
      body.querySelector('#location-map-container').style.display = 'block';
      locBtn.textContent = '📍 Aggiorna posizione';
      locBtn.classList.add('got');
    })
    .catch(() => {
      locBtn.textContent = '📍 Usa posizione attuale';
      showToast('GPS non disponibile — premi il pulsante per riprovare', 'error', 4000);
    });
}

async function submitIncident() {
  const btn = document.getElementById('btn-submit-incident');

  if (STATE.formData.conscious === null) {
    showToast('Indica lo stato di coscienza', 'error'); return;
  }
  if (STATE.formData.respiration === null) {
    showToast('Indica la respirazione', 'error'); return;
  }
  if (STATE.formData.circulation === null) {
    showToast('Indica il circolo', 'error'); return;
  }
  if (CLINICAL_TYPES.includes(STATE.resource.resource_type) && !STATE.formData.triage) {
    showToast('Seleziona il triage', 'error'); return;
  }

  let outcomeData = null;
  if (STATE.formData.status === 'resolved') {
    outcomeData = readOutcomePanel();
    if (!outcomeData) return;
  }

  btn.disabled  = true;
  btn.textContent = 'Registrazione...';

  try {
    const lat = STATE.formData.lat || STATE.event?.center_lat;
    const lng = STATE.formData.lng || STATE.event?.center_lng;

    const ageVal   = document.getElementById('f-patient-age')?.value  || '';
    const hrVal    = document.getElementById('f-heart-rate')?.value   || '';
    const spo2Val  = document.getElementById('f-spo2')?.value         || '';
    const brSlider = document.getElementById('f-breathing-rate');
    const brValue  = brSlider && parseInt(brSlider.value) > 0
      ? parseInt(brSlider.value) : null;

    const initialOutcome = outcomeData ? outcomeData.dbOutcome : null;

    const params = {
      p_event_id:           STATE.resource.event_id,
      p_resource_id:        STATE.resource.id,
      p_personnel_id:       STATE.personnel?.id || null,   
      p_reporting_resource_id:  null,                          
      p_incident_type:      CLINICAL_TYPES.includes(STATE.resource.resource_type)
                              ? document.getElementById('f-incident-type')?.value || null : null,
      p_lng:                lng,
      p_lat:                lat,
      p_location_description:   null,
      p_patient_name:       document.getElementById('f-patient-name')?.value    || null,
      p_patient_age:        ageVal !== '' ? parseInt(ageVal) : null,
      p_patient_gender:     STATE.formData.gender                                || null,
      p_patient_identifier: document.getElementById('f-patient-id')?.value      || null,
      p_description:    document.getElementById('f-description')?.value || null,
      p_initial_outcome:    initialOutcome,
      p_conscious:          STATE.formData.conscious,
      p_respiration:        STATE.formData.respiration,
      p_circulation:        STATE.formData.circulation,
      p_walking:            STATE.formData.walking,     
      p_minor_injuries:     STATE.formData.minor_injuries,                       
      p_heart_rate:         hrVal !== '' ? parseInt(hrVal) : null,
      p_spo2:               spo2Val !== '' ? parseInt(spo2Val) : null,
      p_breathing_rate: document.getElementById('f-breathing-rate')?.value !== ''
                    ? parseInt(document.getElementById('f-breathing-rate')?.value) : null,
      p_blood_pressure: document.getElementById('f-blood-pressure')?.value || null,
      p_temperature:    document.getElementById('f-temperature')?.value !== ''
                    ? parseFloat(document.getElementById('f-temperature')?.value) : null,           
      p_triage:             STATE.formData.triage,
      p_clinical_notes:     document.getElementById('f-clinical-notes')?.value || null,
      p_iv_access:              (() => {
                              const b = document.querySelector('#modal-incident .yn-btn[data-field="iv_access"].active');
                              return b ? b.dataset.value === 'true' : null;
                            })(),
      p_gcs_total:          null,
      p_hgt:                null,
    };


    const result = await createIncident(params);

    if (!result.offline && outcomeData?.toResourceId && result.data) {
      const { data: resp } = await db
        .from('incident_responses')
        .select('id')
        .eq('incident_id', result.data.incident_id)
        .eq('resource_id', STATE.resource.id)
        .single();
      if (resp) await executeOutcome(resp.id, outcomeData);
    }

    if (result.offline) {
      showToast('Salvato offline — verrà inviato appena possibile', 'offline', 5000);
    } else {
      showToast('Intervento registrato ✓', 'success');
      await loadIncidents();
      await refreshHeaderStatus();   
    }
    closeModal('modal-incident');

  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled  = false;
    btn.textContent = 'Registra Intervento';
  }
}

/* ================================================================
   INCIDENT DETAIL MODAL
   openIncidentDetail(incidentId) — fetches full incident data, renders
                                    the detail body, wires all action buttons
                                    (assessment, edit patient, en route,
                                    arrived, close, reopen)
   buildDetailHTML(inc)           — builds the full detail HTML: da raggiungere
                                    block, outcome summary, patient card, assessment
                                    history, rapid actions, close incident panel
   confirmDetailOutcome(id)       — reads and executes the selected closing outcome
   reopenIncident(id)             — sets response outcome back to 'treating'
================================================================ */
async function openIncidentDetail(incidentId) {
  const body = document.getElementById('detail-body');
  body.innerHTML = '<div class="empty-state"><div class="skeleton" style="height:120px;width:100%;"></div></div>';
  openModal('modal-detail');

  const inc = await fetchIncidentDetail(incidentId);
  if (!inc) {
    body.innerHTML = '<div class="empty-state"><div class="empty-text">Errore nel caricamento</div></div>';
    return;
  }

  const titleEl = document.getElementById('detail-title');
  const myDetailResponse = (inc.incident_responses || [])
    .find(r => r.resource_id === STATE.resource.id);
  const myOutcome = myDetailResponse?.outcome;
  titleEl.textContent =
    myOutcome === 'en_route_to_incident' ? 'In arrivo' :
    ['treating', 'en_route_to_pma', 'en_route_to_hospital'].includes(myOutcome) ? 'In corso' :
    'Chiuso';
  titleEl.dataset.incidentId = incidentId;

  body.innerHTML = await buildDetailHTML(inc);

  const myResponse = (inc.incident_responses || [])
  .find(r => r.resource_id === STATE.resource.id &&
    ['treating','en_route_to_pma','en_route_to_hospital'].includes(r.outcome));

  const isEnRoutePma      = myResponse?.outcome === 'en_route_to_pma';
  const isEnRouteHospital = myResponse?.outcome === 'en_route_to_hospital';
  const isEnRoute         = isEnRoutePma || isEnRouteHospital;
  const isClinical        = CLINICAL_TYPES.includes(STATE.resource.resource_type);

  document.getElementById('btn-add-assessment')
    ?.addEventListener('click', () => {
      const latest = (inc.patient_assessments || [])
        .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at))[0] || null;
      openAssessmentForm(incidentId, latest);
    });

  document.getElementById('btn-edit-patient')
    ?.addEventListener('click', () => openEditPatient(inc));

  document.getElementById('btn-reopen-incident')
    ?.addEventListener('click', () => reopenIncident(incidentId));

    //Arrived button only for incidents in progress where this resource is en route (called from pca)
  document.getElementById('btn-im-arrived')
    ?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-im-arrived');
      btn.disabled = true;
      btn.textContent = 'Aggiornamento...';
      const response = await findActiveResponse(incidentId);
      if (!response) { showToast('Nessuna risposta attiva', 'error'); return; }
      const { error } = await db
        .from('incident_responses')
        .update({ outcome: 'treating', arrived_at: new Date().toISOString() })
        .eq('id', response.id);
      if (error) { showToast('Errore: ' + error.message, 'error'); btn.disabled = false; btn.textContent = '✓ Sono arrivato'; return; }
      showToast('Intervento preso in carico ✓', 'success');
      closeModal('modal-detail');
      await loadIncidents();
      await refreshHeaderStatus();
    });  

 // Toggle quick action panels
  [
    ['btn-en-route-pma',      'od-enroute-pma'],
    ['btn-en-route-hospital', 'od-enroute-hospital'],
    ['btn-call-team',         'od-call-team'],
  ].forEach(([btnId, panelId]) => {
    document.getElementById(btnId)?.addEventListener('click', () => {
      ['od-enroute-pma','od-enroute-hospital','od-call-team'].forEach(id => {
        if (id !== panelId) {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        }
      });
      const el = document.getElementById(panelId);
      if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
    });
  });

  // Cancel en route
  document.getElementById('btn-cancel-enroute')
    ?.addEventListener('click', async () => {
      const response = await findActiveResponse(incidentId);
      if (!response) return;
      const { error } = await db
        .from('incident_responses')
        .update({ outcome: 'treating', dest_pma_id: null, dest_hospital: null })
        .eq('id', response.id);
      if (error) { showToast('Errore: ' + error.message, 'error'); return; }
      showToast('Trasporto annullato', 'success');
      closeModal('modal-detail');
      await loadIncidents();
      await refreshHeaderStatus();
    });

  // Confirm en route PMA
  document.getElementById('btn-confirm-enroute-pma')
    ?.addEventListener('click', async () => {
      const pmaId = document.getElementById('enroute-pma-select')?.value;
      console.log('pmaId:', pmaId);
      if (!pmaId) { showToast('Seleziona il PMA', 'error'); return; }
      const response = await findActiveResponse(incidentId);
      console.log('response:', response);
      if (!response) { showToast('Nessuna risposta attiva', 'error'); return; }
      const { error } = await db
        .from('incident_responses')
        .update({ outcome: 'en_route_to_pma', dest_pma_id: pmaId })
        .eq('id', response.id);
      if (error) { showToast('Errore: ' + error.message, 'error'); return; }
      showToast('PMA avvisato ✓', 'success');
      closeModal('modal-detail');
      await loadIncidents();
      await refreshHeaderStatus();
    });

  // Confirm en route hospital
  document.getElementById('btn-confirm-enroute-hospital')
    ?.addEventListener('click', async () => {
      const hosp = document.getElementById('enroute-hospital-name')?.value.trim();
      if (!hosp) { showToast("Inserisci il nome dell'ospedale", 'error'); return; }
      const response = await findActiveResponse(incidentId);
      if (!response) { showToast('Nessuna risposta attiva', 'error'); return; }
      const { error } = await db
        .from('incident_responses')
        .update({ outcome: 'en_route_to_hospital', dest_hospital: hosp })
        .eq('id', response.id);
      if (error) { showToast('Errore: ' + error.message, 'error'); return; }
      showToast('In trasporto verso ospedale ✓', 'success');
      closeModal('modal-detail');
      await loadIncidents();
      await refreshHeaderStatus();
    });

  // Confirm call team
  document.getElementById('btn-confirm-call-team')
    ?.addEventListener('click', async () => {
      const teamId = document.getElementById('call-team-select')?.value;
      if (!teamId) { showToast('Seleziona la squadra', 'error'); return; }
      const { error } = await db
        .from('incident_responses')
        .insert({
          event_id:    STATE.resource.event_id,
          incident_id: incidentId,
          resource_id: teamId,
          role:        'backup',
          outcome:     'treating',
          assigned_at: new Date().toISOString()
        });
      if (error) { showToast('Errore: ' + error.message, 'error'); return; }
      showToast('Squadra aggiunta ✓', 'success');
      openIncidentDetail(incidentId);
    });

    // confirm arrival to pma/hospital
  document.getElementById('btn-arrived')
  ?.addEventListener('click', async () => {
    if (isEnRoutePma) {
      const { error } = await db.rpc('handoff_incident', {
        p_from_response_id: myResponse.id,
        p_to_resource_id:   myResponse.dest_pma_id,
        p_to_personnel_id:  null,
        p_outcome:          'taken_to_pma',
        p_notes:            null,
        p_hospital_info:    null,
      });
      if (error) { showToast('Errore: ' + error.message, 'error'); return; }
      showToast('Paziente consegnato al PMA ✓', 'success');

    } else if (isEnRouteHospital) {
      const detail = document.getElementById('arrived-hospital-detail');
      if (detail.style.display === 'none') {
        detail.style.display = 'flex';
        return;
      }
      const hosp  = document.getElementById('arrived-hospital-name')?.value.trim();
      const gipse = document.getElementById('arrived-gipse')?.value.trim();
      if (!hosp)  { showToast("Inserisci il nome dell'ospedale", 'error'); return; }
      if (!gipse) { showToast('Inserisci il codice GIPSE', 'error'); return; }

      const { error } = await db
        .from('incident_responses')
        .update({
          outcome:       'taken_to_hospital',
          dest_hospital: hosp,
          gipse:         gipse || null,
          released_at:   new Date().toISOString(),
        })
        .eq('id', myResponse.id);
      if (error) { showToast('Errore: ' + error.message, 'error'); return; }
      showToast("Paziente consegnato all'ospedale ✓", 'success');
    }

    closeModal('modal-detail');
    await loadIncidents();
    await refreshHeaderStatus();
  });

  const outcomeContainer = document.getElementById('detail-outcome-container');
  if (outcomeContainer) {
    STATE.formData.outcomeType = null;
    initOutcomePanel(outcomeContainer);
    document.getElementById('btn-detail-confirm-outcome')
      ?.addEventListener('click', () => confirmDetailOutcome(incidentId));
  }
}

async function buildDetailHTML(inc) {
  
  const assessments = (inc.patient_assessments || [])
    .sort((b, a) => new Date(a.assessed_at) - new Date(b.assessed_at));

  const yn = v => v === true
    ? '<span style="color:var(--green);font-weight:bold;">Sì</span>'
    : v === false
    ? '<span style="color:var(--red);font-weight:bold;">No</span>'
    : '<span style="color:var(--text-muted);">—</span>';

  // Fetch resources once for all dropdowns
  const allResources    = await fetchEventResources();
  const pmaResources    = allResources.filter(r => r.resource_type === 'PMA');
  const teamResources   = allResources.filter(r => !['PMA','LDC','PCA'].includes(r.resource_type));
  const pmaOptionsHTML  = pmaResources.map(r =>
    `<option value="${r.id}">${r.resource}</option>`).join('');
  const teamOptionsHTML = teamResources.map(r =>
    `<option value="${r.id}">${r.resource} (${r.resource_type})</option>`).join('');

  const isClinical = CLINICAL_TYPES.includes(STATE.resource.resource_type);
    
   const isCoordinator = STATE.resource.resource_type === 'LDC';

  const myResponse = isCoordinator ? null : (inc.incident_responses || [])
    .find(r => r.resource_id === STATE.resource.id &&
      ['treating','en_route_to_incident','en_route_to_pma','en_route_to_hospital'].includes(r.outcome));

  const isMyEnRoute       = myResponse?.outcome === 'en_route_to_incident';
  const canClose          = !isCoordinator && myResponse?.outcome === 'treating';
  const isEnRoutePma      = myResponse?.outcome === 'en_route_to_pma';
  const isEnRouteHospital = myResponse?.outcome === 'en_route_to_hospital';
  const isEnRoute         = isEnRoutePma || isEnRouteHospital;

  const canReopen = isCoordinator ? false
    : !myResponse && (inc.incident_responses || []).some(
        r => r.resource_id === STATE.resource.id
      );

  const outcomePanelHTML = canClose ? await buildOutcomeOptionsHTML(pmaOptionsHTML, teamOptionsHTML, isClinical) : '';

   //build outcome summary for closed incidents
  const myClosedResponse = canReopen
    ? (inc.incident_responses || []).find(r => r.resource_id === STATE.resource.id)
    : null;
  const outcomeBlock = myClosedResponse ? (() => {
    const o = myClosedResponse.outcome;
    let text = '';
    if (o === 'treated_and_released') {
      text = '✔ Trattato e dimesso';
    } else if (o === 'cancelled') {
      text = '✕ Annullato / Falso allarme';
    } else if (o === 'refused_transport') {
      text = '🚶 Paziente ha rifiutato il trasporto';
    } else if (o === 'consegnato_118') {
      text = '🚨 Consegnato al 118';
    } else if (o === 'handed_off') {
      const receivingResource = myClosedResponse.handoff_resource_name || '—';
      text = `🤝 Consegnato a ${receivingResource}`;
    } else if (o === 'taken_to_pma') {
      // find the pma resource name from dest_pma_id via allResources
      const pma = [...pmaResources, ...allResources].find(r => r.id === myClosedResponse.dest_pma_id);
      text = `🏥 Trasportato al ${pma ? pma.resource : ''}`;
    } else if (o === 'taken_to_hospital') {
      text = `🚑 Ospedalizzato${myClosedResponse.dest_hospital ? ': ' + myClosedResponse.dest_hospital : ''}`;
    } else {
      text = o;
    }
    return `
      <div style="background:var(--bg-card);border:1.5px solid var(--border-bright);
        border-radius:var(--radius);padding:12px;margin-bottom:12px;
        font-size:14px;font-weight:600;color:var(--text-primary);">
        ${text}
      </div>`;
  })() : '';
  const otherActiveTeams = (inc.incident_responses || [])
    .filter(r => r.resource_id !== STATE.resource.id && r.outcome === 'treating')
    .map(r => r.resources?.resource)
    .filter(Boolean);

  const activeBlock = (myResponse?.outcome === 'treating' && otherActiveTeams.length > 0) ? `
    <div style="background:var(--bg-card);border:1.5px solid var(--border-bright);
      border-radius:var(--radius);padding:12px;margin-bottom:12px;
      font-size:14px;font-weight:600;color:var(--text-primary);">
      🤝 In trattamento insieme a ${otherActiveTeams.join(', ')}
    </div>` : '';

  // build resource name lookup from response_id
  const responseResourceMap = {};
  (inc.incident_responses || []).forEach(r => {
    responseResourceMap[r.id] = r.resources?.resource || '—';
  });

  // active response resource ids
  const ACTIVE_OUTCOMES = ['treating','en_route_to_incident','en_route_to_pma','en_route_to_hospital'];
  const activeResourceIds = new Set(
    (inc.incident_responses || [])
      .filter(r => ACTIVE_OUTCOMES.includes(r.outcome))
      .map(r => r.resource_id)
  );

  // teams row in detail header
  const teamsHTML = (() => {
    const responses = (inc.incident_responses || [])
      .filter(r => r.resources?.resource);
    if (responses.length === 0) return '';
    return `
      <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;">
        ${responses.map(r => {
          const isActive = ACTIVE_OUTCOMES.includes(r.outcome);
          return `<span style="font-weight:${isActive ? 'bold' : 'normal'};
            color:${isActive ? 'var(--text-primary)' : 'var(--text-secondary)'};">
            ${r.resources.resource}
          </span>`;
        }).join(' · ')}
      </div>`;
  })();

  
  const buildAssessmentCard = (a) => {
    const resourceName = responseResourceMap[a.response_id] || '—';
    return `
    <div style="background:var(--bg-card);border:1.5px solid var(--border-bright);
      border-radius:var(--radius-lg);padding:12px;margin-bottom:10px;">
      <div class="assessment-header">
        <div style="display:flex;align-items:center;gap:8px;">
          ${a.triage ? `
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="width:12px;height:12px;border-radius:50%;flex-shrink:0;background:${
              a.triage === 'red'    ? 'var(--triage-red)'    :
              a.triage === 'yellow' ? 'var(--triage-yellow)' :
              a.triage === 'green'  ? 'var(--triage-green)'  :
              'var(--triage-white)'
            };"></div>
            <span style="font-size:11px;font-weight:700;letter-spacing:1px;
              text-transform:uppercase;color:${
              a.triage === 'red'    ? 'var(--triage-red)'    :
              a.triage === 'yellow' ? 'var(--triage-yellow)' :
              a.triage === 'green'  ? 'var(--triage-green)'  :
              'var(--triage-white)'
            };">Codice ${a.triage === 'red' ? 'Rosso' : a.triage === 'yellow' ? 'Giallo' : a.triage === 'green' ? 'Verde' : 'Bianco'}</span>
            <span style="color:var(--border-bright);">·</span>
          </div>` : ''}
          <span class="assessment-by">${resourceName}</span>
        </div>
        <span class="assessment-time">
          ${new Date(a.assessed_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}
        </span>
      </div>
      ${a.description ? `
      <div style="margin-top:8px;">
        <div style="font-size:10px;letter-spacing:1.5px;color:var(--text-secondary);
          text-transform:uppercase;font-weight:700;margin-bottom:4px;">Descrizione</div>
        <div style="font-size:13px;color:var(--text-primary);line-height:1.5;
          padding:8px 10px;background:var(--bg-page);
          border-radius:var(--radius);border:1px solid var(--border);word-break:break-word;">
          ${a.description}
        </div>
      </div>` : ''}
      ${a.clinical_notes ? `
      <div style="margin-top:8px;">
        <div style="font-size:10px;letter-spacing:1.5px;color:var(--text-secondary);
          text-transform:uppercase;font-weight:700;margin-bottom:4px;">Note cliniche</div>
        <div style="font-size:13px;color:var(--text-primary);line-height:1.5;
          padding:8px 10px;background:var(--bg-page);
          border-radius:var(--radius);border:1px solid var(--border);word-break:break-word;">
          ${a.clinical_notes}
        </div>
      </div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;margin-bottom:8px;">
        <div class="vital-box"><div class="vital-label">Cosciente</div><div class="vital-value">${yn(a.conscious)}</div></div>
        <div class="vital-box"><div class="vital-label">Respira</div><div class="vital-value">${yn(a.respiration)}</div></div>
        <div class="vital-box"><div class="vital-label">Circolo</div><div class="vital-value">${yn(a.circulation)}</div></div>
        <div class="vital-box"><div class="vital-label">Cammina</div><div class="vital-value">${yn(a.walking)}</div></div>
        <div class="vital-box"><div class="vital-label">Prob. Minore</div><div class="vital-value">${yn(a.minor_injuries)}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:6px;">
        <div class="vital-box"><div class="vital-label">FC</div><div class="vital-value">${a.heart_rate ?? '—'}</div></div>
        <div class="vital-box"><div class="vital-label">SpO2</div><div class="vital-value">${a.spo2 != null ? a.spo2+'%' : '—'}</div></div>
        <div class="vital-box"><div class="vital-label">FR</div><div class="vital-value">${a.breathing_rate ?? '—'}</div></div>
        <div class="vital-box"><div class="vital-label">PA</div><div class="vital-value">${a.blood_pressure ?? '—'}</div></div>
      </div>
      ${(a.temperature != null || a.gcs_total != null || a.hgt != null || a.iv_access != null) ? `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
        <div class="vital-box"><div class="vital-label">Temp</div><div class="vital-value">${a.temperature ?? '—'}</div></div>
        <div class="vital-box"><div class="vital-label">GCS</div><div class="vital-value">${a.gcs_total ?? '—'}</div></div>
        <div class="vital-box"><div class="vital-label">HGT</div><div class="vital-value">${a.hgt ?? '—'}</div></div>
        <div class="vital-box"><div class="vital-label">Acc. Venoso</div><div class="vital-value">${yn(a.iv_access)}</div></div>
      </div>` : ''}
    </div>`;
  };

  const assessmentHTML = assessments.length === 0
    ? '<div class="empty-state"><div class="empty-text">Nessuna valutazione</div></div>'
    : (() => {
        const first = buildAssessmentCard(assessments[0]);
        const rest  = assessments.slice(1);
        if (rest.length === 0) return first;
        const n = rest.length;
        return `
          ${first}
          <div id="older-assessments" style="display:none;">
            ${rest.map(buildAssessmentCard).join('')}
          </div>
          <button id="btn-show-older" onclick="
            const el  = document.getElementById('older-assessments');
            const btn = document.getElementById('btn-show-older');
            const open = el.style.display === 'none';
            el.style.display = open ? 'block' : 'none';
            btn.textContent  = open
              ? '▲ Nascondi valutazioni precedenti'
              : '▼ Mostra ${n} valutazion${n===1?'e':'i'} precedent${n===1?'e':'i'}';
          " style="
            width:100%;padding:10px;border-radius:var(--radius);
            border:1px solid var(--border-bright);background:var(--bg-card);
            color:var(--text-secondary);font-size:12px;font-weight:600;
            font-family:var(--font);cursor:pointer;margin-bottom:10px;text-align:center;">
            ▼ Mostra ${n} valutazion${n===1?'e':'i'} precedent${n===1?'e':'i'}
          </button>`;
      })();

  let incidentLat = null, incidentLng = null;
  if (inc.geom?.coordinates) {
    incidentLng = inc.geom.coordinates[0];
    incidentLat = inc.geom.coordinates[1];
  }

  const enRouteBlock = isMyEnRoute ? `
    <div style="background:var(--bg-card);border:1.5px solid var(--blue);
      border-radius:var(--radius);padding:12px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;
        text-transform:uppercase;color:var(--blue);margin-bottom:8px;">
        📍 Da raggiungere
      </div>
      ${inc.location_description ? `
      <div style="font-size:14px;color:var(--text-primary);font-weight:600;
        margin-bottom:10px;word-break:break-word;">
        ${inc.location_description}
      </div>` : ''}
      ${incidentLat !== null ? `
      <div style="border-radius:var(--radius);overflow:hidden;margin-bottom:10px;">
        <iframe
          style="width:100%;height:180px;border:none;display:block;"
          src="https://www.openstreetmap.org/export/embed.html?bbox=${incidentLng-0.002},${incidentLat-0.002},${incidentLng+0.002},${incidentLat+0.002}&layer=mapnik&marker=${incidentLat},${incidentLng}">
        </iframe>
      </div>
      <a href="https://www.google.com/maps/search/?api=1&query=${incidentLat},${incidentLng}" 
        target="_blank" style="
        display:block;width:100%;padding:11px;border-radius:var(--radius);
        border:1.5px solid var(--blue);color:#1060cc;font-size:13px;
        font-weight:600;text-align:center;text-decoration:none;
        background:var(--blue-dim);margin-bottom:10px;box-sizing:border-box;">
        🗺 Apri in Maps
      </a>` : ''}
      <button id="btn-im-arrived" style="
        width:100%;padding:13px;border-radius:var(--radius);
        background:var(--green);color:white;font-size:13px;font-weight:bold;
        font-family:var(--font);cursor:pointer;border:none;letter-spacing:1px;">
        ✓ Sono arrivato
      </button>
    </div>` : '';

  const destPmaName = isEnRoutePma
    ? allResources.find(r => r.id === myResponse.dest_pma_id)?.resource || 'PMA'
    : null;

  const enRoutePmaHospitalBlock = isEnRoute ? `
  <div style="padding:14px 16px;border-radius:var(--radius);margin-bottom:12px;
    background:${isEnRoutePma ? 'var(--blue-dim)' : 'var(--orange-dim)'};
    border:1.5px solid ${isEnRoutePma ? 'var(--blue)' : 'var(--orange)'};
    display:flex;align-items:center;gap:10px;">
    <span style="font-size:22px;">${isEnRoutePma ? '🏥' : '🚑'}</span>
    <div>
      <div style="font-size:14px;font-weight:bold;
        color:${isEnRoutePma ? '#1060cc' : '#8a4a00'};">
        ${isEnRoutePma ? `In trasporto verso ${destPmaName}` : 'In trasporto verso ospedale'}      
      </div>
      ${isEnRouteHospital && myResponse.dest_hospital ? `
      <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
        ${myResponse.dest_hospital}
      </div>` : ''}
    </div>
  </div>` : '';

  return `${enRouteBlock}${enRoutePmaHospitalBlock}${activeBlock}${outcomeBlock}
    <div style="background:var(--bg-card);border-radius:var(--radius);padding:12px;margin-bottom:8px;">
      <div style="font-size:16px;font-weight:bold;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${inc.patient_name || 'Paziente ignoto'}
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;line-height:1.8;">
        Pettorale: ${inc.patient_identifier || '—'}<br>
        Età: ${inc.patient_age || '—'} · Sesso: ${inc.patient_gender || '—'}<br>Descrizione: ${inc.description || '—'}
      </div>
      ${teamsHTML}
    </div>

    <button id="btn-edit-patient" style="
      width:100%;padding:12px;border-radius:var(--radius);
      border:1px solid var(--border-bright);color:var(--text-secondary);
      font-size:12px;letter-spacing:1px;text-transform:uppercase;
      background:var(--bg-card);margin-bottom:12px;cursor:pointer;
      font-family:var(--font);">
      ✎ Modifica dati paziente
    </button>

    <div style="margin-bottom:12px;">
      <div class="form-section-title">Storico valutazioni</div>
      ${assessmentHTML}
    </div>

    ${(canClose ||isEnRoute)? `
    <button id="btn-add-assessment" style="
      width:100%;padding:12px;border-radius:var(--radius);
      border:1px solid var(--blue);color:var(--blue);font-size:12px;
      letter-spacing:2px;text-transform:uppercase;background:var(--blue-dim);
      margin-bottom:12px;cursor:pointer;font-family:var(--font);">
      + Aggiungi Valutazione
    </button>` : ''}

    ${isEnRoute ? `
    ${isEnRouteHospital ? `
    <div id="arrived-hospital-detail" style="display:none;flex-direction:column;gap:8px;
      padding:12px;background:var(--bg-card);border-radius:var(--radius);
      border:1px solid var(--border-bright);margin-bottom:8px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;
        text-transform:uppercase;color:var(--text-secondary);">Dati ospedale</div>
      <input type="text" id="arrived-hospital-name"
        value="${myResponse.dest_hospital || ''}"
        placeholder="Nome ospedale..."
        style="width:100%;padding:10px;border-radius:var(--radius);
        border:1.5px solid var(--border-bright);background:var(--bg-input);
        font-family:var(--font);font-size:14px;color:var(--text-primary);" />
      <input type="text" id="arrived-gipse" placeholder="Codice GIPSE..."
        style="width:100%;padding:10px;border-radius:var(--radius);
        border:1.5px solid var(--border-bright);background:var(--bg-input);
        font-family:var(--font);font-size:14px;color:var(--text-primary);" />
    </div>` : ''}
    <button id="btn-arrived" style="
      flex:1;padding:12px;border-radius:var(--radius);
      border:1.5px solid ${isEnRoutePma ? 'var(--blue)' : 'var(--green)'};
      color:${isEnRoutePma ? '#1060cc' : '#18a050'};font-size:12px;
      font-weight:bold;letter-spacing:1px;text-transform:uppercase;
      background:${isEnRoutePma ? 'var(--blue-dim)' : 'var(--green-dim)'};
      cursor:pointer;font-family:var(--font);">
      ✓ Arrivato
    </button>
    <button id="btn-cancel-enroute" style="
      width:100%;padding:12px;border-radius:var(--radius);
      border:1px solid var(--border-bright);color:var(--text-secondary);font-size:12px;
      letter-spacing:1px;text-transform:uppercase;background:var(--bg-card);
      margin-bottom:12px;cursor:pointer;font-family:var(--font);">
      ✕ Annulla trasporto
    </button>` : ''}

    ${canClose ? `
    <div style="margin-bottom:12px;">
      <div class="form-section-title">Azioni rapide</div>
      <div style="display:flex;flex-direction:column;gap:8px;">

        <button id="btn-en-route-pma" style="
          width:100%;padding:12px 16px;border-radius:var(--radius);
          border:1.5px solid var(--blue);color:#1060cc;font-size:13px;
          font-weight:600;background:var(--blue-dim);cursor:pointer;
          font-family:var(--font);text-align:left;">
          🏥 In viaggio verso PMA
        </button>
        <div id="od-enroute-pma" style="display:none;flex-direction:column;gap:8px;
          padding:12px;background:var(--bg-card);border-radius:var(--radius);
          border:1px solid var(--border-bright);">
          <div class="outcome-detail-label">Quale PMA? <span class="required">*</span></div>
          <select id="enroute-pma-select" style="width:100%;padding:10px;
            border-radius:var(--radius);border:1.5px solid var(--border-bright);
            background:var(--bg-input);font-family:var(--font);font-size:14px;
            color:var(--text-primary);">
            <option value="">— Seleziona —</option>${pmaOptionsHTML}
          </select>
          <button id="btn-confirm-enroute-pma" style="
            width:100%;padding:12px;border-radius:var(--radius);
            background:var(--blue);color:white;font-size:13px;font-weight:bold;
            font-family:var(--font);cursor:pointer;border:none;">
            Conferma
          </button>
        </div>
        ${isClinical ? `
        <button id="btn-en-route-hospital" style="
          width:100%;padding:12px 16px;border-radius:var(--radius);
          border:1.5px solid var(--orange);color:#8a4a00;font-size:13px;
          font-weight:600;background:var(--orange-dim);cursor:pointer;
          font-family:var(--font);text-align:left;">
          🚑 In viaggio verso ospedale
        </button>
        <div id="od-enroute-hospital" style="display:none;flex-direction:column;gap:8px;
          padding:12px;background:var(--bg-card);border-radius:var(--radius);
          border:1px solid var(--border-bright);">
          <div class="outcome-detail-label">Nome ospedale <span class="required">*</span></div>
          <input type="text" id="enroute-hospital-name" placeholder="Nome ospedale..."
            style="width:100%;padding:10px;border-radius:var(--radius);
            border:1.5px solid var(--border-bright);background:var(--bg-input);
            font-family:var(--font);font-size:14px;color:var(--text-primary);" />
          <button id="btn-confirm-enroute-hospital" style="
            width:100%;padding:12px;border-radius:var(--radius);
            background:var(--orange);color:white;font-size:13px;font-weight:bold;
            font-family:var(--font);cursor:pointer;border:none;">
            Conferma
          </button>
        </div>` : ''}

        <button id="btn-call-team" style="
          width:100%;padding:12px 16px;border-radius:var(--radius);
          border:1.5px solid var(--green);color:#18a050;font-size:13px;
          font-weight:600;background:var(--green-dim);cursor:pointer;
          font-family:var(--font);text-align:left;">
          🤝 Intervento insieme altra squadra
        </button>
        <div id="od-call-team" style="display:none;flex-direction:column;gap:8px;
          padding:12px;background:var(--bg-card);border-radius:var(--radius);
          border:1px solid var(--border-bright);">
          <div class="outcome-detail-label">Quale squadra? <span class="required">*</span></div>
          <select id="call-team-select" style="width:100%;padding:10px;
            border-radius:var(--radius);border:1.5px solid var(--border-bright);
            background:var(--bg-input);font-family:var(--font);font-size:14px;
            color:var(--text-primary);">
            <option value="">— Seleziona —</option>${teamOptionsHTML}
          </select>
          <button id="btn-confirm-call-team" style="
            width:100%;padding:12px;border-radius:var(--radius);
            background:var(--green);color:white;font-size:13px;font-weight:bold;
            font-family:var(--font);cursor:pointer;border:none;">
            Conferma
          </button>
        </div>

      </div>
    </div>

    <!-- Close case -->
    <div id="detail-outcome-container" style="margin-top:8px;">
      <div class="form-section-title">Chiudi intervento</div>
      ${outcomePanelHTML}
      <button id="btn-detail-confirm-outcome" class="btn-confirm-outcome">
        Conferma
      </button>
    </div>

    ` : canReopen ? `
    <button id="btn-reopen-incident" style="
      width:100%;padding:12px;border-radius:var(--radius);
      border:1px solid var(--orange);color:var(--orange);font-size:12px;
      letter-spacing:2px;text-transform:uppercase;background:var(--orange-dim);
      margin-bottom:12px;cursor:pointer;font-family:var(--font);">
      ↩ Riapri intervento
    </button>
    ` : ''}
  `;
}

async function confirmDetailOutcome(incidentId) {
  const outcomeData = readOutcomePanel();
  if (!outcomeData) return;

  const btn = document.getElementById('btn-detail-confirm-outcome');
  btn.disabled    = true;
  btn.textContent = 'Invio...';

  try {
    const response = await findActiveResponse(incidentId);
    if (!response) { showToast('Nessuna risposta attiva trovata', 'error'); return; }
    await executeOutcome(response.id, outcomeData);
    closeModal('modal-detail');
    showToast('Intervento aggiornato', 'success');
    await loadIncidents();
    await refreshHeaderStatus();   
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
    btn.disabled    = false;
    btn.textContent = 'Conferma';
  }
}

async function reopenIncident(incidentId) {
  try {
    // Find this resource's most recent response on this incident
    const { data: response, error } = await db
      .from('incident_responses')
      .select('id')
      .eq('incident_id', incidentId)
      .eq('resource_id', STATE.resource.id)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !response) {
      showToast('Nessuna risposta trovata', 'error');
      return;
    }

    const { error: updateError } = await db
      .from('incident_responses')
      .update({ outcome: 'treating', released_at: null })
      .eq('id', response.id);

    if (updateError) throw updateError;

    closeModal('modal-detail');
    showToast('Intervento riaperto', 'success');
    await loadIncidents();
    await refreshHeaderStatus();

  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  }
}

/* ================================================================
   NEW ASSESSMENT FORM
   openAssessmentForm(incidentId, previous) — builds modal body with
                                    pre-filled values from previous assessment
                                    (or defaults), wires Y/N + triage events,
                                    opens modal
   submitAssessment(incidentId)   — validates, inserts patient_assessments row,
                                    refreshes incident detail
================================================================ */
async function openAssessmentForm(incidentId, previous = null) {
  // Reset state
  STATE.assessmentData = {
    conscious: null, respiration: null, circulation: null,
    walking: null, minor_injuries: null, triage: null,
  };

  const isClinical = CLINICAL_TYPES.includes(STATE.resource.resource_type);

  // Pre-fill values from previous assessment or defaults
  const src = previous || {
    conscious: true, respiration: true, circulation: true,
    walking: null, minor_injuries: null, triage: null,
    heart_rate: null, spo2: null, breathing_rate: null,
    blood_pressure: null, temperature: null, iv_access: null,
    description: null, clinical_notes: null,
  };

  // Pre-fill state for the 5 tracked fields
  ['conscious', 'respiration', 'circulation', 'walking', 'minor_injuries'].forEach(field => {
    if (src[field] !== null && src[field] !== undefined) {
      STATE.assessmentData[field] = src[field];
    }
  });
  if (src.triage) STATE.assessmentData.triage = src.triage;

  // Build modal body using shared builders

  const body = document.querySelector('#modal-assessment .modal-body');
  body.innerHTML = `
    ${buildBaseConditionsHTML(src, true, isClinical)}
    ${isClinical ? buildClinicalHTML(src, true) : ''}
    <button class="btn-submit-incident" id="btn-submit-assessment">
      Salva Valutazione
    </button>
  `;

  // Wire Y/N buttons
  wireYNButtons(body, STATE.assessmentData, ['conscious', 'respiration', 'circulation']);

  // Wire triage
  if (isClinical) wireTriageButtons(body, STATE.assessmentData);

  // Wire submit and close
  body.querySelector('#btn-submit-assessment').addEventListener('click',
    () => submitAssessment(incidentId));
  document.getElementById('modal-assessment-close').onclick =
    () => closeModal('modal-assessment');

  openModal('modal-assessment');
}

async function submitAssessment(incidentId) {
  const btn = document.getElementById('btn-submit-assessment');
  if (STATE.assessmentData.conscious === null) {
    showToast('Indica lo stato di coscienza', 'error'); return;
  }
  if (STATE.assessmentData.respiration === null) {
    showToast('Indica la respirazione', 'error'); return;
  }
  if (STATE.assessmentData.circulation === null) {
    showToast('Indica il circolo', 'error'); return;
  }
  if (!document.getElementById('f-description')?.value.trim()) {
    showToast('Inserisci una descrizione', 'error'); return;
  }
  btn.disabled = true;
  btn.textContent = 'Salvataggio...';

  try {
    // Find the active response for this resource on this incident
    const response = await findActiveResponse(incidentId);
    if (!response) {
      showToast('Nessuna risposta attiva trovata', 'error');
      return;
    }

    const brSlider = document.getElementById('f-breathing-rate');
    const brValue  = brSlider && parseInt(brSlider.value) > 0
      ? parseInt(brSlider.value) : null;


    const { error } = await db
      .from('patient_assessments')
      .insert({
        incident_id:    incidentId,
        response_id:    response.id,
        assessed_by:    STATE.personnel?.id || null,
        conscious:      STATE.assessmentData.conscious,
        respiration:    STATE.assessmentData.respiration,
        circulation:    STATE.assessmentData.circulation,
        walking:        STATE.assessmentData.walking,
        minor_injuries: STATE.assessmentData.minor_injuries,
        heart_rate:     parseInt(document.getElementById('f-heart-rate')?.value) || null,
        spo2:           parseInt(document.getElementById('f-spo2')?.value)        || null,
        breathing_rate: brValue,
        blood_pressure: document.getElementById('f-blood-pressure')?.value || null,
        temperature:    document.getElementById('f-temperature')?.value !== ''
          ? parseFloat(document.getElementById('f-temperature')?.value) : null,
        iv_access: (() => {
          const b = document.querySelector('#modal-assessment .yn-btn[data-field="iv_access"].active');
          return b ? b.dataset.value === 'true' : null;
        })(),
        gcs_total: parseInt(document.getElementById('f-gcs')?.value) || null,
        hgt:       document.getElementById('f-hgt')?.value || null,
        triage:         STATE.assessmentData.triage,
        description:          document.getElementById('f-description')?.value.trim()          || null,
        clinical_notes: document.getElementById('f-clinical-notes')?.value.trim() || null,
      });

    if (error) throw error;

    closeModal('modal-assessment');
    showToast('Valutazione salvata ✓', 'success');

    // Refresh the detail modal to show new assessment
    openIncidentDetail(incidentId);

  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salva Valutazione';
  }
}

/* ================================================================
   EDIT PATIENT
   openEditPatient(inc)   — pre-fills modal-patient with current incident
                            patient data, wires age stepper + gender + save
   savePatient(incidentId) — updates incidents table with new patient data
================================================================ */

function openEditPatient(inc) {
  // Pre-fill with current values
  document.getElementById('ep-patient-name').value = inc.patient_name || '';
  document.getElementById('ep-patient-id').value   = inc.patient_identifier || '';
  document.getElementById('ep-patient-age').value  = inc.patient_age || '';

  // Gender
  document.querySelectorAll('#ep-gender-btns .seg-btn')
    .forEach(b => {
      b.classList.toggle('active', b.dataset.value === inc.patient_gender);
    });

  // Age stepper arrows
  document.getElementById('ep-age-up').onclick = () => {
    const input = document.getElementById('ep-patient-age');
    const next  = Math.min((parseInt(input.value) || 40) + 10, 120);
    input.value = next;
  };
  document.getElementById('ep-age-down').onclick = () => {
    const input = document.getElementById('ep-patient-age');
    const next  = Math.max((parseInt(input.value) || 60) - 10, 0);
    input.value = next;
  };

  // Gender buttons
  document.querySelectorAll('#ep-gender-btns .seg-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#ep-gender-btns .seg-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  // Save button
  document.getElementById('btn-save-patient').onclick =
    () => savePatient(inc.id);

  document.getElementById('modal-patient-close').onclick =
    () => closeModal('modal-patient');

  openModal('modal-patient');
}

async function savePatient(incidentId) {
  const btn = document.getElementById('btn-save-patient');
  btn.disabled  = true;
  btn.textContent = 'Salvataggio...';

  const ageVal = document.getElementById('ep-patient-age').value;
  const gender = document.querySelector('#ep-gender-btns .seg-btn.active')
    ?.dataset.value || null;

  try {
    const { error } = await db
      .from('incidents')
      .update({
        patient_name:       document.getElementById('ep-patient-name').value.trim() || null,
        patient_identifier: document.getElementById('ep-patient-id').value.trim()   || null,
        patient_age:        ageVal !== '' ? parseInt(ageVal) : null,
        patient_gender:     gender,
      })
      .eq('id', incidentId);

    if (error) throw error;

    closeModal('modal-patient');
    showToast('Dati paziente aggiornati ✓', 'success');
    openIncidentDetail(incidentId); // refresh detail
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled  = false;
    btn.textContent = 'Salva';
  }
}


/* ================================================================
   INIT
   initIncidentForm() — called once on app load. Wires the open-form button,
                        modal close buttons, and backdrop click-to-close.
                        All other events are wired dynamically on modal open.
================================================================ */
function initIncidentForm() {
  document.getElementById('btn-open-incident-form')
    .addEventListener('click', openIncidentForm);
  document.getElementById('modal-incident-close')
    .addEventListener('click', () => closeModal('modal-incident'));
  document.getElementById('modal-detail-close')
    .addEventListener('click', () => closeModal('modal-detail'));
  document.querySelectorAll('.modal-backdrop').forEach(b => {
    b.addEventListener('click', e => { if (e.target === b) closeModal(b.id); });
  });
}






