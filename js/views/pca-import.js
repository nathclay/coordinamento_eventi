/* ================================================================
   js/views/pca-import.js  —  CSV bulk import
   Two independent import flows sharing one modal:
     - Personnel: resolves resource names to IDs, upserts on CF.
     - Resources: two-pass insert (resources first, coordinators
       second) to resolve forward references.

   Called from pca-dispositivo.js (personnel + resources buttons).
   Depends on: supabase.js (db), pca.js (PCA, showToast)
================================================================ */


/* ================================================================
   RESOURCES IMPORT
   openResourcesImportModal — builds modal body for resource import.
   handleResourcesCSV       — parses CSV, validates type enum,
                              resolves radio channel names to IDs,
                              renders preview table.
   resetResourcesImport     — resets drop zone and clears state.
   confirmResourcesImport   — two-pass import: first inserts all
                              resources, then assigns coordinators
                              once all IDs are known.
================================================================ */
function openResourcesImportModal() {
  document.getElementById('import-modal-title').textContent = 'Importa Risorse';
  document.getElementById('import-modal-body').innerHTML = `
    <div class="import-info">
      <div class="import-info-title">Formato CSV richiesto</div>
      <p class="import-info-desc">
        File CSV con separatore <strong>,</strong>. 
        Colonne obbligatorie: <strong>nome</strong> e <strong>tipologia</strong>.
        Se una risorsa con lo stesso nome esiste già, verrà aggiornata.
      </p>
      <table class="import-cols-table">
        <thead><tr><th>Colonna</th><th>Obbligatorio</th><th>Formato</th><th>Note</th></tr></thead>
        <tbody>
          <tr><td>nome</td><td>✓</td><td>Testo</td><td>Nome risorsa (es. ASM-01)</td></tr>
          <tr><td>tipologia</td><td>✓</td><td>Testo</td><td>ASM · ASI · SAP · BICI · MM · PMA · LDC · PCA · ALTRO</td></tr>
          <tr><td>targa</td><td></td><td>Testo</td><td>—</td></tr>
          <tr><td>lat</td><td></td><td>Decimale</td><td>Latitudine iniziale risorsa (es. 41.8902)</td></tr>
          <tr><td>lng</td><td></td><td>Decimale</td><td>Longitudine iniziale risorsa(es. 12.4923)</td></tr>
          <tr><td>orario_inizio</td><td></td><td>DD/MM/YYYY HH:MM</td><td>Orario attivazione</td></tr>
          <tr><td>orario_fine</td><td></td><td>DD/MM/YYYY HH:MM</td><td>Orario previsto di fine</td></tr>
          <tr><td>coordinatore</td><td></td><td>Testo</td><td>Nome risorsa LDC (es. CHARLIE-01)</td></tr>
          <tr><td>canale_radio</td><td></td><td>Testo</td><td>Nome canale radio — deve esistere</td></tr>
          <tr><td>email_associata</td><td></td><td>Email</td><td>Email associata</td></tr>
          <tr><td>note</td><td></td><td>Testo</td><td>—</td></tr>
        </tbody>
      </table>
    </div>
    <div class="import-drop-zone" id="resources-drop-zone">
      <div class="import-drop-icon">📄</div>
      <div class="import-drop-text">Trascina il CSV qui o clicca per selezionare</div>
      <input type="file" id="resources-csv-input" accept=".csv" style="display:none" />
    </div>
    <div id="resources-import-preview" style="display:none;">
      <div class="import-preview-header">
        <span id="resources-preview-count"></span>
        <button class="btn-secondary" onclick="resetResourcesImport()">✕ Cambia file</button>
      </div>
      <div class="import-preview-scroll">
        <table class="import-preview-table" id="resources-preview-table"></table>
      </div>
    </div>
    <div id="resources-import-error" class="import-error"></div>
    <div id="resources-import-progress" style="display:none;">
      <div class="import-progress-bar">
        <div class="import-progress-fill" id="resources-progress-fill"></div>
      </div>
      <div class="import-progress-text" id="resources-progress-text">Importazione...</div>
    </div>`;

  const dropZone = document.getElementById('resources-drop-zone');
  const fileInput = document.getElementById('resources-csv-input');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleResourcesCSV(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleResourcesCSV(e.target.files[0]);
  });

  document.getElementById('import-modal-confirm').style.display = 'none';
  document.getElementById('import-modal-confirm').onclick = confirmResourcesImport;
  document.getElementById('modal-import').classList.remove('hidden');
}

const VALID_RESOURCE_TYPES = ['ASM','ASI','SAP','BICI','MM','PMA','LDC','PCA','ALTRO'];
let _resourcesImportRows = [];

