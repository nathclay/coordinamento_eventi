/* ================================================================
   js/views/pma.js
   PMA dashboard — incoming, active, closed patients
   Depends on: rpc.js, ui.js, state.js, auth.js
================================================================ */

const PMA_CLINICAL_TYPES = ['ASM', 'ASI', 'MM', 'PMA'];

/* ----------------------------------------------------------------
   BOOT — called from auth.js after login
---------------------------------------------------------------- */
async function loadPMAView() {
    showScreen('screen-main');
  document.getElementById('header-resource-name').textContent =
    STATE.resource.resource;
  document.getElementById('header-user-name').textContent =
    STATE.personnel
      ? `${STATE.personnel.name} ${STATE.personnel.surname}`
      : STATE.resource.resource;

  // Wire logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await db.auth.signOut();
    sessionStorage.clear();
    location.reload();
  });

  // Wire new patient
  document.getElementById('btn-new-patient')
    .addEventListener('click', () => {
        openNewPatientForm();}
);

  // Wire close modals on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(b => {
    b.addEventListener('click', e => { if (e.target === b) closeModal(b.id); });
  });

  // Wire close patient modal
  document.getElementById('modal-close-patient-close')
    .addEventListener('click', () => closeModal('modal-close-patient'));
  document.getElementById('modal-assessment-close')
    .addEventListener('click', () => closeModal('modal-assessment'));
  document.getElementById('modal-new-patient-close')
    .addEventListener('click', () => closeModal('modal-new-patient'));

  // Wire close patient outcome options
  document.getElementById('close-opt-dimesso')
    .addEventListener('click', () => selectCloseOutcome('dimesso'));
  document.getElementById('close-opt-ospedale')
    .addEventListener('click', () => selectCloseOutcome('ospedale'));

  await refreshPMA();

  // Auto-refresh every 30 seconds
  setInterval(refreshPMA, 30000);
}

/* ----------------------------------------------------------------
   MAIN DATA LOAD
---------------------------------------------------------------- */
async function refreshPMA() {
  const [incoming, active, closed] = await Promise.all([
    fetchPMAIncoming(),
    fetchPMAActive(),
    fetchPMAClosed(),
  ]);

  renderIncoming(incoming);
  renderActive(active);
  renderClosed(closed);
  updateStats(incoming.length, active.length, closed.length);
}

/* ----------------------------------------------------------------
   FETCH FUNCTIONS
---------------------------------------------------------------- */
async function fetchPMAIncoming() {
  // Incidents where a field team is en_route_to_pma to THIS PMA
  const { data, error } = await db
    .from('incident_responses')
    .select(`
      id, outcome, dest_pma_id, assigned_at,
      incidents(
        id, patient_name, patient_identifier, patient_age, patient_gender,
        current_triage, description,
        patient_assessments(
          id, assessed_at, conscious, respiration, circulation,
          walking, minor_injuries, heart_rate, spo2, breathing_rate,
          blood_pressure, temperature, gcs_total, hgt, triage
        )
      ),
      resources!incident_responses_resource_id_fkey(resource, resource_type)
    `)
    .eq('outcome', 'en_route_to_pma')
    .eq('dest_pma_id', STATE.resource.id);

  if (error) { console.error('fetchPMAIncoming:', error); return []; }
  return data || [];
}

async function fetchPMAActive() {
  // Incidents where THIS PMA resource is treating
  const { data, error } = await db
    .from('incident_responses')
    .select(`
      id, outcome, assigned_at,
      incidents(
        id, patient_name, patient_identifier, patient_age, patient_gender,
        current_triage, description,
        patient_assessments(
          id, assessed_at, conscious, respiration, circulation,
          walking, minor_injuries, heart_rate, spo2, breathing_rate,
          blood_pressure, temperature, gcs_total, hgt, triage
        )
      )
    `)
    .eq('resource_id', STATE.resource.id)
    .eq('outcome', 'treating');

  if (error) { console.error('fetchPMAActive:', error); return []; }
  return data || [];
}

