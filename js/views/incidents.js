/* ================================================================
   js/views/incidents.js
   Incident list rendering, new incident form, detail modal,
   outcome update controls.
   Depends on: rpc.js, ui.js, state.js, location.js
================================================================ */

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
  resolved:          'Risolto',
  taken_to_hospital: 'Trasportato',
  cancelled:         'Annullato',
};

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

  const active = STATE.incidents.filter(i => ['open','in_progress'].includes(i.status));
  const closed = STATE.incidents.filter(i => !['open','in_progress'].includes(i.status));

  // Active incidents
  activeList.innerHTML = '';
  activeList.appendChild(emptyActive);
  emptyActive.style.display = active.length === 0 ? 'flex' : 'none';
  active.forEach(i => activeList.appendChild(buildIncidentCard(i)));

  // Closed incidents
  closedList.innerHTML = '';
  closedList.appendChild(emptyClosed);
  emptyClosed.style.display = closed.length === 0 ? 'flex' : 'none';
  closed.forEach(i => closedList.appendChild(buildIncidentCard(i)));

  // Incidents tab badge
  const badge = document.getElementById('incidents-badge');
  badge.textContent = active.length;
  badge.classList.toggle('visible', active.length > 0);
}

function buildIncidentCard(inc) {
  const card = document.createElement('div');
  card.className = 'incident-card-mobile';
  card.dataset.id = inc.id;

  const triage    = inc.current_triage || 'none';
  const typeLabel = INCIDENT_TYPE_LABELS[inc.incident_type] || inc.incident_type;
  const patient   = inc.patient_name || inc.patient_identifier || 'Paziente sconosciuto';
  const time      = new Date(inc.created_at)
    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  card.innerHTML = `
    <div class="incident-card-top">
      <div class="triage-bar ${triage}"></div>
      <div class="incident-card-body">
        <div class="incident-type-label">${typeLabel}</div>
        <div class="incident-patient">${patient}</div>
        <div class="incident-meta-row">
          ${inc.patient_age    ? `<span class="incident-chip">${inc.patient_age}a</span>` : ''}
          ${inc.patient_gender ? `<span class="incident-chip">${inc.patient_gender}</span>` : ''}
          <span class="incident-chip">${triage.toUpperCase()}</span>
        </div>
      </div>
      <span class="incident-status-badge ${inc.status}">
        ${STATUS_LABELS[inc.status] || inc.status}
      </span>
    </div>
    <div class="incident-card-footer">
      <span class="incident-footer-resource">${STATE.resource.resource}</span>
      <span class="incident-footer-time">${time}</span>
    </div>
  `;

  card.addEventListener('click', () => openIncidentDetail(inc.id));
  return card;
}

/* ----------------------------------------------------------------
   INCIDENT FORM — NEW INCIDENT
---------------------------------------------------------------- */
function openIncidentForm() {
  resetIncidentForm();
  openModal('modal-incident');
}

