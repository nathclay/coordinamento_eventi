/* ================================================================
   js/views/pca-soccorsi.js  —  Soccorsi page
   Full incident table view, grouped by active/closed.
   Mounted by router.js into #page-content.
================================================================ */

/* ── MOUNT ─────────────────────────────────────────────────── */
async function mountSoccorsi(container) {
  container.innerHTML = `
    <div class="soccorsi-page">
      <div class="soccorsi-header">
        <h2 class="soccorsi-title">Soccorsi</h2>
        <span class="soccorsi-updated" id="soccorsi-updated">—</span>
      </div>
      <div class="soccorsi-body" id="soccorsi-body">
        <div class="empty-state">Caricamento...</div>
      </div>
    </div>

    <!-- MODAL: Incident detail (soccorsi page version) -->
    <div id="modal-soccorsi-incident" class="modal-overlay hidden">
      <div class="modal-box modal-wide">
        <div class="modal-header">
          <h2 id="msi-title">Dettaglio Soccorso</h2>
          <button class="modal-close" onclick="closeSoccorsiModal('modal-soccorsi-incident')">✕</button>
        </div>
        <div class="modal-body" id="msi-body"></div>
        <div class="modal-footer" id="msi-footer"></div>
      </div>
    </div>

    <!-- MODAL: Aggiungi risorsa -->
    <div id="modal-add-resource" class="modal-overlay hidden">
      <div class="modal-box">
        <div class="modal-header">
          <h2>Aggiungi risorsa</h2>
          <button class="modal-close" onclick="closeSoccorsiModal('modal-add-resource')">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Risorsa</label>
            <select id="ar-resource">
              <option value="">— Scegli —</option>
            </select>
          </div>
          <div class="form-group">
            <label>Outcome iniziale</label>
            <select id="ar-outcome">
              <option value="en_route_to_incident">In arrivo</option>
              <option value="treating">In trattamento</option>
            </select>
          </div>
          <div id="ar-error" class="error-msg"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeSoccorsiModal('modal-add-resource')">Annulla</button>
          <button class="btn-primary" id="ar-confirm" style="width:auto;padding:8px 20px;">Aggiungi</button>
        </div>
      </div>
    </div>

    <!-- MODAL: Chiudi soccorso -->
    <div id="modal-close-incident" class="modal-overlay hidden">
      <div class="modal-box">
        <div class="modal-header">
          <h2>Chiudi soccorso</h2>
          <button class="modal-close" onclick="closeSoccorsiModal('modal-close-incident')">✕</button>
        </div>
        <div class="modal-body">
          <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">
            Seleziona l'esito finale per tutte le unità attive su questo soccorso.
          </p>
          <div class="form-group">
            <label>Esito</label>
            <select id="ci-outcome">
              <option value="treated_and_released">Trattato e dimesso</option>
              <option value="cancelled">Annullato / Falso allarme</option>
            </select>
          </div>
          <div id="ci-error" class="error-msg"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeSoccorsiModal('modal-close-incident')">Annulla</button>
          <button class="btn-primary" id="ci-confirm" style="width:auto;padding:8px 20px;background:var(--red);">Chiudi soccorso</button>
        </div>
      </div>
    </div>`;

  await renderSoccorsiTables();
}