async function fetchPMAClosed() {
  // Incidents closed by THIS PMA resource today
  const { data, error } = await db
    .from('incident_responses')
    .select(`
      id, outcome, released_at, dest_hospital,
      incidents(
        id, patient_name, patient_identifier, patient_age, patient_gender,
        current_triage,
        patient_assessments(
          id, assessed_at, conscious, respiration, circulation,
          walking, minor_injuries, heart_rate, spo2, breathing_rate,
          blood_pressure, temperature, gcs_total, hgt, triage
        )
      )
    `)
    .eq('resource_id', STATE.resource.id)
    .in('outcome', ['treated_and_released', 'handed_off'])
    .order('released_at', { ascending: false });

  if (error) { console.error('fetchPMAClosed:', error); return []; }
  return data || [];
}

/* ----------------------------------------------------------------
   RENDER FUNCTIONS
---------------------------------------------------------------- */
function getLatestAssessment(patientAssessments) {
  if (!patientAssessments || patientAssessments.length === 0) return null;
  return [...patientAssessments]
    .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at))[0];
}

function ynCell(value) {
  if (value === true)  return '<span class="yn-cell yes">Sì</span>';
  if (value === false) return '<span class="yn-cell no">No</span>';
  return '<span class="yn-cell unknown">—</span>';
}

function triageCell(triage) {
  if (!triage) return '—';
  return `<span class="triage-dot ${triage}"></span>`;
}

function buildVitalsCells(a) {
  if (!a) return `
    <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
    <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
    <td>—</td><td>—</td>`;
  return `
    <td>${ynCell(a.conscious)}</td>
    <td>${ynCell(a.respiration)}</td>
    <td>${ynCell(a.circulation)}</td>
    <td>${ynCell(a.walking)}</td>
    <td>${ynCell(a.minor_injuries)}</td>
    <td>${a.heart_rate ?? '—'}</td>
    <td>${a.breathing_rate ?? '—'}</td>
    <td>${a.spo2 != null ? a.spo2 + '%' : '—'}</td>
    <td>${a.blood_pressure ?? '—'}</td>
    <td>${a.temperature ?? '—'}</td>
    <td>${a.gcs_total ?? '—'}</td>
    <td>${a.hgt ?? '—'}</td>`;
}

function renderIncoming(rows) {
  const tbody = document.getElementById('tbody-incoming');
  document.getElementById('count-incoming').textContent = rows.length;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="17">Nessun paziente in arrivo</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const inc  = row.incidents;
    const a    = getLatestAssessment(inc.patient_assessments);
    const time = new Date(row.assigned_at)
      .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const team = row.resources?.resource || '—';
    const name = inc.patient_name || inc.patient_identifier || 'Ignoto';

    return `<tr>
      <td>${time}</td>
      <td><strong>${name}</strong><br>
        <span style="font-size:11px;color:var(--text-secondary);">
          ${inc.patient_age ? inc.patient_age + 'a' : ''} ${inc.patient_gender || ''}
        </span>
      </td>
      <td>${team}</td>
      <td>${triageCell(inc.current_triage)}</td>
      ${buildVitalsCells(a)}
      <td>
        <button class="btn-table-action receive"
          onclick="receivePMAPatient('${row.id}', '${inc.id}')">
          Ricevi
        </button>
      </td>
    </tr>`;
  }).join('');
}