async function handleResourcesCSV(file) {
  const text = await file.text();
  const errEl = document.getElementById('resources-import-error');
  errEl.textContent = '';

  const { headers, rows, error } = parseCSV(text);
  if (error) { errEl.textContent = error; return; }

  if (!headers.includes('nome') || !headers.includes('tipologia')) {
    errEl.textContent = 'Il CSV deve contenere le colonne "nome" e "tipologia".';
    return;
  }

  // Fetch radio channels for name→id resolution
  const { data: radioChannels } = await db
    .from('event_radio_channels')
    .select('id, channel_name')
    .eq('event_id', PCA.eventId);
  const radioMap = {};
  (radioChannels || []).forEach(c => {
    radioMap[c.channel_name.toLowerCase()] = c.id;
  });

  const parsed = [];
  const warnings = [];
  const errors_list = [];

  // First pass: collect all resource names for coordinator resolution within batch
  const batchResourceNames = {};
  rows.forEach(row => {
    const nome = cell(row, headers, 'nome')?.trim();
    if (nome) batchResourceNames[nome.toLowerCase()] = true;
  });

  rows.forEach((row, i) => {
    const lineNum = i + 2;
    const nome      = cell(row, headers, 'nome')?.trim();
    const tipologia = cell(row, headers, 'tipologia')?.trim().toUpperCase();

    if (!nome)      { warnings.push(`Riga ${lineNum}: nome mancante — saltata`); return; }
    if (!tipologia) { warnings.push(`Riga ${lineNum}: tipologia mancante — saltata`); return; }

    if (!VALID_RESOURCE_TYPES.includes(tipologia)) {
      errors_list.push(`Riga ${lineNum}: tipologia "${tipologia}" non valida`);
      return;
    }

    // Radio channel
    const radioName = cell(row, headers, 'canale_radio')?.trim();
    let radioId = null;
    if (radioName) {
      radioId = radioMap[radioName.toLowerCase()];
      if (!radioId) {
        errors_list.push(`Riga ${lineNum}: canale radio "${radioName}" non trovato`);
        return;
      }
    }

    // Parse orario
    const orarioInizio = parseItalianDateTime(cell(row, headers, 'orario_inizio')?.trim());
    const orarioFine   = parseItalianDateTime(cell(row, headers, 'orario_fine')?.trim());
    if (cell(row, headers, 'orario_inizio')?.trim() && !orarioInizio) {
      warnings.push(`Riga ${lineNum}: orario_inizio non valido — usa DD/MM/YYYY HH:MM`);
    }
    if (cell(row, headers, 'orario_fine')?.trim() && !orarioFine) {
      warnings.push(`Riga ${lineNum}: orario_fine non valido — usa DD/MM/YYYY HH:MM`);
    }

    // Parse lat/lng
    const lat = parseFloat(cell(row, headers, 'lat')?.trim());
    const lng = parseFloat(cell(row, headers, 'lng')?.trim());
    const hasGeom = !isNaN(lat) && !isNaN(lng);

    parsed.push({
      nome, tipologia,
      targa:          cell(row, headers, 'targa')?.trim() || null,
      lat:            hasGeom ? lat : null,
      lng:            hasGeom ? lng : null,
      orario_inizio:  orarioInizio,
      orario_fine:    orarioFine,
      coordinatore:   cell(row, headers, 'coordinatore')?.trim() || null,
      radio_id:       radioId,
      email:          cell(row, headers, 'email_associata')?.trim() || null,
      note:           cell(row, headers, 'note')?.trim() || null,
    });
  });

  if (errors_list.length > 0) {
    errEl.innerHTML = errors_list.map(e =>
      `<div class="import-error-line">✕ ${e}</div>`).join('');
    return;
  }

  _resourcesImportRows = parsed;

  if (warnings.length > 0) {
    errEl.innerHTML = warnings.map(w =>
      `<div class="import-warning">⚠ ${w}</div>`).join('');
  }

  document.getElementById('resources-drop-zone').style.display = 'none';
  document.getElementById('resources-import-preview').style.display = 'block';
  document.getElementById('resources-preview-count').textContent =
    `${parsed.length} risorse da importare`;

  const table = document.getElementById('resources-preview-table');
  table.innerHTML = `
    <thead><tr>
      <th>Nome</th><th>Tipo</th><th>Targa</th>
      <th>Posizione</th><th>Orario</th><th>Coordinatore</th><th>Email</th>
    </tr></thead>
    <tbody>
      ${parsed.map(r => `<tr>
        <td>${r.nome}</td>
        <td>${r.tipologia}</td>
        <td>${r.targa || '—'}</td>
        <td>${r.lat != null ? `${r.lat}, ${r.lng}` : '—'}</td>
        <td>${r.orario_inizio
          ? `${formatDateTime(r.orario_inizio)} — ${r.orario_fine ? formatDateTime(r.orario_fine) : '—'}`
          : '—'}</td>
        <td>${r.coordinatore || '—'}</td>
        <td>${r.email || '—'}</td>
      </tr>`).join('')}
    </tbody>`;

  document.getElementById('import-modal-confirm').style.display = 'block';
}

