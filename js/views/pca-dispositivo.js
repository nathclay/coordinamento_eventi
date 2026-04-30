/* ================================================================
   js/views/pca-dispositivo.js  —  Dispositivo page
   Personnel matrix grouped by resource type. Each resource shows
   as a table row with crew cells per role. Supports inline editing
   of personnel and resource details, coordinator assignment,
   and column resize.

   Mounted by router.js into #page-content.
   Depends on: supabase.js (db), pca.js (PCA, formatTime),
               pca-import.js (openPersonnelImportModal,
               openResourcesImportModal)
================================================================ */

const PERSONNEL_ROLES = [
  'autista', 'infermiere', 'medico', 'soccorritore',
  'coordinatore', 'volontario_generico', 'opem',
  'tlc', 'logista', 'sep', 'droni'
];

const STATUS_COLORS = {
  activated: 'rgba(63,185,80,0.22)',
  cancelled:  'rgba(226,75,74,0.22)',
  no_show:    'rgba(72,79,88,0.35)',
  scheduled:  'transparent',
};

const STATUS_LABELS = {
  activated: 'Attivato',
  cancelled:  'Annullato',
  no_show:    'Assente',
  scheduled:  'Pianificato',
};

/* ================================================================
   MOUNT & RENDER
   mountDispositivo  — builds page shell with import buttons,
                       triggers render.
   renderDispositivo — fetches all resources and personnel, groups
                       both by type/resource, renders all sections.
================================================================ */
async function mountDispositivo(container) {
  container.innerHTML = `
    <div class="disp-page">
      <div class="disp-header">
        <h2 class="disp-title">Dispositivo</h2>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn-secondary" onclick="openResourcesImportModal()"
            style="font-size:11px;padding:5px 12px;">↑ Importa risorse</button>
          <span style="font-size:11px;color:var(--text-secondary);">
            Gestione personale → <strong>dispositivo.html</strong>
          </span>
        </div>
        <span class="disp-updated" id="disp-updated">—</span>
      </div>
      <div class="disp-body" id="disp-body">
        <div class="empty-state">Caricamento...</div>
      </div>
    </div>`;

  await renderDispositivo();
}


async function renderDispositivo() {
  const body = document.getElementById('disp-body');
  if (!body) return;

  const [allResources, allPersonnel] = await Promise.all([
    fetchDispositivoResources(PCA.eventId),
    fetchDispositivoPersonnel(PCA.eventId),
  ]);

  const updatedEl = document.getElementById('disp-updated');
  if (updatedEl) updatedEl.textContent =
    `Aggiornato alle ${formatTime(new Date().toISOString())}`;

  _allDispResources = allResources;

  // Group personnel by resource_id (via resource_days join)
  const byResource = {};
  allPersonnel.forEach(p => {
    const key = p.resource_days?.resource_id || '__unassigned__';
    if (!byResource[key]) byResource[key] = [];
    byResource[key].push(p);
  });

  // Group resources by type
  const byType = {};
  allResources.forEach(r => {
    if (!byType[r.resource_type]) byType[r.resource_type] = [];
    byType[r.resource_type].push(r);
  });

  const sections = [];

  const asmResources = [...(byType['ASM'] || []), ...(byType['MM'] || [])];
  if (asmResources.length) sections.push(buildAmbulanceSection('ASM / MM', asmResources, byResource));

  if (byType['ASI']?.length) sections.push(buildAmbulanceSection('ASI', byType['ASI'], byResource));
  if (byType['PMA']?.length) sections.push(buildAmbulanceSection('PMA', byType['PMA'], byResource, false));
  if (byType['SAP']?.length) sections.push(buildSAPSection_labeled('SAP', byType['SAP'], byResource));
  if (byType['BICI']?.length) sections.push(buildSAPSection_labeled('BICI', byType['BICI'], byResource));

  const ldcResources = [...(byType['LDC'] || []), ...(byType['PCA'] || [])];
  if (ldcResources.length) sections.push(buildLDCSection(ldcResources, byResource));

  const unassigned = byResource['__unassigned__'] || [];
  if (unassigned.length) sections.push(buildPoolSection('Non assegnati', unassigned));

  body.innerHTML = sections.join('') ||
    '<div class="empty-state">Nessun personale per la sessione corrente</div>';

  initDispResize();
}