/* ── RENDER TABLES ─────────────────────────────────────────── */
async function renderSoccorsiTables() {
  const body = document.getElementById('soccorsi-body');
  if (!body) return;

  const { data: incidents, error } = await db
    .from('incidents')
    .select(`
      id, incident_type, status, current_triage,
      patient_name, patient_identifier, patient_age, patient_gender,
      created_at, updated_at, description,
      incident_responses(
        id, outcome, assigned_at, released_at,
        resources!incident_responses_resource_id_fkey(id, resource, resource_type)
      ),
      patient_assessments(
        id, assessed_at, triage,
        conscious, respiration, circulation,
        description, clinical_notes,
        heart_rate, spo2, breathing_rate, blood_pressure, temperature, iv_access, bed_number_pma
      )
    `)
    .eq('event_id', PCA.eventId)
    .not('status', 'eq', 'cancelled')
    .order('created_at', { ascending: false });

  if (error) {
    body.innerHTML = `<div class="empty-state">Errore: ${error.message}</div>`;
    return;
  }

  const updatedEl = document.getElementById('soccorsi-updated');
  if (updatedEl) updatedEl.textContent = `Aggiornato alle ${formatTime(new Date().toISOString())}`;

  // Filter out pure PMA walk-ins (all responses are PMA type)
  const visible = (incidents || []).filter(i => !isPMAOnly(i));

  const active = visible.filter(i => ['open', 'in_progress'].includes(i.status));
  const closed = visible.filter(i => ['resolved', 'taken_to_hospital', 'in_progress_in_pma'].includes(i.status));
  body.innerHTML = `
    ${buildSoccorsiSection('Soccorsi attivi', active, true)}
    ${buildSoccorsiSection('Soccorsi chiusi', closed, false)}
  `;
}

/* Pure PMA = every response belongs to a PMA resource */
function isPMAOnly(incident) {
  const responses = incident.incident_responses || [];
  if (responses.length === 0) return false;
  return responses.every(r => r.resources?.resource_type === 'PMA');
}

