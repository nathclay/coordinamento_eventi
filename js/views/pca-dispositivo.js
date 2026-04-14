/* ================================================================
   js/views/pca-dispositivo.js  —  Dispositivo page
   Static personnel view grouped by resource type.
   Mounted by router.js into #page-content.
================================================================ */

/* ── MOUNT ─────────────────────────────────────────────────── */
async function mountDispositivo(container) {
    container.innerHTML = `
    <div class="disp-page">
        <div class="disp-header">
        <h2 class="disp-title">Dispositivo</h2>
        <div style="display:flex;gap:8px;">
            <button class="btn-secondary" onclick="openPersonnelImportModal()"
            style="font-size:11px;padding:5px 12px;">↑ Importa personale</button>
            <button class="btn-secondary" onclick="openResourcesImportModal()"
            style="font-size:11px;padding:5px 12px;">↑ Importa risorse</button>
        </div>
        <span class="disp-updated" id="disp-updated">—</span>
        </div>
        <div class="disp-body" id="disp-body">
        <div class="empty-state">Caricamento...</div>
        </div>
    </div>`;

  await renderDispositivo();
}

/* ── MAIN RENDER ───────────────────────────────────────────── */
async function renderDispositivo() {
    const body = document.getElementById('disp-body');
    if (!body) return;

    // Fetch all resources for this event (excluding PCA)
    const { data: resources, error: resError } = await db
    .from('resources')
    .select('id, resource, resource_type, geom, notes, user_email, targa, start_time, end_time, coordinator:coordinator_id(resource)')
    .eq('event_id', PCA.eventId)
    .order('resource');
    // Fetch all personnel for this event
        const { data: personnel, error: perError } = await db
        .from('personnel')
        .select('id, name, surname, comitato, number, qualifications, role, resource_fk:resource')
        .eq('event_id', PCA.eventId)
        .order('surname');

    if (resError || perError) {
        body.innerHTML = `<div class="empty-state">Errore nel caricamento</div>`;
        return;
    }
    const updatedEl = document.getElementById('disp-updated');
    if (updatedEl) updatedEl.textContent =
        `Aggiornato alle ${formatTime(new Date().toISOString())}`;

    const allResources = resources || [];
    const allPersonnel = personnel || [];
    _allDispResources = allResources;
    // Group personnel by resource_id
    const byResource = {};
    Object.keys(byResource)
    allPersonnel.forEach(p => {
    const key = p.resource_fk || '__unassigned__';
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

  // ASM
  if (byType['ASM']?.length > 0)
    sections.push(buildAmbulanceSection('ASM', byType['ASM'], byResource));

  // ASI
  if (byType['ASI']?.length > 0)
    sections.push(buildAmbulanceSection('ASI', byType['ASI'], byResource));

  // SAP
  if (byType['SAP']?.length > 0)
    sections.push(buildSAPSection(byType['SAP'], byResource));

  // LDC
  if (byType['LDC']?.length > 0)
    sections.push(buildLDCSection(byType['LDC'], byResource));

  // ALTRO — pool all personnel from ALTRO resources
  if (byType['ALTRO']?.length > 0) {
    const altroPeople = byType['ALTRO']
      .flatMap(r => byResource[r.id] || []);
    sections.push(buildPoolSection('Altro', altroPeople));
  }

  // BICI / MM — simple pool
  ['BICI', 'MM'].forEach(type => {
    if (byType[type]?.length > 0) {
      const people = byType[type].flatMap(r => byResource[r.id] || []);
      if (people.length > 0)
        sections.push(buildPoolSection(type, people));
    }
  });

  // Non assegnato
  const unassigned = byResource['__unassigned__'] || [];
  sections.push(buildPoolSection('Non assegnati', unassigned));

  body.innerHTML = sections.join('') ||
    '<div class="empty-state">Nessun personale registrato</div>';
  initDispResize();
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
  const { error } = await db
    .from('resources')
    .update({ coordinator_id: coordinatorId || null })
    .eq('id', resourceId);

  if (error) { showToast('Errore aggiornamento coordinatore', 'error'); return; }
  showToast('Coordinatore aggiornato ✓', 'success');

  // Update local cache so re-renders stay in sync
  const r = _allDispResources.find(r => r.id === resourceId);
  if (r) {
    const ldc = _allDispResources.find(l => l.id === coordinatorId);
    r.coordinator = ldc ? { id: ldc.id, resource: ldc.resource } : null;
  }
}

function buildResourceInfoHeaders(includesTarga = false) {
  return `
    <th>Posizione</th>
    <th>Coordinatore</th>
    <th>Orario</th>
    <th>Email</th>
    <th>Note</th>
    ${includesTarga ? '<th>Targa</th>' : ''}`;
}

/*Resize columsns */

// Default widths and minimums per column header text
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

/* ── PERSON CARD ───────────────────────────────────────────── */
/* ROLES  */
const PERSONNEL_ROLES = [
  'Autista', 'Soccorritore', 'Infermiere', 'Medico',
  'OPEM', 'Coordinatore', 'Altro'
];

function buildPersonCard(p, resourceId = null, suggestedRole = null) {
  if (!p) {
    if (!resourceId) return `<div class="disp-person disp-empty">—</div>`;
    // Empty cell — click to create new person
    return `
      <div class="disp-person disp-empty disp-clickable"
        onclick="openPersonModal(null, '${resourceId}', '${suggestedRole || ''}')">
        <span style="font-size:16px;color:var(--border-bright);">+</span>
      </div>`;
  }
  return `
    <div class="disp-person disp-clickable"
      onclick="openPersonModal('${p.id}')">
      <div class="disp-person-name">${p.surname} ${p.name}</div>
      ${p.comitato    ? `<div class="disp-person-meta">${p.comitato}</div>` : ''}
      ${p.number      ? `<div class="disp-person-meta">
        <a href="tel:${p.number}" class="disp-phone" onclick="event.stopPropagation()">
          ${p.number}</a></div>` : ''}
      ${p.qualifications ? `<div class="disp-person-qual">${p.qualifications}</div>` : ''}
    </div>`;
}


/* ── ASM / ASI SECTION ─────────────────────────────────────── */
function buildAmbulanceSection(type, resources, byResource) {
    // Calculate maxSocc and maxExtras across all resources
    let maxSocc   = 2;
    let maxExtras = 0;

    resources.forEach(r => {
        const crew = byResource[r.id] || [];
        const socc = crew.filter(p => p.role?.toLowerCase() === 'soccorritore');
        const placed = new Set([
        crew.find(p => p.role?.toLowerCase() === 'autista')?.id,
        ...socc.map(p => p.id),
        crew.find(p => p.role?.toLowerCase() === 'infermiere')?.id,
        crew.find(p => p.role?.toLowerCase() === 'medico')?.id,
        ].filter(Boolean));
        const extras = crew.filter(p => !placed.has(p.id));
        maxSocc   = Math.max(maxSocc, socc.length);
        maxExtras = Math.max(maxExtras, extras.length);
    });

    const soccHeaders  = Array.from({ length: maxSocc },
        () => `<th>Soccorritore</th>`).join('');
    const extraHeaders = Array.from({ length: maxExtras },
        () => `<th>Altro</th>`).join('');

    const headers = `
        <th class="disp-col-resource">Risorsa</th>
        ${buildResourceInfoHeaders(true)}
        <th>Autista</th>
        ${soccHeaders}
        <th>Infermiere</th>
        <th>Medico</th>
        ${extraHeaders}`;

    const rows = resources.map(r => {
    const crew = byResource[r.id] || [];

    const autista    = crew.find(p => p.role?.toLowerCase() === 'autista') || null;
    const socc       = crew.filter(p => p.role?.toLowerCase() === 'soccorritore');
    const infermiere = crew.find(p => p.role?.toLowerCase() === 'infermiere') || null;
    const medico     = crew.find(p => p.role?.toLowerCase() === 'medico') || null;

    const placed = new Set([
      autista?.id, ...socc.map(p => p.id),
      infermiere?.id, medico?.id,
    ].filter(Boolean));
    const extras = crew.filter(p => !placed.has(p.id));

    const soccCells  = Array.from({ length: maxSocc }, (_, i) =>
      `<td>${buildPersonCard(socc[i] || null, r.id, 'Soccorritore')}</td>`).join('');
    const extraCells = Array.from({ length: maxExtras }, (_, i) =>
    `<td>${buildPersonCard(extras[i] || null, r.id, 'Altro')}</td>`).join('');

    return `<tr>
    <td class="disp-resource-name">${r.resource}</td>
    ${buildResourceInfoCells(r, type === 'ASM' || type === 'ASI')}
    <td>${buildPersonCard(autista,    r.id, 'Autista')}</td>
    ${soccCells}
    <td>${buildPersonCard(infermiere, r.id, 'Infermiere')}</td>
    <td>${buildPersonCard(medico,     r.id, 'Medico')}</td>
    ${extraCells}
    </tr>`;
  }).join('');

  return buildSection(type, headers, rows);
}
/* ── SAP SECTION ───────────────────────────────────────────── */
function buildSAPSection(resources, byResource) {
  let maxCols   = 4;
  let maxExtras = 0;

  resources.forEach(r => {
    const crew = byResource[r.id] || [];
    const known = crew.filter(p =>
      ['soccorritore','opem'].includes(p.role?.toLowerCase()));
    const extras = crew.filter(p =>
      !['soccorritore','opem'].includes(p.role?.toLowerCase()));
    maxCols   = Math.max(maxCols, known.length);
    maxExtras = Math.max(maxExtras, extras.length);
  });

  const volHeaders   = Array.from({ length: maxCols },
    () => `<th>Volontario</th>`).join('');
  const extraHeaders = Array.from({ length: maxExtras },
    () => `<th>Altro</th>`).join('');

  const headers = `
    <th class="disp-col-resource">Risorsa</th>
    ${buildResourceInfoHeaders(false)}
    ${volHeaders}
    ${extraHeaders}`;

  const rows = resources.map(r => {
    const crew = byResource[r.id] || [];
    const ordered = [
      ...crew.filter(p => p.role?.toLowerCase() === 'soccorritore'),
      ...crew.filter(p => p.role?.toLowerCase() === 'opem'),
    ];
    const extras = crew.filter(p =>
      !['soccorritore','opem'].includes(p.role?.toLowerCase()));

    const mainCells = Array.from({ length: maxCols }, (_, i) =>
    `<td>${buildPersonCard(ordered[i] || null, r.id, i < crew.filter(p => p.role?.toLowerCase() === 'soccorritore').length ? 'Soccorritore' : 'OPEM')}</td>`
    ).join('');
    const extraCells = Array.from({ length: maxExtras }, (_, i) =>
    `<td>${buildPersonCard(extras[i] || null, r.id, 'Altro')}</td>`).join('');

    return `<tr>
      <td class="disp-resource-name">${r.resource}</td>
      ${buildResourceInfoCells(r, false)}
      ${mainCells}
      ${extraCells}
    </tr>`;
  }).join('');

  return buildSection('SAP', headers, rows);
}

/* ── LDC SECTION ───────────────────────────────────────────── */
function buildLDCSection(resources, byResource) {
  // Determine max columns, minimum 3
  let maxCols = 3;
  resources.forEach(r => {
    const crew = byResource[r.id] || [];
    maxCols = Math.max(maxCols, crew.length);
  });

  const volHeaders = Array.from({ length: maxCols },
    () => `<th>Volontario</th>`).join('');
  const headers = `
    <th class="disp-col-resource">Risorsa</th>
    ${buildResourceInfoHeaders(false)}
    ${volHeaders}`;

  const rows = resources.map(r => {
    const crew = byResource[r.id] || [];
    const cells = Array.from({ length: maxCols }, (_, i) =>
    `<td>${buildPersonCard(crew[i] || null, r.id, 'Coordinatore')}</td>`
    ).join('');

    return `<tr>
      <td class="disp-resource-name">${r.resource}</td>
      ${buildResourceInfoCells(r, false)}
      ${cells}
    </tr>`;
  }).join('');

  return buildSection('LDC — Coordinatori', headers, rows);
}

/* ── POOL SECTION (ALTRO, BICI, MM, Non assegnati) ─────────── */
function buildPoolSection(title, people) {
  const MAX_COLS = 5;

  if (people.length === 0 && title !== 'Non assegnati') return '';

  if (people.length === 0) {
    return `
      <div class="disp-section">
        <div class="disp-section-header">
          <span class="disp-section-title">${title}</span>
          <span class="side-badge">0</span>
        </div>
        <div class="empty-state" style="padding:16px;">Nessun personale</div>
      </div>`;
  }

  // Build headers
  const headers = Array.from({ length: MAX_COLS },
    () => `<th>Volontario</th>`).join('');

  // Fill grid left-to-right, top-to-bottom
  const numRows = Math.ceil(people.length / MAX_COLS);
  let rows = '';
  for (let row = 0; row < numRows; row++) {
    const cells = Array.from({ length: MAX_COLS }, (_, col) => {
      const idx = row * MAX_COLS + col;
      return `<td>${buildPersonCard(people[idx] || null)}</td>`;
    }).join('');
    rows += `<tr>${cells}</tr>`;
  }

  return buildSection(title, headers, rows, people.length);
}

/* ── SECTION WRAPPER ───────────────────────────────────────── */
function buildSection(title, headers, rows, count) {
  const badge = count !== undefined ? count :
    (rows.match(/<tr>/g) || []).length;

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

/* ── PERSON MODAL ──────────────────────────────────────────── */
let _allDispResources = []; // cached for the resource dropdown

async function openPersonModal(personnelId, presetResourceId = null, presetRole = null) {
  // Fetch all resources for dropdown
  const { data: resources } = await db
    .from('resources')
    .select('id, resource, resource_type')
    .eq('event_id', PCA.eventId)
    .order('resource');
  _allDispResources = resources || [];

  let person = null;
  if (personnelId) {
    const { data } = await db
      .from('personnel')
      .select('*')
      .eq('id', personnelId)
      .single();
    person = data;
  }

  const isNew   = !person;
  const title   = isNew ? 'Nuovo personale' : `${person.name} ${person.surname}`;
  const resOpts = _allDispResources.map(r =>
    `<option value="${r.id}"
      ${(person?.resource || presetResourceId) === r.id ? 'selected' : ''}>
      ${r.resource} (${r.resource_type})
    </option>`).join('');

  const roleOpts = PERSONNEL_ROLES.map(role =>
    `<option value="${role}"
      ${(person?.role || presetRole) === role ? 'selected' : ''}>
      ${role}
    </option>`).join('');

  document.getElementById('disp-modal-title').textContent = title;
  document.getElementById('disp-modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label>Nome <span style="color:var(--red)">*</span></label>
        <input type="text" id="dp-name" value="${person?.name || ''}" placeholder="Nome" />
      </div>
      <div class="form-group">
        <label>Cognome <span style="color:var(--red)">*</span></label>
        <input type="text" id="dp-surname" value="${person?.surname || ''}" placeholder="Cognome" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Codice Fiscale</label>
        <input type="text" id="dp-cf" value="${person?.cf || ''}" placeholder="-" 
          style="text-transform:uppercase" />
      </div>
      <div class="form-group">
        <label>Ruolo</label>
        <select id="dp-role">${roleOpts}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Comitato</label>
        <input type="text" id="dp-comitato" value="${person?.comitato || ''}" placeholder="-" />
      </div>
      <div class="form-group">
        <label>Telefono</label>
        <input type="tel" id="dp-number" value="${person?.number || ''}" placeholder="-" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="dp-email" value="${person?.email || ''}" placeholder="mario@example.com" />
      </div>
      <div class="form-group">
        <label>Qualifiche</label>
        <input type="text" id="dp-qualifications" value="${person?.qualifications || ''}" 
          placeholder="Es. BLSD, PTC" />
      </div>
    </div>
    <div class="form-group">
      <label>Risorsa assegnata</label>
      <select id="dp-resource">${resOpts}</select>
    </div>
    <div id="dp-error" class="error-msg"></div>`;

  const saveBtn = document.getElementById('disp-modal-save');
  saveBtn.onclick = () => savePersonnel(personnelId);

  // Show delete button only for existing person
  const delBtn = document.getElementById('disp-modal-delete');
  if (isNew) {
    delBtn.style.display = 'none';
  } else {
    delBtn.style.display = 'block';
    delBtn.onclick = () => deletePersonnel(personnelId);
  }

  document.getElementById('modal-disp-person').classList.remove('hidden');
}

/* ── SAVE ──────────────────────────────────────────────────── */
async function savePersonnel(personnelId) {
  const name    = document.getElementById('dp-name').value.trim();
  const surname = document.getElementById('dp-surname').value.trim();
  const errEl   = document.getElementById('dp-error');
  errEl.textContent = '';

  if (!name)    { errEl.textContent = 'Nome obbligatorio.';    return; }
  if (!surname) { errEl.textContent = 'Cognome obbligatorio.'; return; }

  const saveBtn = document.getElementById('disp-modal-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvataggio...';

  const payload = {
    name,
    surname,
    cf:             document.getElementById('dp-cf').value.trim().toUpperCase() || null,
    role:           document.getElementById('dp-role').value || null,
    comitato:       document.getElementById('dp-comitato').value.trim() || null,
    number:         document.getElementById('dp-number').value.trim() || null,
    email:          document.getElementById('dp-email').value.trim() || null,
    qualifications: document.getElementById('dp-qualifications').value.trim() || null,
    resource:       document.getElementById('dp-resource').value || null,
  };

  let error;
  if (personnelId) {
    ({ error } = await db.from('personnel').update(payload).eq('id', personnelId));
  } else {
    payload.event_id = PCA.eventId;
    ({ error } = await db.from('personnel').insert(payload));
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Salva';

  if (error) { errEl.textContent = error.message; return; }

  showToast(personnelId ? 'Personale aggiornato ✓' : 'Personale aggiunto ✓', 'success');
  document.getElementById('modal-disp-person').classList.add('hidden');
  await renderDispositivo();
}

/* ── DELETE ────────────────────────────────────────────────── */
async function deletePersonnel(personnelId) {
  if (!confirm('Eliminare questo personale?')) return;

  const { error } = await db.from('personnel').delete().eq('id', personnelId);
  if (error) {
    document.getElementById('dp-error').textContent = error.message;
    return;
  }

  showToast('Personale eliminato', 'success');
  document.getElementById('modal-disp-person').classList.add('hidden');
  await renderDispositivo();
}