/* ================================================================
   RESOURCE INFO CELLS
   buildResourceInfoHeaders — returns the standard resource column
                              header cells (position, coordinator,
                              schedule, email, notes, targa).
   buildResourceInfoCells   — returns the data cells for a resource
                              row including coordinator dropdown.
   updateDispCoordinator    — updates coordinator_id via db,
                              syncs local _allDispResources cache.
================================================================ */
function buildResourceInfoHeaders(includesTarga = false) {
  return `
    <th>Posizione</th>
    <th>Coordinatore</th>
    <th>Orario</th>
    <th>Email</th>
    <th>Note</th>
    ${includesTarga ? '<th>Targa</th>' : ''}`;
}

function buildResourceInfoCells(r, includesTarga = false) {
    // Position
    let posCell = '—';
    if (r.geom?.coordinates) {
        const lat = r.geom.coordinates[1];
        const lng = r.geom.coordinates[0];
        posCell = `<a href="https://maps.google.com/?q=${lat},${lng}"
        target="_blank" class="disp-maps-link">📍 Mappa</a>`;
    }

    const ldcs = (_allDispResources.length > 0 ? _allDispResources : [])
    .filter(r => r.resource_type === 'LDC');

    const coordSelect = `
    <select class="coord-select" 
        onchange="updateDispCoordinator('${r.id}', this.value)">
        <option value="">— Nessuno —</option>
        ${ldcs.map(ldc => `
        <option value="${ldc.id}" 
            ${r.coordinator?.resource === ldc.resource ? 'selected' : ''}>
            ${ldc.resource}
        </option>`).join('')}
    </select>`;  
    
    const orario = (r.start_time || r.end_time)
        ? `${r.start_time ? formatTime(r.start_time) : '—'} - ${r.end_time ? formatTime(r.end_time) : '—'}`
        : '—';
    const emailCell  = r.user_email
        ? `<a href="mailto:${r.user_email}" class="disp-maps-link">${r.user_email}</a>`
        : '—';
    const notesCell  = r.notes
        ? `<span title="${r.notes}" style="cursor:default;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;display:block;max-width:120px;">
            ${r.notes}</span>`
        : '—';
    const targaCell  = includesTarga ? `<td>${r.targa || '—'}</td>` : '';

    return `
        <td>${posCell}</td>
        <td>${coordSelect}</td>
        <td>${orario}</td>
        <td>${emailCell}</td>
        <td>${notesCell}</td>
        ${targaCell}`;
}

async function updateDispCoordinator(resourceId, coordinatorId) {
  const ok = await updateResourceCoordinator(resourceId, coordinatorId);
  if (!ok) { showToast('Errore aggiornamento coordinatore', 'error'); return; }

  showToast('Coordinatore aggiornato ✓', 'success');

  // Update local cache so re-renders stay in sync
  const r = _allDispResources.find(r => r.id === resourceId);
  if (r) {
    const ldc = _allDispResources.find(l => l.id === coordinatorId);
    r.coordinator = ldc ? { id: ldc.id, resource: ldc.resource } : null;
  }
}

/* ================================================================
   COLUMN RESIZE
   COL_DEFAULTS   — default and minimum widths per column label.
   initDispResize — attaches drag handles to all table headers,
                    allowing per-column width adjustment.
================================================================ */
const COL_DEFAULTS = {
  'Risorsa':          { default: 90,  min: 60  },
  'Posizione':        { default: 50,  min: 60  },
  'Coordinatore':     { default: 100, min: 60  },
  'Orario':          { default: 60, min: 60  },
  'Email':            { default: 80, min: 80  },
  'Note':             { default: 100, min: 60  },
  'Targa':            { default: 80,  min: 60  },
  'Autista':          { default: 100, min: 80  },
  'Soccorritore':     { default: 100, min: 80  },
  'Infermiere':       { default: 100, min: 80  },
  'Medico':           { default: 100, min: 80  },
  'Volontario':       { default: 100, min: 80  },
  'Altro':            { default: 100, min: 80  },
};
const DEFAULT_MIN     = 20;
const DEFAULT_WIDTH   = 120;