function renderActive(rows) {
  const tbody = document.getElementById('tbody-active');
  document.getElementById('count-active').textContent = rows.length;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="17">Nessun paziente in trattamento</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const inc  = row.incidents;
    const a    = getLatestAssessment(inc.patient_assessments);
    const time = a
      ? new Date(a.assessed_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : new Date(row.assigned_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const name = inc.patient_name || inc.patient_identifier || 'Ignoto';

    return `<tr>
      <td>${time}</td>
      <td><strong>${name}</strong><br>
        <span style="font-size:11px;color:var(--text-secondary);">
          ${inc.patient_age ? inc.patient_age + 'a' : ''} ${inc.patient_gender || ''}
        </span>
      </td>
      <td>${triageCell(inc.current_triage)}</td>
      ${buildVitalsCells(a)}
      <td>
        <button class="btn-table-action assess"
          onclick="openPMAAssessment('${row.id}', '${inc.id}')">
          ✎ Valuta
        </button>
      </td>
      <td>
        <button class="btn-table-action close"
          onclick="openClosePatient('${row.id}', '${inc.id}')">
          ✓ Chiudi
        </button>
      </td>
    </tr>`;
  }).join('');
}

function renderClosed(rows) {
  const tbody = document.getElementById('tbody-closed');
  document.getElementById('count-closed').textContent = rows.length;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="16">Nessun paziente chiuso oggi</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const inc  = row.incidents;
    const a    = getLatestAssessment(inc.patient_assessments);
    const time = row.released_at
      ? new Date(row.released_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : '—';
    const name    = inc.patient_name || inc.patient_identifier || 'Ignoto';
    const outcome = row.outcome === 'taken_to_hospital'
      ? `<span class="outcome-badge ospedale">🚑 ${row.dest_hospital || 'Ospedale'}</span>`
      : `<span class="outcome-badge dimesso">✔ Dimesso</span>`;

    return `<tr>
      <td>${time}</td>
      <td><strong>${name}</strong><br>
        <span style="font-size:11px;color:var(--text-secondary);">
          ${inc.patient_age ? inc.patient_age + 'a' : ''} ${inc.patient_gender || ''}
        </span>
      </td>
      <td>${triageCell(inc.current_triage)}</td>
      ${buildVitalsCells(a)}
      <td>${outcome}</td>
    </tr>`;
  }).join('');
}

function updateStats(incoming, active, closed) {
  document.getElementById('stat-incoming').textContent = incoming;
  document.getElementById('stat-active').textContent   = active;
  document.getElementById('stat-closed').textContent   = closed;
}

/* ----------------------------------------------------------------
   RECEIVE PATIENT (incoming → active)
---------------------------------------------------------------- */
async function receivePMAPatient(fromResponseId, incidentId) {
  const { error } = await db.rpc('handoff_incident', {
    p_from_response_id: fromResponseId,
    p_to_resource_id:   STATE.resource.id,
    p_to_personnel_id:  STATE.personnel?.id || null,
    p_outcome:          'taken_to_pma',
    p_notes:            null,
    p_hospital_info:    null,
  });

  if (error) { showToast('Errore: ' + error.message, 'error'); return; }
  showToast('Paziente ricevuto ✓', 'success');
  await refreshPMA();
}

/* ----------------------------------------------------------------
   ASSESSMENT MODAL
---------------------------------------------------------------- */
async function openPMAAssessment(responseId, incidentId) {
  const { data: inc } = await db
    .from('incidents')
    .select(`
      *,
      patient_assessments(
        id, assessed_at, conscious, respiration, circulation,
        walking, minor_injuries, heart_rate, spo2, breathing_rate,
        blood_pressure, temperature, gcs_total, hgt, triage,
        description, clinical_notes
      )
    `)
    .eq('id', incidentId)
    .single();

  if (!inc) { showToast('Errore nel caricamento', 'error'); return; }

  const assessments = (inc.patient_assessments || [])
    .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at));

  const latest = assessments[0] || null;

  document.getElementById('assessment-modal-title').textContent =
    inc.patient_name || inc.patient_identifier || 'Paziente ignoto';

  const body = document.getElementById('assessment-modal-body');
  body.innerHTML = buildPMAAssessmentForm(latest, assessments);

  // Wire submit
  document.getElementById('btn-submit-pma-assessment').onclick =
    () => submitPMAAssessment(responseId, incidentId);

  openModal('modal-assessment');
}

