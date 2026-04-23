/* ================================================================
   js/views/pca-pma.js  —  PMA read-only view for PCA dashboard
   Shows incoming, in-treatment and closed patients per PMA,
   with latest vitals. Tab per PMA resource.

   Mounted by router.js into #page-content.
   Depends on: pca-rpc.js, pca.js (formatTime)
================================================================ */

let _pcaPMAResources  = [];   // all PMA resources for this event
let _pcaSelectedPMAId = null; // currently selected tab

/* ================================================================
   MOUNT & TABS
   mountPMA        — fetches PMA resources, builds tab bar,
                     triggers first render.
   renderPMATabs   — renders tab buttons, highlights selected.
   selectPMATab    — switches selected PMA and refreshes view.
================================================================ */
async function mountPMA(container) {
  container.innerHTML = `
    <div class="pma-page">
      <div class="pma-page-header">
        <div class="pma-tabs" id="pma-tabs"></div>
        <span class="pma-page-updated" id="pma-page-updated">—</span>
      </div>
      <div class="pma-page-body" id="pma-page-body">
        <div class="empty-state">Caricamento...</div>
      </div>
    </div>

    <!-- MODAL: Storico PMA -->
    <div id="modal-pca-pma-storico" class="modal-overlay hidden">
      <div class="modal-box modal-wide">
        <div class="modal-header">
          <h2 id="pca-pma-storico-title">Storico valutazioni</h2>
          <button class="modal-close"
            onclick="document.getElementById('modal-pca-pma-storico').classList.add('hidden')">✕</button>
        </div>
        <div class="modal-body" id="pca-pma-storico-body"></div>
      </div>
    </div>`;

  // Fetch all PMA resources for this event
  const pmas = await fetchPMAResources(PCA.eventId);
  if (!pmas.length) {
    document.getElementById('pma-page-body').innerHTML =
      '<div class="empty-state">Nessun PMA configurato per questo evento</div>';
    return;
  }

  _pcaPMAResources  = pmas;
  _pcaSelectedPMAId = pmas[0].id;

  renderPMATabs();
  await refreshPCAView();

}