function resetIncidentForm() {
  STATE.formData = {
    triage: null, conscious: null, respiration: null,
    circulation: null, walking: null,
    status: 'in_progress', outcome: null, transport: null,
  };

  document.querySelectorAll('.triage-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.toggle-btn').forEach(b => {
    b.className = 'toggle-btn';
    const labels = { conscious:'Cosciente', respiration:'Respira', circulation:'Circolo', walking:'Cammina' };
    b.textContent = labels[b.dataset.field] || b.dataset.field;
  });
  document.getElementById('status-opt-active').classList.add('selected');
  document.getElementById('status-opt-resolved').classList.remove('selected');
  document.getElementById('outcome-sub').classList.remove('visible');
  document.getElementById('transport-dest').classList.remove('visible');
  document.querySelectorAll('.outcome-option').forEach(b => b.classList.remove('selected'));

  ['f-patient-name','f-patient-id','f-heart-rate','f-spo2',
   'f-breathing-rate','f-clinical-notes','f-situation-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('f-patient-age').value    = '';
  document.getElementById('f-patient-gender').value  = '';
  document.getElementById('f-incident-type').value   = 'medical';
  document.getElementById('f-hospital-name').style.display = 'none';
  document.getElementById('f-hospital-name').value  = '';
}

async function submitIncident() {
  const btn = document.getElementById('btn-submit-incident');

  if (!STATE.formData.triage) {
    showToast('Seleziona il triage', 'error');
    return;
  }
  if (STATE.formData.status === 'resolved' && !STATE.formData.outcome) {
    showToast("Seleziona l'esito dell'intervento", 'error');
    return;
  }

  btn.disabled  = true;
  btn.textContent = 'Registrazione...';

  try {
    // Get GPS position (fallback to event center if unavailable)
    let lng = STATE.event?.center_lng;
    let lat = STATE.event?.center_lat;
    try {
      const pos = await getCurrentPosition();
      lng = pos.coords.longitude;
      lat = pos.coords.latitude;
    } catch (_) { /* use fallback */ }

    const initialOutcome = STATE.formData.status === 'resolved'
      ? STATE.formData.outcome
      : null;

    const params = {
      p_event_id:           STATE.resource.event_id,
      p_resource_id:        STATE.resource.id,
      p_incident_type:      document.getElementById('f-incident-type').value,
      p_lng:                lng,
      p_lat:                lat,
      p_patient_name:       document.getElementById('f-patient-name').value       || null,
      p_patient_age:        parseInt(document.getElementById('f-patient-age').value) || null,
      p_patient_gender:     document.getElementById('f-patient-gender').value      || null,
      p_patient_identifier: document.getElementById('f-patient-id').value          || null,
      p_situation_notes:    document.getElementById('f-situation-notes').value     || null,
      p_initial_outcome:    initialOutcome,
      p_conscious:          STATE.formData.conscious,
      p_respiration:        STATE.formData.respiration,
      p_circulation:        STATE.formData.circulation,
      p_heart_rate:         parseInt(document.getElementById('f-heart-rate').value)    || null,
      p_spo2:               parseInt(document.getElementById('f-spo2').value)          || null,
      p_triage:             STATE.formData.triage,
      p_clinical_notes:     document.getElementById('f-clinical-notes').value      || null,
    };

    const result = await createIncident(params);

    if (result.offline) {
      showToast('Salvato offline — verrà inviato appena possibile', 'offline', 5000);
    } else {
      showToast('Intervento registrato ✓', 'success');
      await loadIncidents();
    }

    closeModal('modal-incident');

  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled  = false;
    btn.textContent = 'Registra Intervento';
  }
}

/* ----------------------------------------------------------------
   INCIDENT DETAIL MODAL
---------------------------------------------------------------- */
async function openIncidentDetail(incidentId) {
  const body = document.getElementById('detail-body');
  body.innerHTML = '<div class="empty-state"><div class="skeleton" style="height:120px;width:100%;"></div></div>';
  openModal('modal-detail');

  const inc = await fetchIncidentDetail(incidentId);
  if (!inc) {
    body.innerHTML = '<div class="empty-state"><div class="empty-text">Errore nel caricamento</div></div>';
    return;
  }

  document.getElementById('detail-title').textContent =
    `${INCIDENT_TYPE_LABELS[inc.incident_type] || inc.incident_type} — ${STATUS_LABELS[inc.status] || inc.status}`;

  body.innerHTML = buildDetailHTML(inc);

  document.getElementById('btn-add-assessment')
    ?.addEventListener('click', () => {
      // TODO: open assessment sub-form
      showToast('Form valutazione in arrivo', 'success');
    });

  document.querySelectorAll('.btn-outcome').forEach(btn => {
    btn.addEventListener('click', () => handleOutcomeUpdate(incidentId, btn.dataset.outcome));
  });
}

function buildDetailHTML(inc) {
  const assessments = (inc.patient_assessments || [])
    .sort((a, b) => new Date(a.assessed_at) - new Date(b.assessed_at));

  const assessmentHTML = assessments.length === 0
    ? '<div class="empty-state"><div class="empty-text">Nessuna valutazione</div></div>'
    : assessments.map(a => `
      <div class="assessment-entry">
        <div class="assessment-header">
          <span class="assessment-by">Valutazione</span>
          <span class="assessment-time">
            ${new Date(a.assessed_at).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' })}
          </span>
        </div>
        <div class="vitals-grid">
          <div class="vital-box"><div class="vital-label">FC</div><div class="vital-value">${a.heart_rate ?? '—'}</div></div>
          <div class="vital-box"><div class="vital-label">SpO2</div><div class="vital-value">${a.spo2 != null ? a.spo2 + '%' : '—'}</div></div>
          <div class="vital-box"><div class="vital-label">GCS</div><div class="vital-value">${a.GCS_total ?? '—'}</div></div>
          <div class="vital-box"><div class="vital-label">Cosciente</div><div class="vital-value">${a.conscious === true ? '✓' : a.conscious === false ? '✕' : '—'}</div></div>
          <div class="vital-box"><div class="vital-label">Respira</div><div class="vital-value">${a.respiration === true ? '✓' : a.respiration === false ? '✕' : '—'}</div></div>
          <div class="vital-box"><div class="vital-label">Circolo</div><div class="vital-value">${a.circulation === true ? '✓' : a.circulation === false ? '✕' : '—'}</div></div>
        </div>
        ${a.notes ? `<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-top:6px;">${a.notes}</div>` : ''}
      </div>`
    ).join('');

  const canClose = ['open','in_progress'].includes(inc.status);

  return `
    <div>
      <div class="form-section-title">Paziente</div>
      <div style="background:var(--bg-card);border-radius:var(--radius);padding:12px;">
        <div style="font-size:16px;font-weight:bold;color:var(--text-white);">
          ${inc.patient_name || inc.patient_identifier || 'Sconosciuto'}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
          ${inc.patient_age    ? inc.patient_age + ' anni' : ''}
          ${inc.patient_gender || ''}
          ${inc.patient_identifier ? '· ' + inc.patient_identifier : ''}
        </div>
      </div>
    </div>

    <div>
      <div class="form-section-title">Storico valutazioni</div>
      ${assessmentHTML}
    </div>

    <button id="btn-add-assessment" style="
      width:100%;padding:12px;border-radius:var(--radius);
      border:1px solid var(--blue);color:var(--blue);font-size:12px;
      letter-spacing:2px;text-transform:uppercase;background:var(--blue-dim);">
      + Aggiungi Valutazione
    </button>

    ${canClose ? `
    <div>
      <div class="form-section-title">Chiudi intervento</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn-outcome" data-outcome="treated_and_released" style="
          padding:12px;border-radius:var(--radius);border:1px solid var(--green);
          color:var(--green);background:var(--green-dim);font-size:12px;letter-spacing:1px;">
          ✔ Trattato e dimesso
        </button>
        <button class="btn-outcome" data-outcome="transported" style="
          padding:12px;border-radius:var(--radius);border:1px solid var(--orange);
          color:var(--orange);background:var(--orange-dim);font-size:12px;letter-spacing:1px;">
          🚑 Trasportato
        </button>
        <button class="btn-outcome" data-outcome="cancelled" style="
          padding:12px;border-radius:var(--radius);border:1px solid var(--text-muted);
          color:var(--text-secondary);background:var(--bg-card);font-size:12px;letter-spacing:1px;">
          ✕ Annulla
        </button>
      </div>
    </div>` : ''}
  `;
}

async function handleOutcomeUpdate(incidentId, outcome) {
  const response = await findActiveResponse(incidentId);
  if (!response) {
    showToast('Nessuna risposta attiva trovata', 'error');
    return;
  }

  try {
    await updateResponseOutcome(response.id, outcome);
    closeModal('modal-detail');
    showToast('Intervento aggiornato', 'success');
    await loadIncidents();
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  }
}

/* ----------------------------------------------------------------
   WIRE UP FORM EVENTS
   Called once after DOM is ready.
---------------------------------------------------------------- */
function initIncidentForm() {
  document.getElementById('btn-open-incident-form')
    .addEventListener('click', openIncidentForm);

  document.getElementById('modal-incident-close')
    .addEventListener('click', () => closeModal('modal-incident'));

  document.getElementById('modal-detail-close')
    .addEventListener('click', () => closeModal('modal-detail'));

  // Close modal on backdrop tap
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  document.getElementById('btn-submit-incident')
    .addEventListener('click', submitIncident);

  // Triage buttons
  document.querySelectorAll('.triage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.triage-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      STATE.formData.triage = btn.dataset.triage;
    });
  });

  // Condition toggle buttons (cycle: null → true → false → null)
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const field   = btn.dataset.field;
      const current = STATE.formData[field];
      const next    = current === null ? true : current === true ? false : null;
      STATE.formData[field] = next;

      const labels = { conscious:'Cosciente', respiration:'Respira', circulation:'Circolo', walking:'Cammina' };
      btn.className  = 'toggle-btn' + (next === true ? ' on' : next === false ? ' off' : '');
      btn.textContent = labels[field] + (next === true ? ' ✓' : next === false ? ' ✕' : '');
    });
  });

  // Status selector
  document.getElementById('status-opt-active')
    .addEventListener('click', () => selectFormStatus('in_progress'));
  document.getElementById('status-opt-resolved')
    .addEventListener('click', () => selectFormStatus('resolved'));

  // Outcome options
  document.querySelectorAll('.outcome-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.outcome-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      STATE.formData.outcome = btn.dataset.outcome;
      document.getElementById('transport-dest')
        .classList.toggle('visible', btn.dataset.outcome === 'transported');
    });
  });

  // Transport destination
  document.getElementById('f-transport-dest')
    .addEventListener('change', function () {
      const hospitalInput = document.getElementById('f-hospital-name');
      hospitalInput.style.display = this.value === '__hospital__' ? 'block' : 'none';
      STATE.formData.transport = this.value;
    });
}

function selectFormStatus(status) {
  STATE.formData.status = status;
  document.getElementById('status-opt-active')
    .classList.toggle('selected', status === 'in_progress');
  document.getElementById('status-opt-resolved')
    .classList.toggle('selected', status === 'resolved');
  document.getElementById('outcome-sub')
    .classList.toggle('visible', status === 'resolved');
  if (status === 'in_progress') {
    STATE.formData.outcome = null;
    document.getElementById('transport-dest').classList.remove('visible');
    document.querySelectorAll('.outcome-option').forEach(b => b.classList.remove('selected'));
  }
}