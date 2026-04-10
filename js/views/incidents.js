/* ================================================================
   js/views/incidents.js
   Incident list, new incident form, detail modal, outcome flow.
   Depends on: rpc.js, ui.js, state.js, location.js
================================================================ */

// Helper: programmatically set a Y/N field to a value
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


/* ----------------------------------------------------------------
   LABELS
---------------------------------------------------------------- */
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


// Resource types that show the clinical section
const CLINICAL_TYPES = ['ASM', 'ASI', 'MM'];

/* ----------------------------------------------------------------
   LOAD & RENDER INCIDENTS
---------------------------------------------------------------- */
async function loadIncidents() {
  STATE.incidents = await fetchIncidents();
  renderIncidents();

}

function renderIncidents() {
  const activeList  = document.getElementById('active-incidents-list');
  const closedList  = document.getElementById('closed-incidents-list');
  const emptyActive = document.getElementById('empty-active');
  const emptyClosed = document.getElementById('empty-closed');

  let incidents = STATE.incidents;

  // Apply team filter if coordinator has one selected
  if (STATE.activeTeamFilter) {
    incidents = incidents.filter(i =>
      (i.incident_responses || []).some(
        r => r.resource_id === STATE.activeTeamFilter
      )
    );
  }

  const active = incidents.filter(i => i._isActive);
  const closed = incidents.filter(i => !i._isActive);

  activeList.innerHTML = '';
  activeList.appendChild(emptyActive);
  emptyActive.style.display = active.length === 0 ? 'flex' : 'none';
  active.forEach(i => activeList.appendChild(buildIncidentCard(i)));

  closedList.innerHTML = '';
  closedList.appendChild(emptyClosed);
  emptyClosed.style.display = closed.length === 0 ? 'flex' : 'none';
  closed.forEach(i => closedList.appendChild(buildIncidentCard(i)));

  const badge = document.getElementById('incidents-badge');
  badge.textContent = active.length;
  badge.classList.toggle('visible', active.length > 0);
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
          Età: ${inc.patient_age || 'ignoto'} · Sesso: ${inc.patient_gender || 'ignoto'}
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
    if (myResponse?.outcome === 'en_route_to_incident')  return '🚨 In arrivo';
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
   OUTCOME PANEL — shared between new form and detail modal
================================================================ */
async function buildOutcomePanelHTML() {
  const allResources  = await fetchEventResources();
  const pmaResources  = allResources.filter(r => r.resource_type === 'PMA');
  const teamResources = allResources.filter(r => !['PMA','LDC'].includes(r.resource_type));

  const pmaOptions  = pmaResources.map(r =>
    `<option value="${r.id}">${r.resource}</option>`).join('');
  const teamOptions = teamResources.map(r =>
    `<option value="${r.id}">${r.resource} (${r.resource_type})</option>`).join('');
  const isClinical = CLINICAL_TYPES.includes(STATE.resource.resource_type);

  return `
  <div class="outcome-panel">
    <div class="outcome-opt" data-outcome-type="treated_and_released">
      <span>✔</span> Trattato e dimesso
    </div>

    <div class="outcome-opt" data-outcome-type="consegnato_squadra">
      <span>🤝</span> Consegnato ad altra squadra
    </div>
    <div class="outcome-detail" id="od-squadra" style="display:none;">
      <div class="outcome-detail-label">Quale squadra?</div>
      <select id="od-squadra-select">
        <option value="">— Seleziona —</option>${teamOptions}
      </select>
    </div>

    <div class="outcome-opt" data-outcome-type="trasportato_pma">
      <span>🏥</span> Trasportato al PMA
    </div>
    <div class="outcome-detail" id="od-pma" style="display:none;">
      <div class="outcome-detail-label">Quale PMA?</div>
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
    </div>
    ` : ''}

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

/* ================================================================
   EXECUTE OUTCOME — shared handler
================================================================ */
async function executeOutcome(responseId, outcomeData) {
  const { dbOutcome, toResourceId, dest_hospital, notes } = outcomeData;
console.log('executeOutcome:', responseId, outcomeData);

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
================================================================ */
function openIncidentForm() {
  resetIncidentForm();

  // Y/N buttons default to Sì
  ['conscious', 'respiration', 'circulation', 'walking', 'minor_injuries'].forEach(field => {
    STATE.formData[field] = true;
    const btn = document.querySelector(`.yn-btn.yn-yes[data-field="${field}"]`);
    if (btn) btn.classList.add('active');
  });

  // Age
  const age = document.getElementById('f-patient-age');
  if (age) age.value = '';

  // Clinical section visibility
  const clinical = document.getElementById('section-clinical');
  if (clinical) {
    clinical.style.display =
      CLINICAL_TYPES.includes(STATE.resource.resource_type) ? 'block' : 'none';
  }

  // Alert time default now
  const timeInput = document.getElementById('f-alert-time');
  if (timeInput) {
    const now   = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    timeInput.value = local;
  }
  openModal('modal-incident');

   // Auto-fetch location
  const locBtn = document.getElementById('btn-get-location');
  locBtn.textContent = '📍 Localizzazione...';
  getCurrentPosition()
    .then(pos => {
      STATE.formData.lat = pos.coords.latitude;
      STATE.formData.lng = pos.coords.longitude;
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      document.getElementById('location-coords').textContent = `${lat}, ${lng}`;
      document.getElementById('location-accuracy').textContent =
        `Accuratezza: ±${Math.round(pos.coords.accuracy)}m`;
      document.getElementById('location-display').style.display = 'flex';

      // Static map image
      const mapImg = document.getElementById('location-map-img');
      const mapContainer = document.getElementById('location-map-container');
      mapImg.src = `https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lng)-0.002},${parseFloat(lat)-0.002},${parseFloat(lng)+0.002},${parseFloat(lat)+0.002}&layer=mapnik&marker=${lat},${lng}`;
      mapContainer.style.display = 'block';

      locBtn.textContent = '📍 Aggiorna posizione';
      locBtn.classList.add('got');
    })
    .catch(() => {
      locBtn.textContent = '📍 Usa posizione attuale';
      showToast('GPS non disponibile — premi il pulsante per riprovare', 'error', 4000);
    });
}

function resetIncidentForm() {
  STATE.formData = {
    triage: null, conscious: null, respiration: null,
    circulation: null, walking: null, gender: null,
    status: 'in_progress', outcomeType: null, lat: null, lng: null,
  };
  document.querySelectorAll('.yn-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.triage-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  ['f-patient-name','f-patient-id','f-clinical-notes','f-description',
   'f-heart-rate','f-spo2','f-breathing-rate', 'f-blood-pressure', 'f-temperature'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const age = document.getElementById('f-patient-age');
  if (age) age.value = '';
 

  const incType = document.getElementById('f-incident-type');
  if (incType) incType.value = 'medical';
  document.getElementById('status-opt-active')?.classList.add('selected');
  document.getElementById('status-opt-resolved')?.classList.remove('selected');
  const panel = document.getElementById('form-outcome-panel');
  if (panel) panel.innerHTML = '';
  const locDisplay = document.getElementById('location-display');
  if (locDisplay) locDisplay.style.display = 'none';
  const locBtn = document.getElementById('btn-get-location');
  if (locBtn) { locBtn.classList.remove('got'); locBtn.textContent = '📍 Usa posizione attuale'; }
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
  if (!document.getElementById('f-description')?.value.trim()) {
    showToast('Inserisci una descrizione', 'error'); return;
  }
  if (STATE.formData.minor_injuries === null) {
    showToast('Indica se è un problema minore', 'error'); return;
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
      p_personnel_id:       STATE.personnel?.id || null,   // ← new
      p_incident_type:      CLINICAL_TYPES.includes(STATE.resource.resource_type)
                              ? document.getElementById('f-incident-type')?.value || 'other'
                              : 'other',
      p_lng:                lng,
      p_lat:                lat,
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
   INCIDENT DETAIL MODAL
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
  titleEl.textContent = STATUS_LABELS[inc.status] || inc.status;
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
      if (!pmaId) { showToast('Seleziona il PMA', 'error'); return; }
      const response = await findActiveResponse(incidentId);
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
  const teamResources   = allResources.filter(r => !['PMA','LDC'].includes(r.resource_type));
  const pmaOptionsHTML  = pmaResources.map(r =>
    `<option value="${r.id}">${r.resource}</option>`).join('');
  const teamOptionsHTML = teamResources.map(r =>
    `<option value="${r.id}">${r.resource} (${r.resource_type})</option>`).join('');

  const isClinical = CLINICAL_TYPES.includes(STATE.resource.resource_type);

    
  const buildAssessmentCard = (a) => `
    <div style="background:var(--bg-card);border:1.5px solid var(--border-bright);
      border-radius:var(--radius-lg);padding:12px;margin-bottom:10px;">
      <div class="assessment-header">
        <div style="display:flex;align-items:center;gap:8px;">
          ${a.triage ? `<div style="width:12px;height:12px;border-radius:50%;flex-shrink:0;background:${
            a.triage === 'red'    ? 'var(--triage-red)'    :
            a.triage === 'yellow' ? 'var(--triage-yellow)' :
            a.triage === 'green'  ? 'var(--triage-green)'  :
            '#8a9ab0'
          };"></div>` : ''}
          <span class="assessment-by">Valutazione</span>
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
          border-radius:var(--radius);border:1px solid var(--border);">
          ${a.description}
        </div>
      </div>` : ''}
      ${a.clinical_notes ? `
      <div style="margin-top:8px;">
        <div style="font-size:10px;letter-spacing:1.5px;color:var(--blue);
          text-transform:uppercase;font-weight:700;margin-bottom:4px;">🩺 Note cliniche</div>
        <div style="font-size:13px;color:var(--text-primary);line-height:1.5;
          padding:8px 10px;background:var(--bg-page);
          border-radius:var(--radius);border-left:3px solid var(--blue);">
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
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;">
        <div class="vital-box"><div class="vital-label">FC</div><div class="vital-value">${a.heart_rate ?? '—'}</div></div>
        <div class="vital-box"><div class="vital-label">SpO2</div><div class="vital-value">${a.spo2 != null ? a.spo2+'%' : '—'}</div></div>
        <div class="vital-box"><div class="vital-label">PA</div><div class="vital-value">${a.blood_pressure ?? '—'}</div></div>
        <div class="vital-box"><div class="vital-label">FR</div><div class="vital-value">${a.breathing_rate ?? '—'}</div></div>
        <div class="vital-box"><div class="vital-label">Temp</div><div class="vital-value">${a.temperature ?? '—'}</div></div>
      </div>
    </div>`;

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

  const isCoordinator = STATE.resource.resource_type === 'LDC';

  const myResponse = isCoordinator ? null : (inc.incident_responses || [])
    .find(r => r.resource_id === STATE.resource.id &&
      ['treating','en_route_to_pma','en_route_to_hospital'].includes(r.outcome));

  const canClose          = !isCoordinator && myResponse?.outcome === 'treating';
  const isEnRoutePma      = myResponse?.outcome === 'en_route_to_pma';
  const isEnRouteHospital = myResponse?.outcome === 'en_route_to_hospital';
  const isEnRoute         = isEnRoutePma || isEnRouteHospital;

  const canReopen = isCoordinator ? false
    : !myResponse && (inc.incident_responses || []).some(
        r => r.resource_id === STATE.resource.id
      );

  const outcomePanelHTML = canClose ? await buildOutcomePanelHTML() : '';

  return `
    <div style="background:var(--bg-card);border-radius:var(--radius);padding:12px;margin-bottom:8px;">
      <div style="font-size:16px;font-weight:bold;color:var(--text-primary);">
        ${inc.patient_name || 'Paziente ignoto'}
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;line-height:1.8;">
        Pettorale: ${inc.patient_identifier || '—'}<br>
        Età: ${inc.patient_age || '—'} · Sesso: ${inc.patient_gender || '—'}
      </div>
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

    ${canClose ? `
    <button id="btn-add-assessment" style="
      width:100%;padding:12px;border-radius:var(--radius);
      border:1px solid var(--blue);color:var(--blue);font-size:12px;
      letter-spacing:2px;text-transform:uppercase;background:var(--blue-dim);
      margin-bottom:12px;cursor:pointer;font-family:var(--font);">
      + Aggiungi Valutazione
    </button>` : ''}

       ${isEnRoute ? `
    <div style="padding:14px 16px;border-radius:var(--radius);margin-bottom:8px;
      background:${isEnRoutePma ? 'var(--blue-dim)' : 'var(--orange-dim)'};
      border:1.5px solid ${isEnRoutePma ? 'var(--blue)' : 'var(--orange)'};
      display:flex;align-items:center;gap:10px;">
      <span style="font-size:22px;">${isEnRoutePma ? '🏥' : '🚑'}</span>
      <div>
        <div style="font-size:14px;font-weight:bold;
          color:${isEnRoutePma ? '#1060cc' : '#8a4a00'};">
          ${isEnRoutePma ? 'In trasporto verso PMA' : 'In trasporto verso ospedale'}
        </div>
        ${isEnRouteHospital && myResponse.dest_hospital ? `
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
          ${myResponse.dest_hospital}
        </div>` : ''}
      </div>
    </div>
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
          <div class="outcome-detail-label">Quale PMA?</div>
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
          <div class="outcome-detail-label">Nome ospedale</div>
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
          <div class="outcome-detail-label">Quale squadra?</div>
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

function openAssessmentForm(incidentId, previous = null) {
  // Reset assessment form state
  STATE.assessmentData = {
    conscious: null, respiration: null,
    circulation: null, walking: null, triage: null
  };

  document.querySelectorAll('#modal-assessment .yn-btn')
    .forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#modal-assessment .triage-btn')
    .forEach(b => b.classList.remove('selected'));
  ['a-heart-rate','a-spo2','a-breathing-rate', 'a-blood-pressure','a-breathing-rate','a-description', 'a-clinical-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
   // ── Pre-fill from previous assessment if available, else defaults ──
  const src = previous || {
    conscious: true, respiration: true, circulation: true, walking: true, minor_injuries: true,
    triage: null, heart_rate: null, spo2: null, breathing_rate: null, blood_pressure: null, temperature: null, description: null, clinical_notes: null
  };

  // Y/N fields
  ['conscious', 'respiration', 'circulation', 'walking', 'minor_injuries'].forEach(field => {
    const value = src[field];
    if (value === null || value === undefined) return;
    STATE.assessmentData[field] = value;
    const btn = document.querySelector(
      `#modal-assessment .yn-btn[data-field="${field}"][data-value="${value}"]`
    );
      console.log('btn found:', btn);

    if (btn) btn.classList.add('active');
  });
  // Numeric fields
  if (src.heart_rate)    document.getElementById('a-heart-rate').value    = src.heart_rate;
  if (src.spo2)          document.getElementById('a-spo2').value          = src.spo2;
  if (src.gcs_total)     document.getElementById('a-gcs').value           = src.gcs_total;
  if (src.breathing_rate) document.getElementById('a-breathing-rate').value = src.breathing_rate;
  if (src.blood_pressure) document.getElementById('a-blood-pressure').value = src.blood_pressure;
  if (src.temperature)    document.getElementById('a-temperature').value   = src.temperature;

  // Triage
  if (src.triage) {
    STATE.assessmentData.triage = src.triage;
    const triageBtn = document.querySelector(
      `#modal-assessment .triage-btn[data-triage="${src.triage}"]`
    );
    if (triageBtn) triageBtn.classList.add('selected');
  }

  // Clinical section visibility
  const clinical = document.getElementById('a-section-clinical');
  if (clinical) {
    clinical.style.display =
      CLINICAL_TYPES.includes(STATE.resource.resource_type) ? 'block' : 'none';
  }

  const btn = document.getElementById('btn-submit-assessment');
  btn.onclick = () => submitAssessment(incidentId);
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
  if (STATE.assessmentData.walking === null) {
    showToast('Indica se cammina', 'error'); return;
  }
  if (STATE.assessmentData.minor_injuries === null) {
    showToast('Indica se è un problema minore', 'error'); return;
  }
  if (!document.getElementById('a-description')?.value.trim()) {
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

    const brSlider = document.getElementById('a-breathing-rate');
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
        minor_injuries:  STATE.assessmentData.minor_injuries,
        heart_rate:     parseInt(document.getElementById('a-heart-rate')?.value) || null,
        spo2:           parseInt(document.getElementById('a-spo2')?.value)        || null,
        breathing_rate: brValue,
        blood_pressure: document.getElementById('a-blood-pressure')?.value || null,
        temperature:    document.getElementById('a-temperature')?.value !== ''
          ? parseFloat(document.getElementById('a-temperature')?.value) : null,
        triage:         STATE.assessmentData.triage,
        description:          document.getElementById('a-description')?.value.trim()          || null,
        clinical_notes: document.getElementById('a-clinical-notes')?.value.trim() || null,
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
   WIRE UP ALL FORM EVENTS
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
  document.getElementById('btn-submit-incident')
    .addEventListener('click', submitIncident);
  document.getElementById('age-up')?.addEventListener('click', () => {
    const input = document.getElementById('f-patient-age');
    const current = input.value === '' ? 40 : parseInt(input.value);
    input.value   = Math.min(current + 10, 120);

  });

  document.getElementById('age-down')?.addEventListener('click', () => {
    const input = document.getElementById('f-patient-age');
    const current = input.value === '' ? 60 : parseInt(input.value);
    input.value   = Math.max(current - 10, 0);
  });

  // Y/N buttons — main incident form
  document.querySelectorAll('#modal-incident .yn-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const value = btn.dataset.value === 'true';
      if (btn.classList.contains('active')) {
        STATE.formData[field] = null;
        btn.classList.remove('active');
      } else {
        STATE.formData[field] = value;
        btn.closest('.yn-buttons').querySelectorAll('.yn-btn')
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      if (field === 'respiration') {
        setYNField('walking', STATE.formData.respiration !== false);
        setYNField('minor_injuries', STATE.formData.minor_injuries !== false);
      }
      if (field === 'conscious') {
        setYNField('walking',        STATE.formData.conscious !== false);
        if (STATE.formData.conscious === false) setYNField('minor_injuries', false);
      }
      if (field === 'circulation') {
        setYNField('walking',          STATE.formData.circulation !== false);
        if (STATE.formData.circulation === false) setYNField('minor_injuries', false);
      }
    });
  });

  // Y/N buttons — assessment modal
  document.querySelectorAll('#modal-assessment .yn-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const field      = btn.dataset.field;
      const value      = btn.dataset.value === 'true';
      const stateField = field.replace('a_', '');
      if (btn.classList.contains('active')) {
        STATE.assessmentData[stateField] = null;
        btn.classList.remove('active');
      } else {
        STATE.assessmentData[stateField] = value;
        btn.closest('.yn-buttons').querySelectorAll('.yn-btn')
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }

      // Side effects — same rules as main form
      if (stateField === 'respiration') {
        setAssessmentYN('walking', STATE.assessmentData.respiration !== false);
        if (STATE.assessmentData.respiration === false)
          setAssessmentYN('minor_injuries', false);
      }
      if (stateField === 'conscious'){
        setAssessmentYN('walking', STATE.assessmentData.conscious   !== false);
        if (STATE.assessmentData.conscious === false)
        setAssessmentYN('minor_injuries', false);
      }
      if (stateField === 'circulation'){
        setAssessmentYN('walking', STATE.assessmentData.circulation !== false);
        if (STATE.assessmentData.circulation === false)
        setAssessmentYN('minor_injuries', false);
      }
    });
  });

  // Triage — main form
  document.querySelectorAll('#modal-incident .triage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modal-incident .triage-btn')
        .forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      STATE.formData.triage = btn.dataset.triage;
    });
  });

  // Triage — assessment modal
  document.querySelectorAll('#modal-assessment .triage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modal-assessment .triage-btn')
        .forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      STATE.assessmentData.triage = btn.dataset.triage;
    });
  });

  // Gender
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.formData.gender = btn.dataset.value;
    });
  });

  // Status
  document.getElementById('status-opt-active')
    ?.addEventListener('click', () => selectFormStatus('in_progress'));
  document.getElementById('status-opt-resolved')
    ?.addEventListener('click', () => selectFormStatus('resolved'));

  // Location
  document.getElementById('btn-get-location')
    ?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-get-location');
      btn.textContent = '📍 Localizzazione...';
      try {
        const pos = await getCurrentPosition();
        STATE.formData.lat = pos.coords.latitude;
        STATE.formData.lng = pos.coords.longitude;
        const lat = pos.coords.latitude.toFixed(5);
        const lng = pos.coords.longitude.toFixed(5);
        document.getElementById('location-coords').textContent = `${lat}, ${lng}`;
        document.getElementById('location-accuracy').textContent =
          `Accuratezza: ±${Math.round(pos.coords.accuracy)}m`;
        document.getElementById('location-display').style.display = 'flex';
        btn.textContent = '📍 Aggiorna posizione';
        btn.classList.add('got');
        // Static map
        document.getElementById('location-map-img').src =
          `https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lng)-0.002},${parseFloat(lat)-0.002},${parseFloat(lng)+0.002},${parseFloat(lat)+0.002}&layer=mapnik&marker=${lat},${lng}`;
        document.getElementById('location-map-container').style.display = 'block';
      } catch (_) {
        btn.textContent = '📍 Usa posizione attuale';
        showToast('Impossibile ottenere la posizione', 'error');
      }
    });
}

async function selectFormStatus(status) {
  STATE.formData.status     = status;
  STATE.formData.outcomeType = null;
  document.getElementById('status-opt-active')
    ?.classList.toggle('selected', status === 'in_progress');
  document.getElementById('status-opt-resolved')
    ?.classList.toggle('selected', status === 'resolved');
  const panel = document.getElementById('form-outcome-panel');
  if (!panel) return;
  if (status === 'resolved') {
    panel.innerHTML = '<div style="padding:8px;font-size:11px;color:var(--text-secondary);">Caricamento...</div>';
    panel.innerHTML = await buildOutcomePanelHTML();
    initOutcomePanel(panel);
  } else {
    panel.innerHTML = '';
  }
}