function resetResourcesImport() {
  _resourcesImportRows = [];
  document.getElementById('resources-drop-zone').style.display = 'flex';
  document.getElementById('resources-import-preview').style.display = 'none';
  document.getElementById('resources-import-error').textContent = '';
  document.getElementById('import-modal-confirm').style.display = 'none';
  document.getElementById('resources-csv-input').value = '';
}

async function confirmResourcesImport() {
  if (_resourcesImportRows.length === 0) return;

  const confirmBtn = document.getElementById('import-modal-confirm');
  confirmBtn.disabled = true;
  const progressEl = document.getElementById('resources-import-progress');
  const fillEl     = document.getElementById('resources-progress-fill');
  const textEl     = document.getElementById('resources-progress-text');
  progressEl.style.display = 'block';

  // Fetch existing resources by name for conflict detection
  const { data: existing } = await db
    .from('resources')
    .select('id, resource')
    .eq('event_id', PCA.eventId);
  const existingByName = {};
  (existing || []).forEach(r => { existingByName[r.resource.toLowerCase()] = r.id; });

  // First pass: insert/update all resources without coordinator
  // (coordinator references other resources which may not exist yet)
  const nameToId = { ...existingByName };
  let done = 0, errors = 0;
  const total = _resourcesImportRows.length;

  for (const r of _resourcesImportRows) {
    const payload = {
      resource:          r.nome,
      resource_type:     r.tipologia,
      targa:             r.targa,
      user_email:        r.email,
      notes:             r.note,
      radio_channel_id:  r.radio_id,
      start_time:        r.orario_inizio,
      end_time:          r.orario_fine,
      event_id:          PCA.eventId,
    };

    if (r.lat != null && r.lng != null) {
      payload.geom = `POINT(${r.lng} ${r.lat})`;
    }

    let error, data;
    const existingId = existingByName[r.nome.toLowerCase()];

    if (existingId) {
      ({ error } = await db.from('resources').update(payload).eq('id', existingId));
      nameToId[r.nome.toLowerCase()] = existingId;
    } else {
      ({ data, error } = await db.from('resources').insert(payload).select('id').single());
      if (data) nameToId[r.nome.toLowerCase()] = data.id;
    }

    if (error) { console.error('Resource import error:', error); errors++; }
    done++;
    fillEl.style.width = Math.round((done / total) * 100) + '%';
    textEl.textContent = `${done}/${total} risorse importate...`;
  }

  // Second pass: assign coordinators now that all resources have IDs
  for (const r of _resourcesImportRows) {
    if (!r.coordinatore) continue;
    const resourceId    = nameToId[r.nome.toLowerCase()];
    const coordinatorId = nameToId[r.coordinatore.toLowerCase()];
    if (!resourceId || !coordinatorId) {
      console.warn(`Coordinator "${r.coordinatore}" not found for "${r.nome}"`);
      continue;
    }
    await db.from('resources')
      .update({ coordinator_id: coordinatorId })
      .eq('id', resourceId);
  }

  confirmBtn.disabled = false;
  if (errors === 0) {
    showToast(`${done} risorse importate ✓`, 'success');
    document.getElementById('modal-import').classList.add('hidden');
  } else {
    textEl.textContent = `Completato: ${done - errors} importate, ${errors} errori.`;
  }
}

/* ================================================================
   CSV PARSER & HELPERS
   parseCSV             — splits CSV text into headers + row arrays.
   cell                 — safely reads a cell by column name.
   parseItalianDateTime — parses DD/MM/YYYY HH:MM → ISO string.
   formatDateTime       — formats ISO string for preview display.
================================================================ */
function parseCSV(text) {
  // Normalize line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').filter(l => l.trim());

  if (lines.length < 2) return { error: 'Il file CSV deve avere almeno una riga di intestazione e una di dati.' };

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const rows = lines.slice(1).map(line => line.split(',').map(v => v.trim()));

  return { headers, rows };
}

function cell(row, headers, key) {
  const idx = headers.indexOf(key);
  if (idx === -1) return null;
  return row[idx] || null;
}

function parseItalianDateTime(str) {
  if (!str) return null;
  // DD/MM/YYYY HH:MM
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min] = match;
  const date = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}