function buildPMAAssessmentForm(previous, history) {
  const yn = v => v === true ? 'Sì' : v === false ? 'No' : '—';

  const historyHTML = history.length === 0 ? '' : `
    <div style="margin-bottom:16px;">
      <div style="font-size:10px;letter-spacing:2px;color:var(--text-secondary);
        text-transform:uppercase;font-weight:700;margin-bottom:8px;">
        Storico valutazioni
      </div>
      <div style="overflow-x:auto;">
        <table class="pma-table" style="font-size:12px;">
          <thead>
            <tr>
              <th>Ora</th><th>Descr.</th><th>Cosc.</th><th>Resp.</th>
              <th>Circ.</th><th>Camm.</th><th>Min.</th>
              <th>FC</th><th>FR</th><th>SpO2</th><th>PA</th><th>Temp</th><th>GCS</th><th>HGT</th>
            </tr>
          </thead>
          <tbody>
            ${history.map(a => `<tr>
              <td>${new Date(a.assessed_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</td>
              <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;">${a.description || '—'}</td>
              <td>${yn(a.conscious)}</td><td>${yn(a.respiration)}</td>
              <td>${yn(a.circulation)}</td><td>${yn(a.walking)}</td><td>${yn(a.minor_injuries)}</td>
              <td>${a.heart_rate ?? '—'}</td><td>${a.breathing_rate ?? '—'}</td>
              <td>${a.spo2 != null ? a.spo2+'%' : '—'}</td>
              <td>${a.blood_pressure ?? '—'}</td><td>${a.temperature ?? '—'}</td>
              <td>${a.gcs_total ?? '—'}</td><td>${a.hgt ?? '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const def = previous || {
    conscious: true, respiration: true, circulation: true,
    walking: true, minor_injuries: true,
    heart_rate: null, breathing_rate: null, spo2: null,
    blood_pressure: null, temperature: null, gcs_total: null, hgt: null,
    triage: null
  };

  const ynButtons = (field, label, required = false) => `
    <div class="input-group">
      <label>${label}${required ? '<span class="required">*</span>' : ''}</label>
      <div style="display:flex;gap:8px;margin-top:4px;">
        <button type="button" class="pma-yn-btn pma-yn-no ${def[field] === false ? 'active-no' : ''}"
          data-field="${field}" data-value="false"
          onclick="setPMAYN(this, '${field}', false)">No</button>
        <button type="button" class="pma-yn-btn pma-yn-yes ${def[field] === true ? 'active-yes' : ''}"
          data-field="${field}" data-value="true"
          onclick="setPMAYN(this, '${field}', true)">Sì</button>
      </div>
    </div>`;

  return `
    ${historyHTML}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      ${ynButtons('conscious', 'Coscienza', true)}
      ${ynButtons('respiration', 'Respirazione', true)}
      ${ynButtons('circulation', 'Circolo', true)}
      ${ynButtons('walking', 'Cammina', true)}
      ${ynButtons('minor_injuries', 'Prob. Minore', true)}
      <div class="input-group">
        <label>Triage</label>
        <div style="display:flex;gap:6px;margin-top:4px;">
          ${['white','green','yellow','red'].map(t => `
            <button type="button"
              class="pma-triage-btn ${t} ${def.triage === t ? 'selected' : ''}"
              onclick="setPMATriage('${t}')"
              data-triage="${t}">
              ${t === 'white' ? '⚪' : t === 'green' ? '🟢' : t === 'yellow' ? '🟡' : '🔴'}
            </button>`).join('')}
        </div>
      </div>
    </div>

    <div class="input-group" style="margin-bottom:12px;">
      <label>Descrizione <span class="required">*</span></label>
      <textarea id="pma-description" rows="2"
        placeholder="Aggiornamento situazione..."
        style="width:100%;padding:10px;border-radius:var(--radius);
        border:1.5px solid var(--border-bright);background:var(--bg-input);
        font-family:var(--font);font-size:14px;color:var(--text-primary);"
        ></textarea>
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px;">
      <div class="input-group">
        <label>FC</label>
        <input type="number" id="pma-heart-rate" placeholder="—"
          value="${def.heart_rate || ''}" min="0" max="300" />
      </div>
      <div class="input-group">
        <label>FR</label>
        <input type="number" id="pma-breathing-rate" placeholder="—"
          value="${def.breathing_rate || ''}" min="0" max="60" />
      </div>
      <div class="input-group">
        <label>SpO2 (%)</label>
        <input type="number" id="pma-spo2" placeholder="—"
          value="${def.spo2 || ''}" min="0" max="100" />
      </div>
      <div class="input-group">
        <label>PA</label>
        <input type="text" id="pma-blood-pressure" placeholder="—"
          value="${def.blood_pressure || ''}" />
      </div>
      <div class="input-group">
        <label>Temp (°C)</label>
        <input type="number" id="pma-temperature" placeholder="—"
          value="${def.temperature || ''}" step="0.1" />
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      <div class="input-group">
        <label>GCS</label>
        <input type="number" id="pma-gcs" placeholder="—"
          value="${def.gcs_total || ''}" min="3" max="15" />
      </div>
      <div class="input-group">
        <label>HGT</label>
        <input type="text" id="pma-hgt" placeholder="—"
          value="${def.hgt || ''}" />
      </div>
    </div>

    <div class="input-group" style="margin-bottom:16px;">
      <label>Note cliniche</label>
      <textarea id="pma-clinical-notes" rows="2" placeholder="Osservazioni cliniche..."
        style="width:100%;padding:10px;border-radius:var(--radius);
        border:1.5px solid var(--border-bright);background:var(--bg-input);
        font-family:var(--font);font-size:14px;color:var(--text-primary);"
        ></textarea>
    </div>

    <button class="btn-submit-incident" id="btn-submit-pma-assessment">
      Salva Valutazione
    </button>`;
}

// PMA assessment state
const PMA_FORM = {
  conscious: null, respiration: null, circulation: null,
  walking: null, minor_injuries: null, triage: null
};

function setPMAYN(btn, field, value) {
  PMA_FORM[field] = value;
  const parent = btn.closest('div');
  parent.querySelectorAll('.pma-yn-btn').forEach(b => {
    b.classList.remove('active-yes', 'active-no');
  });
  btn.classList.add(value ? 'active-yes' : 'active-no');
}

function setPMATriage(triage) {
  PMA_FORM.triage = triage;
  document.querySelectorAll('.pma-triage-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.triage === triage);
  });
}

async function submitPMAAssessment(responseId, incidentId) {
  const btn = document.getElementById('btn-submit-pma-assessment');

  if (PMA_FORM.conscious === null)      { showToast('Indica coscienza', 'error'); return; }
  if (PMA_FORM.respiration === null)    { showToast('Indica respirazione', 'error'); return; }
  if (PMA_FORM.circulation === null)    { showToast('Indica circolo', 'error'); return; }
  if (PMA_FORM.minor_injuries === null) { showToast('Indica problema minore', 'error'); return; }
  if (!document.getElementById('pma-description')?.value.trim()) {
    showToast('Inserisci una descrizione', 'error'); return;
  }

  btn.disabled = true;
  btn.textContent = 'Salvataggio...';

  try {
    const { error } = await db
      .from('patient_assessments')
      .insert({
        incident_id:    incidentId,
        response_id:    responseId,
        assessed_by:    STATE.personnel?.id || null,
        conscious:      PMA_FORM.conscious,
        respiration:    PMA_FORM.respiration,
        circulation:    PMA_FORM.circulation,
        walking:        PMA_FORM.walking,
        minor_injuries: PMA_FORM.minor_injuries,
        triage:         PMA_FORM.triage,
        description:    document.getElementById('pma-description')?.value.trim() || null,
        clinical_notes: document.getElementById('pma-clinical-notes')?.value.trim() || null,
        heart_rate:     parseInt(document.getElementById('pma-heart-rate')?.value)     || null,
        breathing_rate: parseInt(document.getElementById('pma-breathing-rate')?.value) || null,
        spo2:           parseInt(document.getElementById('pma-spo2')?.value)           || null,
        blood_pressure: document.getElementById('pma-blood-pressure')?.value           || null,
        temperature:    parseFloat(document.getElementById('pma-temperature')?.value)  || null,
        gcs_total:      parseInt(document.getElementById('pma-gcs')?.value)            || null,
        hgt:            document.getElementById('pma-hgt')?.value                     || null,
      });

    if (error) throw error;

    closeModal('modal-assessment');
    showToast('Valutazione salvata ✓', 'success');
    await refreshPMA();

  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salva Valutazione';
  }
}

/* ----------------------------------------------------------------
   CLOSE PATIENT MODAL
---------------------------------------------------------------- */
let _closePatientResponseId = null;
let _closePatientIncidentId = null;
let _closeOutcome = null;

function openClosePatient(responseId, incidentId) {
  _closePatientResponseId = responseId;
  _closePatientIncidentId = incidentId;
  _closeOutcome = null;

  document.getElementById('close-opt-dimesso').classList.remove('selected');
  document.getElementById('close-opt-ospedale').classList.remove('selected');
  document.getElementById('close-hospital-detail').style.display = 'none';

  document.getElementById('btn-confirm-close-patient').onclick = confirmClosePatient;
  openModal('modal-close-patient');
}

async function selectCloseOutcome(type) {
  _closeOutcome = type;
  document.getElementById('close-opt-dimesso')
    .classList.toggle('selected', type === 'dimesso');
  document.getElementById('close-opt-ospedale')
    .classList.toggle('selected', type === 'ospedale');
  const detail = document.getElementById('close-hospital-detail');
  if (type === 'ospedale') {
    detail.style.display = 'flex';
    // Populate transport units
    const { data: resources } = await db
      .from('resources')
      .select('id, resource, resource_type')
      .eq('event_id', STATE.resource.event_id)
      .in('resource_type', ['ASM', 'ASI'])
      .order('resource');
    const select = document.getElementById('close-transport-unit');
    select.innerHTML = '<option value="">— Seleziona —</option>' +
      (resources || []).map(r =>
        `<option value="${r.id}">${r.resource} (${r.resource_type})</option>`
      ).join('');
  } else {
    detail.style.display = 'none';
  }
}

async function confirmClosePatient() {
  if (!_closeOutcome) { showToast('Seleziona un esito', 'error'); return; }
  const btn = document.getElementById('btn-confirm-close-patient');
  btn.disabled = true;
  btn.textContent = 'Chiusura...';

  try {
    if (_closeOutcome === 'dimesso') {
      // Direct close — no handoff needed
      const { error } = await db
        .from('incident_responses')
        .update({
          outcome:     'treated_and_released',
          released_at: new Date().toISOString(),
        })
        .eq('id', _closePatientResponseId);
      if (error) throw error;

    } else if (_closeOutcome === 'ospedale') {
     const unitId = document.getElementById('close-transport-unit')?.value;
    if (!unitId) { showToast('Seleziona unità di trasporto', 'error'); return; }

    // Handoff to transport unit — PMA closes as handed_off
    const { data: newRespData, error: handoffError } = await db.rpc('handoff_incident', {
        p_from_response_id: _closePatientResponseId,
        p_to_resource_id:   unitId,
        p_to_personnel_id:  null,
        p_outcome:          'handed_off',
        p_notes:            null,
        p_hospital_info:    null,
    });
    if (handoffError) throw handoffError;

    // Set new ambulance response to en_route_to_hospital
    const { data: newResp } = await db
        .from('incident_responses')
        .select('id')
        .eq('incident_id', _closePatientIncidentId)
        .eq('resource_id', unitId)
        .eq('outcome', 'treating')
        .order('assigned_at', { ascending: false })
        .limit(1)
        .single();

    if (newResp) {
        await db
        .from('incident_responses')
        .update({ outcome: 'en_route_to_hospital' })
        .eq('id', newResp.id);
    }
    }

    closeModal('modal-close-patient');
    showToast('Paziente chiuso ✓', 'success');
    await refreshPMA();

  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Conferma';
  }
}

/* ----------------------------------------------------------------
   NEW PATIENT (walk-in)
---------------------------------------------------------------- */
function openNewPatientForm() {

  // Reset PMA form state
  Object.assign(PMA_FORM, {
    conscious: true, respiration: true, circulation: true,
    walking: true, minor_injuries: true, triage: null
  });

  const body = document.getElementById('new-patient-body');

  body.innerHTML = buildNewPatientForm();

  document.getElementById('btn-submit-new-patient').onclick = submitNewPatient;
  openModal('modal-new-patient');
}

function buildNewPatientForm() {
  const ynButtons = (field, label, required = false) => `
    <div class="input-group">
      <label>${label}${required ? '<span class="required">*</span>' : ''}</label>
      <div style="display:flex;gap:8px;margin-top:4px;">
        <button type="button" class="pma-yn-btn pma-yn-no"
          data-field="${field}" data-value="false"
          onclick="setPMAYN(this, '${field}', false)">No</button>
        <button type="button" class="pma-yn-btn pma-yn-yes active-yes"
          data-field="${field}" data-value="true"
          onclick="setPMAYN(this, '${field}', true)">Sì</button>
      </div>
    </div>`;

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div class="input-group">
        <label>Nome - Cognome</label>
        <input type="text" id="np-patient-name" placeholder="—" />
      </div>
      <div class="input-group">
        <label>Pettorale</label>
        <input type="text" id="np-patient-id" placeholder="—" />
      </div>
      <div class="input-group">
        <label>Età apparente</label>
        <input type="number" id="np-patient-age" placeholder="—" min="0" max="120" />
      </div>
      <div class="input-group">
        <label>Sesso</label>
        <div style="display:flex;gap:0;border-radius:var(--radius);overflow:hidden;
          border:1.5px solid var(--border-bright);height:44px;margin-top:4px;">
          ${['M','F','Altro'].map(g => `
            <button type="button" onclick="
              document.querySelectorAll('.np-gender-btn').forEach(b=>b.classList.remove('np-active'));
              this.classList.add('np-active');
              window._npGender='${g}';
            " class="np-gender-btn" style="flex:1;border:none;border-right:1px solid var(--border-bright);
              background:var(--bg-input);font-family:var(--font);font-size:14px;font-weight:600;
              color:var(--text-primary);cursor:pointer;transition:all 0.15s;"
              data-gender="${g}">${g}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="input-group" style="margin-bottom:12px;">
      <label>Descrizione <span class="required">*</span></label>
      <textarea id="np-description" rows="2" placeholder="Motivo accesso al PMA..."
        style="width:100%;padding:10px;border-radius:var(--radius);
        border:1.5px solid var(--border-bright);background:var(--bg-input);
        font-family:var(--font);font-size:14px;color:var(--text-primary);"></textarea>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      ${ynButtons('conscious', 'Coscienza', true)}
      ${ynButtons('respiration', 'Respirazione', true)}
      ${ynButtons('circulation', 'Circolo', true)}
      ${ynButtons('walking', 'Cammina')}
      ${ynButtons('minor_injuries', 'Prob. Minore', true)}
      <div class="input-group">
        <label>Triage</label>
        <div style="display:flex;gap:6px;margin-top:4px;">
          ${['white','green','yellow','red'].map(t => `
            <button type="button"
              class="pma-triage-btn ${t}"
              onclick="setPMATriage('${t}')"
              data-triage="${t}">
              ${t === 'white' ? '⚪' : t === 'green' ? '🟢' : t === 'yellow' ? '🟡' : '🔴'}
            </button>`).join('')}
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px;">
      <div class="input-group">
        <label>FC</label>
        <input type="number" id="np-heart-rate" placeholder="—" min="0" max="300" />
      </div>
      <div class="input-group">
        <label>FR</label>
        <input type="number" id="np-breathing-rate" placeholder="—" min="0" max="60" />
      </div>
      <div class="input-group">
        <label>SpO2 (%)</label>
        <input type="number" id="np-spo2" placeholder="—" min="0" max="100" />
      </div>
      <div class="input-group">
        <label>PA</label>
        <input type="text" id="np-blood-pressure" placeholder="—" />
      </div>
      <div class="input-group">
        <label>Temp (°C)</label>
        <input type="number" id="np-temperature" placeholder="—" step="0.1" />
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      <div class="input-group">
        <label>GCS</label>
        <input type="number" id="np-gcs" placeholder="—" min="3" max="15" />
      </div>
      <div class="input-group">
        <label>HGT</label>
        <input type="text" id="np-hgt" placeholder="—" />
      </div>
    </div>

    <div class="input-group" style="margin-bottom:16px;">
      <label>Note cliniche</label>
      <textarea id="np-clinical-notes" rows="2" placeholder="Osservazioni cliniche..."
        style="width:100%;padding:10px;border-radius:var(--radius);
        border:1.5px solid var(--border-bright);background:var(--bg-input);
        font-family:var(--font);font-size:14px;color:var(--text-primary);"></textarea>
    </div>

    <button class="btn-submit-incident" id="btn-submit-new-patient">
      Registra Paziente
    </button>`;
}

window._npGender = null;

async function submitNewPatient() {
  const btn = document.getElementById('btn-submit-new-patient');

  if (PMA_FORM.conscious === null)   { showToast('Indica coscienza', 'error'); return; }
  if (PMA_FORM.respiration === null) { showToast('Indica respirazione', 'error'); return; }
  if (PMA_FORM.circulation === null) { showToast('Indica circolo', 'error'); return; }
  if (!document.getElementById('np-description')?.value.trim()) {
    showToast('Inserisci una descrizione', 'error'); return;
  }

  btn.disabled = true;
  btn.textContent = 'Registrazione...';

  try {
    const params = {
      p_event_id:        STATE.resource.event_id,
      p_resource_id:     STATE.resource.id,
      p_personnel_id:    STATE.personnel?.id || null,
      p_incident_type:   'medical',
      p_lng:             null,
      p_lat:             null,
      p_patient_name:    document.getElementById('np-patient-name')?.value.trim() || null,
      p_patient_age:     parseInt(document.getElementById('np-patient-age')?.value) || null,
      p_patient_gender:  window._npGender || null,
      p_patient_identifier: document.getElementById('np-patient-id')?.value.trim() || null,
      p_description:     document.getElementById('np-description')?.value.trim() || null,
      p_initial_outcome: 'treating',
      p_conscious:       PMA_FORM.conscious,
      p_respiration:     PMA_FORM.respiration,
      p_circulation:     PMA_FORM.circulation,
      p_walking:         PMA_FORM.walking,
      p_minor_injuries:  PMA_FORM.minor_injuries,
      p_heart_rate:      parseInt(document.getElementById('np-heart-rate')?.value)     || null,
      p_spo2:            parseInt(document.getElementById('np-spo2')?.value)           || null,
      p_breathing_rate:  parseInt(document.getElementById('np-breathing-rate')?.value) || null,
      p_blood_pressure:  document.getElementById('np-blood-pressure')?.value           || null,
      p_temperature:     parseFloat(document.getElementById('np-temperature')?.value)  || null,
      p_triage:          PMA_FORM.triage,
      p_clinical_notes:  document.getElementById('np-clinical-notes')?.value.trim()   || null,
    };

    const { data, error } = await db.rpc('create_incident_with_assessment', params);
    if (error) throw error;

    closeModal('modal-new-patient');
    showToast('Paziente registrato ✓', 'success');
    await refreshPMA();

  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Registra Paziente';
  }
}