/* ── SECTION BUILDER ───────────────────────────────────────── */
function buildSoccorsiSection(title, incidents, isActive) {
  const badge = isActive
    ? `<span class="side-badge badge-active">${incidents.length}</span>`
    : `<span class="side-badge badge-closed">${incidents.length}</span>`;

  if (incidents.length === 0) {
    return `
      <div class="soccorsi-section">
        <div class="soccorsi-section-header">
          <span class="soccorsi-section-title">${title}</span>
          ${badge}
        </div>
        <div class="empty-state" style="padding:20px;">Nessun soccorso</div>
      </div>`;
  }

    const headers = isActive
    ? `<th class="sc-ora">Ora</th>
        <th class="sc-triage">Codice</th>
        <th class="sc-patient">Paziente</th>
        <th class="sc-c">Coscienza</th>
        <th class="sc-r">Respiro</th>
        <th class="sc-ci">Circolo</th>
        <th class="sc-resource-active">Risorsa attuale</th>
        <th class="sc-resource-past">Risorse precedenti</th>
        <th class="sc-status">Stato</th>`
    : `<th class="sc-ora">Ora</th>
        <th class="sc-triage">Codice</th>
        <th class="sc-patient">Paziente</th>
        <th class="sc-c">Coscienza</th>
        <th class="sc-r">Respiro</th>
        <th class="sc-ci">Circolo</th>
        <th class="sc-esito">Esito</th>
        <th class="sc-resource-past">Risorse coinvolte</th>`;

  const rows = incidents.map(i => buildSoccorsiRow(i, isActive)).join('');

  return `
    <div class="soccorsi-section">
      <div class="soccorsi-section-header">
        <span class="soccorsi-section-title">${title}</span>
        ${badge}
      </div>
      <table class="soccorsi-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ── ROW BUILDER ───────────────────────────────────────────── */
function buildSoccorsiRow(i, isActive) {
  const triage = i.current_triage || 'none';
  const triageLabels = { red: 'Rosso', yellow: 'Giallo', green: 'Verde', white: 'Bianco', none: 'ND' };

  const assessments = [...(i.patient_assessments || [])]
    .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at));
  const latest = assessments[0];

  const dot = val => {
    if (val === true)  return '<span class="crc-dot crc-yes"></span>';
    if (val === false) return '<span class="crc-dot crc-no"></span>';
    return '<span class="crc-dot crc-unknown"></span>';
  };
  const c = latest ? dot(latest.conscious)   : '<span class="crc-dot crc-unknown"></span>';
  const r = latest ? dot(latest.respiration) : '<span class="crc-dot crc-unknown"></span>';
  const ci = latest ? dot(latest.circulation) : '<span class="crc-dot crc-unknown"></span>';

  const patientCell = `
    <div class="sc-patient-name">${i.patient_name || '—'}</div>
    <div class="sc-patient-meta">Pettorale: ${i.patient_identifier || 'nd'}</div>
    <div class="sc-patient-meta">Età: ${i.patient_age || 'nd'} · Sesso: ${i.patient_gender || 'nd'}</div>`;

  const ora = formatTime(i.created_at);

  // Active responses (non-PMA)
  const activeResources = (i.incident_responses || [])
    .filter(r => ['en_route_to_incident','treating','en_route_to_pma','en_route_to_hospital'].includes(r.outcome)
                 && r.resources?.resource_type !== 'PMA')
    .map(r => r.resources?.resource).filter(Boolean);

  // Past non-PMA resources (terminal outcome)
  const pastResources = [...new Set(
    (i.incident_responses || [])
      .filter(r => !['en_route_to_incident','treating','en_route_to_pma','en_route_to_hospital'].includes(r.outcome)
                   && r.resources?.resource_type !== 'PMA')
      .map(r => r.resources?.resource).filter(Boolean)
  )];

  const activeCell = activeResources.length > 0
    ? activeResources.map(n => `<span class="resource-chip active">${n}</span>`).join(' ')
    : '—';
  const pastCell = pastResources.length > 0
    ? pastResources.map(n => `<span class="resource-chip past">${n}</span>`).join(' ')
    : '—';

  if (isActive) {
    const statusLabel = { open: 'Aperto', in_progress: 'In corso' }[i.status] || i.status;
    return `
      <tr class="soccorsi-row" onclick="openIncidentDetailModal('${i.id}')">
        <td class="sc-ora">${ora}</td>
        <td class="sc-triage"><span class="triage-pill ${triage}">${triageLabels[triage]}</span></td>
        <td class="sc-patient">${patientCell}</td>
        <td class="sc-c">${c}</td>
        <td class="sc-r">${r}</td>
        <td class="sc-ci">${ci}</td>
        <td class="sc-resource-active">${activeCell}</td>
        <td class="sc-resource-past">${pastCell}</td>
        <td class="sc-status"><span class="ic-status-tag ${i.status}">${statusLabel}</span></td>
      </tr>`;
  } else {
    const esitoMap = {
      resolved:           { label: 'Dimesso',  cls: 'resolved' },
      taken_to_hospital:  { label: 'Ospedale', cls: 'taken_to_hospital' },
      in_progress_in_pma: { label: 'In PMA',   cls: 'in_progress_in_pma' },
    };
    const esito = esitoMap[i.status] || { label: i.status, cls: '' };

    // For closed, all non-PMA resources
    const allResources = [...new Set(
      (i.incident_responses || [])
        .filter(r => r.resources?.resource_type !== 'PMA')
        .map(r => r.resources?.resource).filter(Boolean)
    )].map(n => `<span class="resource-chip past">${n}</span>`).join(' ') || '—';

    return `
      <tr class="soccorsi-row" onclick="openIncidentDetailModal('${i.id}')">
        <td class="sc-ora">${ora}</td>
        <td class="sc-triage"><span class="triage-pill ${triage}">${triageLabels[triage]}</span></td>
        <td class="sc-patient">${patientCell}</td>
        <td class="sc-c">${c}</td>
        <td class="sc-r">${r}</td>
        <td class="sc-ci">${ci}</td>
        <td class="sc-esito"><span class="ic-status-tag ${esito.cls}">${esito.label}</span></td>
        <td class="sc-resource-past">${allResources}</td>
      </tr>`;
  }
}

/* C/R/C colored dots */
function buildCRCDots(assessment) {
  if (!assessment) return '<span style="color:var(--text-muted);font-size:11px;">—</span>';
  const dot = val => {
    if (val === true)  return '<span class="crc-dot crc-yes"></span>';
    if (val === false) return '<span class="crc-dot crc-no"></span>';
    return '<span class="crc-dot crc-unknown"></span>';
  };
  return `<span class="crc-group">
    ${dot(assessment.conscious)}
    ${dot(assessment.respiration)}
    ${dot(assessment.circulation)}
  </span>`;
}
