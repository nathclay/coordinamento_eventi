/* ================================================================
   js/views/pca-settings.js  —  Impostazioni page
================================================================ */

let _settingsEvent = null;

async function mountImpostazioni(container) {
  container.innerHTML = `
    <div class="settings-page">
      <div class="settings-header">
        <h2 class="settings-title">Impostazioni evento</h2>
      </div>
      <div class="settings-body" id="settings-body">
        <div class="empty-state">Caricamento...</div>
      </div>
    </div>`;
  await renderSettings();
}

async function renderSettings() {
  const body = document.getElementById('settings-body');
  if (!body) return;

  const { data: event, error } = await db
    .from('events')
    .select('id, name, is_route, is_grid, notes_general, notes_coordinators')
    .eq('id', PCA.eventId)
    .single();

  if (error) { body.innerHTML = `<div class="empty-state">Errore: ${error.message}</div>`; return; }
  _settingsEvent = event;

  body.innerHTML = `
    <!-- ── TOGGLES ── -->
    <div class="settings-card">
      <div class="settings-card-title">Modalità evento</div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span>Modalità gara</span>
          <span class="settings-row-desc">Abilita funzionalità specifiche per eventi agonistici</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="toggle-gara" ${event.is_route ? 'checked' : ''}
            onchange="saveEventToggle('is_route', this.checked)" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span>Modalità griglia</span>
          <span class="settings-row-desc">Abilita la griglia geografica sulla mappa</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="toggle-griglia" ${event.is_grid ? 'checked' : ''}
            onchange="saveEventToggle('is_grid', this.checked)" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- ── NOTES ── -->
    <div class="settings-card">
      <div class="settings-card-title">Note evento</div>
      <div class="settings-tabs">
        <button class="settings-tab active" onclick="switchNoteTab('general', this)">
          Note generali
        </button>
        <button class="settings-tab" onclick="switchNoteTab('coordinator', this)">
          Note coordinatori
        </button>
      </div>

      <div id="note-tab-general">
        <div class="settings-row-desc" style="margin-bottom:8px;">
          Visibili a tutti i moduli sul campo. Supporta grassetto, corsivo, link e liste.
        </div>
        ${buildRichEditor('editor-general', event.notes_general || '')}
        <button class="btn-primary" style="margin-top:8px;width:auto;padding:6px 16px;"
          onclick="saveNotes('general')">Salva note generali</button>
      </div>

      <div id="note-tab-coordinator" style="display:none;">
        <div class="settings-row-desc" style="margin-bottom:8px;">
          Visibili solo ai coordinatori LDC e PCA.
        </div>
        ${buildRichEditor('editor-coordinator', event.notes_coordinators || '')}
        <button class="btn-primary" style="margin-top:8px;width:auto;padding:6px 16px;"
          onclick="saveNotes('coordinator')">Salva note coordinatori</button>
      </div>
    </div>

    <!-- ── GEOMETRIES ── -->
    <div class="settings-card">
      <div class="settings-card-title">Geometrie</div>
      <div class="settings-row-desc" style="margin-bottom:12px;">
        Carica file GeoJSON. Ogni feature deve avere le proprietà indicate per ogni layer.
      </div>

      ${buildGeoUpload('route',     'Percorso evento',    'MultiLineString',    'event_route',     'name',  'Proprietà richiesta: <code>name</code>')}
      ${buildGeoUpload('markers',   'Marker percorso',    'Point',         'markers_route',   'label', 'Proprietà richieste: <code>km</code> (numero), <code>label</code> (opzionale)')}
      ${buildGeoUpload('fixed',     'Risorse fisse',      'Point',         'fixed_resources', 'label', 'Proprietà richiesta: <code>label</code>')}
      ${buildGeoUpload('grid',      'Griglia',            'MultiPolygon',  'grid',            'label', 'Proprietà richiesta: <code>label</code>')}
      ${buildGeoUpload('poi',       'Punti di interesse', 'Point',         'event_poi',       'name',  'Proprietà richieste: <code>name</code>, <code>poi_type</code> (opzionale)')}
    </div>`;

  // Init editors with content
  initEditor('editor-general',     event.notes_general     || '');
  initEditor('editor-coordinator', event.notes_coordinators || '');
}