function initDispResize() {
  document.querySelectorAll('.disp-table th').forEach(th => {
    // Get label before appending the handle
    const label = th.childNodes[0]?.textContent?.trim() 
                  || th.textContent.trim();
    const conf  = COL_DEFAULTS[label] || {};
    const minW  = conf.min     ?? DEFAULT_MIN;
    const defW  = conf.default ?? DEFAULT_WIDTH;

    th.style.width    = defW + 'px';
    th.style.minWidth = minW + 'px';
    th.style.maxWidth = defW + 'px'; // initial max = default, overridden on drag
    th.style.position = 'relative';
    th.style.boxSizing = 'border-box';

    const handle = document.createElement('div');
    handle.className = 'disp-col-resize-handle';
    th.appendChild(handle);

    let startX, startW;

    handle.addEventListener('mousedown', e => {
      startX = e.clientX;
      startW = th.offsetWidth;
      handle.classList.add('dragging');

      const onMove = e => {
        const newW = Math.max(minW, startW + e.clientX - startX);
        th.style.width    = newW + 'px';
        th.style.minWidth = newW + 'px';
        th.style.maxWidth = newW + 'px';
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
      e.stopPropagation();
    });
  });
}

/* ================================================================
   SECTION BUILDERS
   buildAmbulanceSection   — builds ASM/ASI/MM/PMA table section.
                             Dynamically sizes soccorritore and
                             extra columns to fit actual crew.
   buildSAPSection_labeled — builds SAP/BICI table section with
                             volontario and extra columns.
   buildLDCSection         — builds LDC/PCA coordinator section.
   buildPoolSection        — builds a flat grid for unstructured
                             groups (ALTRO, non assegnati).
   buildSection            — shared section wrapper with header,
                             badge count, and scrollable table.
================================================================ */
function buildAmbulanceSection(title, resources, byResource, includeTarga = true) {
  let maxSocc = 1;
  let maxExtra = 0;
  resources.forEach(r => {
    const crew    = byResource[r.id] || [];
    const socc    = crew.filter(p => ['soccorritore','volontario_generico'].includes(p.role));
    const extras  = crew.filter(p => !['autista','infermiere','medico','soccorritore','volontario_generico'].includes(p.role));
    maxSocc  = Math.max(maxSocc, socc.length);
    maxExtra = Math.max(maxExtra, extras.length);
  });

  const soccHeaders  = Array.from({ length: maxSocc },  () => `<th>Soccorritore</th>`).join('');
  const extraHeaders = Array.from({ length: maxExtra }, () => `<th>Altro</th>`).join('');
  const headers = `
    <th class="disp-col-resource">Risorsa</th>
    ${buildResourceInfoHeaders(includeTarga)}
    <th>Autista</th>
    ${soccHeaders}
    <th>Infermiere</th>
    <th>Medico</th>
    ${extraHeaders}`;

  const rows = resources.map(r => {
    const crew      = byResource[r.id] || [];
    const autista   = crew.find(p => p.role === 'autista') || null;
    const infermiere = crew.find(p => p.role === 'infermiere') || null;
    const medico    = crew.find(p => p.role === 'medico') || null;
    const socc      = crew.filter(p => ['soccorritore','volontario_generico'].includes(p.role));
    const extras    = crew.filter(p => !['autista','infermiere','medico','soccorritore','volontario_generico'].includes(p.role));

    const soccCells  = Array.from({ length: maxSocc },  (_, i) => `<td class="person-cell">${buildPersonCard(socc[i] || null)}</td>`).join('');
    const extraCells = Array.from({ length: maxExtra }, (_, i) => `<td class="person-cell">${buildPersonCard(extras[i] || null)}</td>`).join('');

    return `<tr>
      <td class="disp-resource-name">
        ${r.resource}
        <button class="disp-resource-edit-btn" onclick="openResourceModal('${r.id}')" title="Modifica">✎</button>
      </td>
      ${buildResourceInfoCells(r, includeTarga)}
      <td class="person-cell">${buildPersonCard(autista)}</td>
      ${soccCells}
      <td class="person-cell">${buildPersonCard(infermiere)}</td>
      <td class="person-cell">${buildPersonCard(medico)}</td>
      ${extraCells}
    </tr>`;
  }).join('');

  return buildSection(title, headers, rows);
}

function buildSAPSection_labeled(title, resources, byResource) {
  let maxCols = 1, maxExtra = 0;
  resources.forEach(r => {
    const crew   = byResource[r.id] || [];
    const main   = crew.filter(p => ['soccorritore','opem'].includes(p.role));
    const extras = crew.filter(p => !['soccorritore','opem'].includes(p.role));
    maxCols  = Math.max(maxCols, main.length);
    maxExtra = Math.max(maxExtra, extras.length);
  });

  const mainHeaders  = Array.from({ length: maxCols },  () => `<th>Volontario</th>`).join('');
  const extraHeaders = Array.from({ length: maxExtra }, () => `<th>Altro</th>`).join('');
  const headers = `
    <th class="disp-col-resource">Risorsa</th>
    ${buildResourceInfoHeaders(false)}
    ${mainHeaders}${extraHeaders}`;

  const rows = resources.map(r => {
    const crew   = byResource[r.id] || [];
    const main   = crew.filter(p => ['soccorritore','opem'].includes(p.role));
    const extras = crew.filter(p => !['soccorritore','opem'].includes(p.role));
    const mainCells  = Array.from({ length: maxCols },  (_, i) => `<td class="person-cell">${buildPersonCard(main[i] || null)}</td>`).join('');
    const extraCells = Array.from({ length: maxExtra }, (_, i) => `<td class="person-cell">${buildPersonCard(extras[i] || null)}</td>`).join('');
    return `<tr>
      <td class="disp-resource-name">
        ${r.resource}
        <button class="disp-resource-edit-btn" onclick="openResourceModal('${r.id}')" title="Modifica">✎</button>
      </td>
      ${buildResourceInfoCells(r, false)}
      ${mainCells}${extraCells}
    </tr>`;
  }).join('');

  return buildSection(title, headers, rows);
}

function buildLDCSection(resources, byResource, title = 'LDC — Coordinatori / PCA') {
  let maxCols = 2;
  resources.forEach(r => {
    maxCols = Math.max(maxCols, (byResource[r.id] || []).length);
  });

  const headers = `
    <th class="disp-col-resource">Risorsa</th>
    ${buildResourceInfoHeaders(false)}
    ${Array.from({ length: maxCols }, () => `<th>Volontario</th>`).join('')}`;

  const rows = resources.map(r => {
    const crew = byResource[r.id] || [];
    const cells = Array.from({ length: maxCols }, (_, i) =>
      `<td class="person-cell">${buildPersonCard(crew[i] || null)}</td>`).join('');
    return `<tr>
      <td class="disp-resource-name">
        ${r.resource}
        <button class="disp-resource-edit-btn" onclick="openResourceModal('${r.id}')" title="Modifica">✎</button>
      </td>
      ${buildResourceInfoCells(r, false)}
      ${cells}
    </tr>`;
  }).join('');

  return buildSection(title, headers, rows);
}

function buildPoolSection(title, people) {
  const MAX_COLS = 5;
  const headers = Array.from({ length: MAX_COLS }, () => `<th>Volontario</th>`).join('');
  const numRows = Math.ceil(people.length / MAX_COLS);
  let rows = '';
  for (let row = 0; row < numRows; row++) {
    const cells = Array.from({ length: MAX_COLS }, (_, col) => {
      const p = people[row * MAX_COLS + col];
      return `<td class="person-cell">${buildPersonCard(p || null)}</td>`;
    }).join('');
    rows += `<tr>${rows}</tr>`;
  }
  return buildSection(title, headers, rows, people.length);
}

function buildSection(title, headers, rows, count) {
  const badge = count !== undefined ? count : (rows.match(/<tr>/g) || []).length;
  return `
    <div class="disp-section">
      <div class="disp-section-header">
        <span class="disp-section-title">${title}</span>
        <span class="side-badge">${badge}</span>
      </div>
      <div class="disp-table-wrapper">
        <table class="disp-table">
          <thead><tr>${headers}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ================================================================
   PERSON CARD
   PERSONNEL_ROLES — allowed role values for the dropdown.
   buildPersonCard — renders a clickable person card with name,
                     comitato, phone and qualifications.
                     Empty slots show a + button to add personnel.
================================================================ */
function buildPersonCard(p) {
  if (!p) return `<div class="disp-person disp-empty">—</div>`;

  const ana    = p.anagrafica || {};
  const status = p.status || 'scheduled';
  const bg     = STATUS_COLORS[status];
  const comp   = ana.competenza_attivazione
    ? `<span class="disp-person-comp comp-${ana.competenza_attivazione}">${ana.competenza_attivazione}</span>`
    : '';

  return `
    <div class="disp-person disp-clickable" data-status="${status}"
      style="background:${bg};"
      onclick="openPersonModal('${p.id}')">
      <div class="disp-person-name">${ana.surname || ''} ${ana.name || ''}</div>
      ${p.role ? `<div class="disp-person-meta">${p.role}</div>` : ''}
      ${ana.comitato ? `<div class="disp-person-meta">${ana.comitato}</div>` : ''}
      ${ana.number ? `<div class="disp-person-meta">
        <a href="tel:${ana.number}" class="disp-phone" onclick="event.stopPropagation()">${ana.number}</a>
      </div>` : ''}
      ${comp}
    </div>`;
}


/* ================================================================
   PERSON MODAL
   _allDispResources  — local cache of resources for the dropdown,
                        populated on each modal open.
   openPersonModal    — fetches resources and optional person data,
                        renders the edit/create form modal.
   savePersonnel      — inserts or updates a personnel row,
                        refreshes the full dispositivo view.
   deletePersonnel    — deletes a personnel row after confirmation.
================================================================ */
async function openPersonModal(personnelId) {
  const person = await fetchPersonnelById(personnelId);
  if (!person) return;

  const ana    = person.anagrafica || {};
  const status = person.status || 'scheduled';

  document.getElementById('disp-modal-title').textContent =
    `${ana.surname} ${ana.name}`;

  document.getElementById('disp-modal-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
      <div><span class="form-label">Ruolo</span>
        <div style="font-size:13px;margin-top:2px;">${person.role || '—'}</div></div>
      <div><span class="form-label">Comitato</span>
        <div style="font-size:13px;margin-top:2px;">${ana.comitato || '—'}</div></div>
      <div><span class="form-label">Telefono</span>
        <div style="font-size:13px;margin-top:2px;">${ana.number || '—'}</div></div>
      <div><span class="form-label">Qualifiche</span>
        <div style="font-size:13px;margin-top:2px;">${ana.qualifications || '—'}</div></div>
      <div><span class="form-label">Competenza</span>
        <div style="font-size:13px;margin-top:2px;">${ana.competenza_attivazione || '—'}</div></div>
      <div><span class="form-label">Risorsa</span>
        <div style="font-size:13px;margin-top:2px;">${person.resource_days?.resources?.resource || '—'}</div></div>
    </div>
    <div class="form-group">
      <label>Stato</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
        ${['scheduled','activated','cancelled','no_show'].map(s => `
          <button class="pca-yn-btn ${status === s ? 'active-yes' : ''}"
            id="status-btn-${s}"
            onclick="selectPersonnelStatus('${s}')">
            ${STATUS_LABELS[s]}
          </button>`).join('')}
      </div>
    </div>
    <div id="dp-error" class="error-msg"></div>`;

  const saveBtn = document.getElementById('disp-modal-save');
  saveBtn.onclick = () => savePersonnelStatus(personnelId);
  saveBtn._selectedStatus = status;

  const delBtn = document.getElementById('disp-modal-delete');
  delBtn.style.display = 'none';

  document.getElementById('modal-disp-person').classList.remove('hidden');
}

function selectPersonnelStatus(status) {
  document.querySelectorAll('[id^="status-btn-"]').forEach(b => b.classList.remove('active-yes'));
  document.getElementById(`status-btn-${status}`)?.classList.add('active-yes');
  document.getElementById('disp-modal-save')._selectedStatus = status;
}

async function savePersonnelStatus(personnelId) {
  const saveBtn = document.getElementById('disp-modal-save');
  const status  = saveBtn._selectedStatus;
  if (!status) return;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvataggio...';

  const ok = await updatePersonnelStatus(personnelId, status);
  saveBtn.disabled = false;
  saveBtn.textContent = 'Salva';

  if (!ok) {
    document.getElementById('dp-error').textContent = 'Errore durante il salvataggio.';
    return;
  }

  showToast('Stato aggiornato ✓', 'success');
  document.getElementById('modal-disp-person').classList.add('hidden');
  await renderDispositivo();
}


/* ================================================================
   RESOURCE MODAL
   openResourceModal — renders the resource edit modal (position,
                       coordinator, schedule, email, notes).
   saveResource      — updates the resource row, handles geom
                       construction from lat/lng inputs.
================================================================ */
let _allDispResources = [];

async function openResourceModal(resourceId) {
  const r = _allDispResources.find(r => r.id === resourceId);
  if (!r) return;

  const ldcs = _allDispResources.filter(r => r.resource_type === 'LDC');
  const coordOpts = `<option value="">— Nessuno —</option>` +
    ldcs.map(ldc => `<option value="${ldc.id}"
      ${r.coordinator?.resource === ldc.resource ? 'selected' : ''}>
      ${ldc.resource}</option>`).join('');

  document.getElementById('disp-modal-title').textContent = r.resource;
  document.getElementById('disp-modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label>Lat</label>
        <input type="number" id="dr-lat" step="any"
          value="${r.geom?.coordinates?.[1] || ''}" placeholder="41.8902" />
      </div>
      <div class="form-group">
        <label>Lng</label>
        <input type="number" id="dr-lng" step="any"
          value="${r.geom?.coordinates?.[0] || ''}" placeholder="12.4923" />
      </div>
    </div>
    <div class="form-group">
      <label>Coordinatore</label>
      <select id="dr-coordinator">${coordOpts}</select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Inizio operatività</label>
        <input type="text" id="dr-start"
          value="${r.start_time ? formatDispDateTime(r.start_time) : ''}"
          placeholder="DD/MM/YYYY HH:MM" />
      </div>
      <div class="form-group">
        <label>Fine operatività</label>
        <input type="text" id="dr-end"
          value="${r.end_time ? formatDispDateTime(r.end_time) : ''}"
          placeholder="DD/MM/YYYY HH:MM" />
      </div>
    </div>
    <div class="form-group">
      <label>Email associata</label>
      <input type="email" id="dr-email" value="${r.user_email || ''}" />
    </div>
    <div class="form-group">
      <label>Note</label>
      <textarea id="dr-notes" rows="2">${r.notes || ''}</textarea>
    </div>
    <div id="dr-error" class="error-msg"></div>`;

  document.getElementById('disp-modal-save').onclick = () => saveResource(resourceId);
  document.getElementById('disp-modal-delete').style.display = 'none';
  document.getElementById('modal-disp-person').classList.remove('hidden');
}

async function saveResource(resourceId) {
  const errEl = document.getElementById('dr-error');
  errEl.textContent = '';

  const lat   = parseFloat(document.getElementById('dr-lat').value);
  const lng   = parseFloat(document.getElementById('dr-lng').value);
  const start = parseDispDateTime(document.getElementById('dr-start').value.trim());
  const end   = parseDispDateTime(document.getElementById('dr-end').value.trim());

  if (document.getElementById('dr-start').value.trim() && !start) {
    errEl.textContent = 'Formato orario non valido. Usa DD/MM/YYYY HH:MM'; return;
  }
  if (document.getElementById('dr-end').value.trim() && !end) {
    errEl.textContent = 'Formato orario non valido. Usa DD/MM/YYYY HH:MM'; return;
  }

  const saveBtn = document.getElementById('disp-modal-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvataggio...';

  const payload = {
    coordinator_id: document.getElementById('dr-coordinator').value || null,
    user_email:     document.getElementById('dr-email').value.trim() || null,
    notes:          document.getElementById('dr-notes').value.trim() || null,
    start_time:     start,
    end_time:       end,
  };
  if (!isNaN(lat) && !isNaN(lng)) payload.geom = `POINT(${lng} ${lat})`;

  const result = await updateResourceDetails(resourceId, payload);
  saveBtn.disabled = false;
  saveBtn.textContent = 'Salva';

  if (!result) { errEl.textContent = 'Errore durante il salvataggio.'; return; }
  showToast('Risorsa aggiornata ✓', 'success');
  document.getElementById('modal-disp-person').classList.add('hidden');
  await renderDispositivo();
}

/* ================================================================
   HELPERS
   parseDispDateTime  — parses DD/MM/YYYY HH:MM → ISO string.
   formatDispDateTime — formats ISO string → DD/MM/YYYY HH:MM.
================================================================ */
function parseDispDateTime(str) {
  if (!str) return null;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`).toISOString();
}

function formatDispDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function initDispResize() {
  document.querySelectorAll('.disp-table th').forEach(th => {
    th.style.position   = 'relative';
    th.style.userSelect = 'none';
    const handle = document.createElement('div');
    handle.style.cssText = `position:absolute;right:0;top:0;width:5px;height:100%;cursor:col-resize;`;
    let startX, startW;
    handle.addEventListener('mousedown', e => {
      startX = e.pageX; startW = th.offsetWidth;
      const onMove = ev => { th.style.width = Math.max(40, startW + ev.pageX - startX) + 'px'; };
      const onUp   = ()  => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
    th.appendChild(handle);
  });
}