function renderPMATabs() {
  const tabsEl = document.getElementById('pma-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = _pcaPMAResources.map(pma => `
    <button class="pma-tab ${pma.id === _pcaSelectedPMAId ? 'active' : ''}"
      onclick="selectPMATab('${pma.id}')">
      🏥 ${pma.resource}
    </button>`).join('');
}

async function selectPMATab(pmaId) {
  _pcaSelectedPMAId = pmaId;
  renderPMATabs();
  await refreshPCAView();
}

/* ================================================================
   DATA & RENDER
   refreshPCAView    — fetches incoming/active/closed in parallel
                       for the selected PMA, renders all sections.
   buildPMASection   — builds a titled table section for a patient
                       group (incoming, active, closed).
   buildPMARow       — builds a single patient row, branching on
                       type for different column sets.
================================================================ */
async function refreshPCAView() {
  const body = document.getElementById('pma-page-body');
  if (!body) return;

  const updatedEl = document.getElementById('pma-page-updated');
  if (updatedEl) updatedEl.textContent =
    `Aggiornato alle ${formatTime(new Date().toISOString())}`;

  const [incoming, active, closed] = await Promise.all([
    fetchPCAPMAIncoming(_pcaSelectedPMAId),
    fetchPCAPMAActive(_pcaSelectedPMAId),
    fetchPCAPMAClosed(_pcaSelectedPMAId),
  ]);

  body.innerHTML =
    buildPMASection('📨 In arrivo',       incoming, 'incoming') +
    buildPMASection('🟢 In trattamento',  active,   'active')   +
    buildPMASection('✓ Chiusi',           closed,   'closed');
}

function buildPMASection(title, rows, type) {
  const colspans = { incoming: 17, active: 18, closed: 17 };

  const headers = type === 'active'
    ? `<th>Ora</th><th>Letto</th><th>Triage</th><th>Paziente</th>
       <th>Descrizione</th><th>Coscienza</th><th>Respiro</th><th>Circolo</th>
       <th>Acc.<br>Venoso</th><th>FC</th><th>FR</th><th>SpO2</th>
       <th>PA</th><th>Temp</th><th>GCS</th><th>HGT</th><th>Storico</th>`
    : type === 'incoming'
    ? `<th>Ora</th><th>Triage</th><th>Squadra</th><th>Paziente</th>
       <th>Descrizione</th><th>Coscienza</th><th>Respiro</th><th>Circolo</th>
       <th>Acc.<br>Venoso</th><th>FC</th><th>FR</th><th>SpO2</th>
       <th>PA</th><th>Temp</th><th>GCS</th><th>HGT</th><th>Storico</th>`
    : `<th>Ora</th><th>Triage</th><th>Paziente</th>
       <th>Descrizione</th><th>Coscienza</th><th>Respiro</th><th>Circolo</th>
       <th>Acc.<br>Venoso</th><th>FC</th><th>FR</th><th>SpO2</th>
       <th>PA</th><th>Temp</th><th>GCS</th><th>HGT</th><th>Storico</th><th>Esito</th>`;

  const emptyMsg = {
    incoming: 'Nessun paziente in arrivo',
    active:   'Nessun paziente in trattamento',
    closed:   'Nessun paziente chiuso',
  }[type];

  const rows_html = rows.length === 0
    ? `<tr class="empty-row"><td colspan="${colspans[type]}">${emptyMsg}</td></tr>`
    : rows.map(row => buildPMARow(row, type)).join('');

  return `
    <div class="pma-page-section">
      <div class="pma-page-section-header">
        <span class="pma-page-section-title">${title}</span>
        <span class="side-badge ${type === 'incoming' ? 'badge-active' : ''}">${rows.length}</span>
      </div>
      <div class="pma-page-table-wrapper">
        <table class="pma-page-table">
          <thead><tr>${headers}</tr></thead>
          <tbody>${rows_html}</tbody>
        </table>
      </div>
    </div>`;
}

function buildPMARow(row, type) {
  const inc = row.incidents;
  const a   = getPCALatestAssessment(inc.patient_assessments);

  const name = inc.patient_name || inc.patient_identifier || 'Ignoto';
  const patientCell = `
    <strong>${name}</strong><br>
    <span style="font-size:11px;color:var(--text-secondary);">
      Età: ${inc.patient_age || 'nd'} · Sesso: ${inc.patient_gender || 'nd'}
    </span>`;

  const descCell = `
    <span style="display:block;max-width:150px;overflow:hidden;
      text-overflow:ellipsis;white-space:nowrap;cursor:default;"
      title="${a?.description ?? ''}">${a?.description ?? '—'}</span>`;

  const vitals = buildPCAVitalsCells(a);
  const triage = buildPCATriageCell(inc.current_triage);
  const storico = `<button class="btn-table-action storico"
    onclick="openPCAStorico('${inc.id}')">Storico</button>`;

  if (type === 'incoming') {
    const time = formatTime(row.assigned_at);
    const team = row.resources?.resource || '—';
    return `<tr>
      <td>${time}</td>
      <td>${triage}</td>
      <td>${team}</td>
      <td>${patientCell}</td>
      <td>${descCell}</td>
      ${vitals}
      <td>${storico}</td>
    </tr>`;
  }

  if (type === 'active') {
    const time = a
      ? formatTime(a.assessed_at)
      : formatTime(row.assigned_at);
    const bed = a?.bed_number_pma ?? '—';
    return `<tr>
      <td>${time}</td>
      <td>${bed}</td>
      <td>${triage}</td>
      <td>${patientCell}</td>
      <td>${descCell}</td>
      ${vitals}
      <td>${storico}</td>
    </tr>`;
  }

  // closed
  const time = row.released_at ? formatTime(row.released_at) : '—';
  const isHospital = row.outcome === 'taken_to_hospital' ||
    (row.outcome === 'handed_off' && row.handoff_to_response_id != null);
  const hospitalName = row.dest_hospital || row.hospital_info?.name || null;
  const esito = isHospital
    ? `<span class="outcome-badge ospedale">🏥 Ospedalizzato${hospitalName ? ' — ' + hospitalName : ''}</span>`
    : `<span class="outcome-badge dimesso">✔ Dimesso</span>`;

  return `<tr>
    <td>${time}</td>
    <td>${triage}</td>
    <td>${patientCell}</td>
    <td>${descCell}</td>
    ${vitals}
    <td>${storico}</td>
    <td>${esito}</td>
  </tr>`;
}

/* ================================================================
   STORICO MODAL
   openPCAStorico — fetches full assessment history for an incident
                    via pca-rpc, renders the storico table modal.
================================================================ */
async function openPCAStorico(incidentId) {
  const result = await fetchPCAStorico(incidentId);
  if (!result) return;
  const { inc, assessments } = result;

  const yn = v => v === true
    ? '<span class="yn-cell yes">Sì</span>'
    : v === false ? '<span class="yn-cell no">No</span>'
    : '<span class="yn-cell unknown">—</span>';

  document.getElementById('pca-pma-storico-title').textContent =
    (inc.patient_name || inc.patient_identifier || 'Paziente ignoto') +
    ' — Storico valutazioni';

  document.getElementById('pca-pma-storico-body').innerHTML = assessments.length === 0
    ? '<div class="empty-state">Nessuna valutazione registrata</div>'
    : `<div style="overflow-x:auto;">
        <table class="pma-page-table" style="font-size:12px;">
          <thead><tr>
            <th>Ora</th><th>Squadra</th><th>Triage</th><th>Descrizione</th>
            <th>Cosc.</th><th>Resp.</th><th>Circ.</th>
            <th>FC</th><th>FR</th><th>SpO2</th><th>PA</th>
            <th>Temp</th><th>GCS</th><th>HGT</th>
          </tr></thead>
          <tbody>
            ${assessments.map(a => `<tr>
              <td>${formatTime(a.assessed_at)}</td>
              <td>${a.resourceName}</td>
              <td>${buildPCATriageCell(a.triage)}</td>
              <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;
                white-space:nowrap;cursor:default;" title="${a.description ?? ''}">
                ${a.description ?? '—'}
              </td>
              <td>${yn(a.conscious)}</td>
              <td>${yn(a.respiration)}</td>
              <td>${yn(a.circulation)}</td>
              <td>${a.heart_rate ?? '—'}</td>
              <td>${a.breathing_rate ?? '—'}</td>
              <td>${a.spo2 != null ? a.spo2 + '%' : '—'}</td>
              <td>${a.blood_pressure ?? '—'}</td>
              <td>${a.temperature ?? '—'}</td>
              <td>${a.gcs_total ?? '—'}</td>
              <td>${a.hgt ?? '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

  document.getElementById('modal-pca-pma-storico').classList.remove('hidden');
}

/* ================================================================
   HELPERS
   getPCALatestAssessment — returns the most recent assessment from
                            an array, sorted by assessed_at.
   buildPCATriageCell     — renders a triage colour dot.
   buildPCAVitalsCells    — renders all vitals as table cells,
                            showing — for missing values.
================================================================ */
function getPCALatestAssessment(assessments) {
  if (!assessments || assessments.length === 0) return null;
  return [...assessments]
    .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at))[0];
}

function buildPCATriageCell(triage) {
  if (!triage) return '—';
  const colors = { red: 'var(--red)', yellow: 'var(--yellow)',
                   green: 'var(--green)', white: '#ccc' };
  return `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;
    background:${colors[triage] || 'var(--text-muted)'};"></span>`;
}

function buildPCAVitalsCells(a) {
  const yn = v => v === true
    ? '<span class="yn-cell yes">Sì</span>'
    : v === false ? '<span class="yn-cell no">No</span>'
    : '<span class="yn-cell unknown">—</span>';

  if (!a) return `<td>—</td><td>—</td><td>—</td><td>—</td>
    <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>`;
  return `
    <td>${yn(a.conscious)}</td>
    <td>${yn(a.respiration)}</td>
    <td>${yn(a.circulation)}</td>
    <td>${yn(a.iv_access)}</td>
    <td>${a.heart_rate ?? '—'}</td>
    <td>${a.breathing_rate ?? '—'}</td>
    <td>${a.spo2 != null ? a.spo2 + '%' : '—'}</td>
    <td>${a.blood_pressure ?? '—'}</td>
    <td>${a.temperature ?? '—'}</td>
    <td>${a.gcs_total ?? '—'}</td>
    <td>${a.hgt ?? '—'}</td>`;
}