/* ── TOGGLES ────────────────────────────────────────────────── */
async function saveEventToggle(field, value) {
  const { error } = await db
    .from('events')
    .update({ [field]: value })
    .eq('id', PCA.eventId);
  if (error) { showToast('Errore salvataggio', 'error'); return; }
  showToast(`${field === 'is_route' ? 'Modalità gara' : 'Griglia'} ${value ? 'attivata' : 'disattivata'} ✓`, 'success');
}

/* ── NOTES ──────────────────────────────────────────────────── */
function switchNoteTab(tab, btn) {
  document.getElementById('note-tab-general').style.display     = tab === 'general'     ? '' : 'none';
  document.getElementById('note-tab-coordinator').style.display = tab === 'coordinator' ? '' : 'none';
  document.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function buildRichEditor(id, content) {
  return `
    <div class="rich-editor-wrap">
      <div class="rich-toolbar">
        <button type="button" title="Grassetto"    onclick="editorCmd('${id}','bold')"><b>B</b></button>
        <button type="button" title="Corsivo"      onclick="editorCmd('${id}','italic')"><i>I</i></button>
        <button type="button" title="Sottolineato" onclick="editorCmd('${id}','underline')"><u>U</u></button>
        <div class="rich-toolbar-sep"></div>
        <button type="button" title="Lista"        onclick="editorCmd('${id}','insertUnorderedList')">≡</button>
        <button type="button" title="Link"         onclick="editorInsertLink('${id}')">🔗</button>
        <button type="button" title="Telefono"     onclick="editorInsertPhone('${id}')">📞</button>
        <div class="rich-toolbar-sep"></div>
        <button type="button" title="Pulisci"      onclick="editorCmd('${id}','removeFormat')">✕</button>
      </div>
      <div class="rich-editor" id="${id}" contenteditable="true"
        data-placeholder="Scrivi qui..."></div>
    </div>`;
}

function initEditor(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function editorCmd(id, cmd) {
  document.getElementById(id)?.focus();
  document.execCommand(cmd, false, null);
}

function editorInsertLink(id) {
  const url = prompt('URL link:');
  if (!url) return;
  document.getElementById(id)?.focus();
  document.execCommand('createLink', false, url);
  // Make link open in new tab
  const editor = document.getElementById(id);
  editor?.querySelectorAll('a').forEach(a => a.setAttribute('target', '_blank'));
}

function editorInsertPhone(id) {
  const raw = prompt('Numero di telefono:');
  if (!raw) return;
  const number = raw.trim();
  const href   = 'tel:' + number.replace(/\s+/g, '');
  const html   = `<a href="${href}" style="text-decoration:none;">📞 <span style="color:var(--blue);font-weight:600;">${number}</span></a>`;
  const editor = document.getElementById(id);
  if (!editor) return;
  editor.focus();
  document.execCommand('insertHTML', false, html);
}

async function saveNotes(tab) {
  const id    = tab === 'general' ? 'editor-general' : 'editor-coordinator';
  const field = tab === 'general' ? 'notes_general'  : 'notes_coordinators';
  const html  = document.getElementById(id)?.innerHTML || '';

  const { error } = await db
    .from('events')
    .update({ [field]: html })
    .eq('id', PCA.eventId);

  if (error) { showToast('Errore salvataggio note', 'error'); return; }
  showToast('Note salvate ✓', 'success');
}

/* ── GEOMETRY UPLOAD ─────────────────────────────────────────── */
function buildGeoUpload(key, label, geomType, table, primaryProp, hint) {
  return `
    <div class="geo-section" id="geo-section-${key}">
      <div class="geo-section-header" onclick="toggleGeoSection('${key}')">
        <span class="geo-section-title">${label}</span>
        <span class="geo-section-type">${geomType}</span>
        <span class="geo-chevron" id="geo-chevron-${key}">▸</span>
      </div>
      <div class="geo-section-body" id="geo-body-${key}" style="display:none;">
        <div class="settings-row-desc" style="margin-bottom:8px;">${hint}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <input type="file" id="geo-file-${key}" accept=".geojson,.json"
            onchange="previewGeoJSON('${key}','${table}','${geomType}','${primaryProp}')"
            style="font-size:11px;color:var(--text-secondary);" />
        </div>
        <div id="geo-preview-${key}"></div>
      </div>
    </div>`;
}

function toggleGeoSection(key) {
  const body    = document.getElementById(`geo-body-${key}`);
  const chevron = document.getElementById(`geo-chevron-${key}`);
  const open    = body.style.display !== 'none';
  body.style.display    = open ? 'none' : '';
  chevron.textContent   = open ? '▸' : '▾';
}

async function previewGeoJSON(key, table, expectedType, primaryProp) {
    const file    = document.getElementById(`geo-file-${key}`)?.files[0];
    const preview = document.getElementById(`geo-preview-${key}`);
    if (!file || !preview) return;

    let geojson;
    try {
        const text = await file.text();
        geojson = JSON.parse(text);
    } catch {
        preview.innerHTML = `<div class="geo-error">File non valido: non è un JSON leggibile.</div>`;
        return;
    }

    // Accept FeatureCollection or single Feature
    const features = geojson.type === 'FeatureCollection'
        ? geojson.features
        : geojson.type === 'Feature' ? [geojson] : [];

    if (features.length === 0) {
        preview.innerHTML = `<div class="geo-error">Nessuna feature trovata nel file.</div>`;
        return;
    }

    // Reproject if needed
    const epsg = detectCRS(geojson);
    let crsNote = '';
    if (!isWGS84(epsg) && epsg) {
        crsNote = `<div style="color:var(--yellow);font-size:11px;margin-bottom:6px;">
        ⚠️ CRS rilevato: EPSG:${epsg} — verrà riproiettato in WGS84 al caricamento</div>`;
    }
    
    // Validate geometry type
    const wrong = features.filter(f => {
        const t = f.geometry?.type;
        return t?.toLowerCase() !== expectedType.toLowerCase();
    });

    const rows = features.map(f => {
        const prop = f.properties?.[primaryProp] || '—';
        const type = f.geometry?.type || '?';
        const ok   = type.toLowerCase() === expectedType.toLowerCase();
        return `<tr>
        <td>${prop}</td>
        <td>${type}</td>
        <td>${ok ? '✓' : `<span style="color:var(--red)">✗ atteso ${expectedType}</span>`}</td>
        </tr>`;
    }).join('');

    preview.innerHTML = `
        <div class="geo-preview-box">
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">
            ${features.length} feature trovate${wrong.length > 0 ? ` — <span style="color:var(--red)">${wrong.length} tipo errato</span>` : ''}
        </div>
        <table class="geo-preview-table">
            <thead><tr><th>${primaryProp}</th><th>Tipo</th><th>Valido</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        ${wrong.length === 0 ? `
            <div style="display:flex;gap:8px;margin-top:10px;align-items:center;">
            <label style="font-size:11px;color:var(--text-secondary);">
                <input type="radio" name="geo-mode-${key}" value="replace" checked /> Sostituisci esistenti
            </label>
            <label style="font-size:11px;color:var(--text-secondary);">
                <input type="radio" name="geo-mode-${key}" value="additive" /> Aggiungi
            </label>
            <button class="btn-primary" style="width:auto;padding:5px 14px;margin-left:auto;"
                onclick="uploadGeoJSON('${key}','${table}','${primaryProp}')">
                Carica
            </button>
            </div>` : ''}
        </div>`;
}

async function uploadGeoJSON(key, table, primaryProp) {
  const file = document.getElementById(`geo-file-${key}`)?.files[0];
  if (!file) return;

  const mode = document.querySelector(`input[name="geo-mode-${key}"]:checked`)?.value || 'replace';
  const text = await file.text();
  const geojson = JSON.parse(text);
  let features = geojson.type === 'FeatureCollection'
    ? geojson.features
    : [geojson];

  const preview = document.getElementById(`geo-preview-${key}`);

  // Reproject if needed
  features = await reprojectFeaturesIfNeeded(geojson, features);
  if (!features) return; // CRS unknown, error already shown

  try {
    // Replace: delete existing for this event
    if (mode === 'replace') {
      const { error: delError } = await db
        .from(table)
        .delete()
        .eq('event_id', PCA.eventId);
      if (delError) throw delError;
    }

    // Build rows
    const rows = features.map(f => {
      const props = f.properties || {};
      const geomWKT = geojsonGeomToWKT(f.geometry);
      const base = {
        event_id: PCA.eventId,
        geom:     geomWKT,
      };

      // Table-specific fields
      if (table === 'event_route')    return { ...base, name:  props.name  || 'Percorso' };
      if (table === 'markers_route')  return { ...base, km:    props.km    || 0, label: props.label || null };
      if (table === 'fixed_resources')return { ...base, label: props.label || props.name || null };
      if (table === 'grid')           return { ...base, label: props.label || props.name || null };
      if (table === 'event_poi')      return { ...base, name:  props.name  || '—', poi_type: props.poi_type || null, properties: props };
      return base;
    });

    const { error } = await db.from(table).insert(rows);
    if (error) throw error;

    showToast(`${rows.length} geometrie caricate ✓`, 'success');
    preview.innerHTML += `<div style="color:var(--green);font-size:11px;margin-top:6px;">
      ✓ ${rows.length} feature inserite con successo.</div>`;

  } catch (err) {
    showToast('Errore caricamento', 'error');
    preview.innerHTML += `<div class="geo-error" style="margin-top:6px;">Errore: ${err.message}</div>`;
  }
}

/* ── CRS DETECTION & REPROJECTION ───────────────────────────── */
function detectCRS(geojson) {
  const crs = geojson?.crs?.properties?.name || '';
  if (!crs) return null;
  // Extract EPSG code from strings like "EPSG:32632" or "urn:ogc:def:crs:EPSG::32632"
  const match = crs.match(/EPSG[::]+(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

function isWGS84(epsgCode) {
  return !epsgCode || epsgCode === 4326 || epsgCode === 4269;
}

async function getProj4Def(epsgCode) {
  try {
    const res = await fetch(`https://epsg.io/${epsgCode}.proj4`);
    if (!res.ok) throw new Error('not found');
    return await res.text();
  } catch {
    return null;
  }
}

function reprojectCoord(coord, fromProj) {
  // proj4(from, to, coord) — to is always WGS84
  const [x, y] = proj4(fromProj, 'WGS84', [coord[0], coord[1]]);
  return coord.length === 3 ? [x, y, coord[2]] : [x, y];
}

function reprojectGeometry(geom, fromProj) {
  const r = c => reprojectCoord(c, fromProj);

  switch (geom.type) {
    case 'Point':
      return { ...geom, coordinates: r(geom.coordinates) };
    case 'LineString':
    case 'MultiPoint':
      return { ...geom, coordinates: geom.coordinates.map(r) };
    case 'Polygon':
    case 'MultiLineString':
      return { ...geom, coordinates: geom.coordinates.map(ring => ring.map(r)) };
    case 'MultiPolygon':
      return { ...geom, coordinates: geom.coordinates.map(poly => poly.map(ring => ring.map(r))) };
    default:
      return geom;
  }
}

async function reprojectFeaturesIfNeeded(geojson, features) {
  const epsg = detectCRS(geojson);
  if (isWGS84(epsg)) return features; // already WGS84

  showToast(`Riproiezione da EPSG:${epsg} a WGS84...`, 'success');

  const proj4def = await getProj4Def(epsg);
  if (!proj4def) {
    showToast(`CRS EPSG:${epsg} non riconosciuto — verifica il file`, 'error');
    return null;
  }

  proj4.defs(`EPSG:${epsg}`, proj4def);

  return features.map(f => ({
    ...f,
    geometry: reprojectGeometry(f.geometry, `EPSG:${epsg}`),
  }));
}

/* ── GEOJSON → WKT ──────────────────────────────────────────── */
function geojsonGeomToWKT(geom) {
  if (!geom) return null;

  const coordToStr = c => `${c[0]} ${c[1]}`;
  const ringToStr  = r => r.map(coordToStr).join(', ');

  switch (geom.type) {
    case 'Point':
      return `POINT(${coordToStr(geom.coordinates)})`;

    case 'LineString':
      return `LINESTRING(${geom.coordinates.map(coordToStr).join(', ')})`;

    case 'Polygon':
      return `POLYGON(${geom.coordinates.map(r => `(${ringToStr(r)})`).join(', ')})`;

    case 'MultiPolygon':
      return `MULTIPOLYGON(${geom.coordinates
        .map(poly => `(${poly.map(r => `(${ringToStr(r)})`).join(', ')})`)
        .join(', ')})`;

    case 'MultiLineString':
        return `MULTILINESTRING(${geom.coordinates
        .map(line => `(${line.map(coordToStr).join(', ')})`)
        .join(', ')})`;
    default:
      throw new Error(`Tipo geometria non supportato: ${geom.type}`);
  }
}