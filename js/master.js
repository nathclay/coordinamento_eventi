/* ================================================================
   js/master.js — Master admin console
   All DB calls → rpc-master.js
================================================================ */

const RESOURCE_TYPES = ['ASM','ASI','SAP','BICI','MM','PMA','LDC','PCA','ALTRO'];
const LOG_TABLES = ['events','resources','personnel','anagrafica','resource_type_requirements'];

const MASTER = {
  session: null,
  events: [],
  selectedEventId: null,
  resources: [],
  _currentPage: 'eventi',
};

/* ================================================================
   INIT & AUTH
================================================================ */
async function initMaster() {
  document.querySelectorAll('[data-modal]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.modal))
  );
  document.getElementById('btn-google').addEventListener('click', doGoogleLogin);

  showScreen('screen-login');

  const session = await getMasterSession();
  if (session) await afterLogin(session);
}

async function doGoogleLogin() {
  const btn = document.getElementById('btn-google');
  btn.disabled = true;
  try {
    await signInMasterWithGoogle();
    // Supabase redirects for OAuth — execution normally stops here.
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
    btn.disabled = false;
  }
}

async function afterLogin(session) {
  const role = session?.user?.app_metadata?.role;
  if (role !== 'master') {
    document.getElementById('login-error').textContent =
      'Accesso riservato agli amministratori. Il tuo account non ha i permessi necessari.';
    await signOutMaster();
    showScreen('screen-login');
    return;
  }

  MASTER.session = session;
  document.getElementById('header-user').textContent = session.user.email || '';
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await signOutMaster();
    location.reload();
  });
  document.querySelectorAll('.sidebar-item[data-page]').forEach(btn =>
    btn.addEventListener('click', () => navigateTo(btn.dataset.page))
  );

  showScreen('screen-main');

  try {
    MASTER.events = await fetchAllEvents();
    if (MASTER.events.length && !MASTER.selectedEventId) {
      MASTER.selectedEventId = MASTER.events[0].id;
    }
  } catch (err) { showToast(err.message, 'error'); }

  await navigateTo('eventi');
}

/* ================================================================
   ROUTER
================================================================ */
async function navigateTo(page) {
  MASTER._currentPage = page;
  document.querySelectorAll('.sidebar-item[data-page]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.page === page)
  );
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>Caricamento...</span></div>';
  try {
    if      (page === 'eventi')  await mountEventi(content);
    else if (page === 'risorse') await mountRisorse(content);
    else if (page === 'utenti')  await mountUtenti(content);
    else if (page === 'storico') await mountStorico(content);
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="empty-state">Errore: ${err.message}</div>`;
  }
}

/* ================================================================
   EVENTI TAB
================================================================ */
async function mountEventi(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-left"><h2 class="view-title">Eventi</h2></div>
      <div class="view-header-right">
        <button class="btn-primary" id="btn-new-event">+ Nuovo evento</button>
      </div>
    </div>
    <div class="view-body">
      <div class="events-toolbar">
        <span style="font-size:12px;color:var(--text-muted)">Clicca un evento per selezionarlo (usato in Risorse / Utenti / Storico)</span>
      </div>
      <div class="events-grid" id="events-grid"></div>
    </div>`;

  document.getElementById('btn-new-event').addEventListener('click', () => openEventModal(null));
  renderEventsGrid();
}

function renderEventsGrid() {
  const grid = document.getElementById('events-grid');
  if (!grid) return;
  if (!MASTER.events.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-text">Nessun evento. Creane uno per iniziare.</div></div>`;
    return;
  }
  grid.innerHTML = MASTER.events.map(ev => `
    <div class="master-event-card ${ev.id === MASTER.selectedEventId ? 'selected' : ''}" data-id="${ev.id}">
      <div>
        <div class="master-event-name">${ev.name}</div>
        <div class="master-event-meta">
          ${ev.is_active ? '<span class="badge-active">● Attivo</span>' : '<span class="badge-inactive">○ Non attivo</span>'}
          ${ev.start_date ? ` · dal ${fmtDate(ev.start_date)}` : ''}${ev.end_date ? ` al ${fmtDate(ev.end_date)}` : ''}
          · Sessione ${ev.current_session ?? 1}
        </div>
      </div>
      <div class="master-event-actions">
        <button class="btn-secondary btn-sm" data-edit="${ev.id}">Modifica</button>
      </div>
    </div>`).join('');

  grid.querySelectorAll('.master-event-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit]')) return;
      MASTER.selectedEventId = card.dataset.id;
      renderEventsGrid();
      showToast('Evento selezionato ✓', 'success');
    });
  });
  grid.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEventModal(MASTER.events.find(ev => ev.id === btn.dataset.edit));
    });
  });
}

function openEventModal(event) {
  const e = event || {};
  document.getElementById('event-modal-title').textContent = event ? 'Modifica evento' : 'Nuovo evento';
  document.getElementById('event-modal-body').innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>Nome <span class="req">*</span></label>
        <input type="text" id="ev-name" value="${e.name || ''}" /></div>
      <div class="form-group"><label>Attivo</label>
        <div class="toggle-group">
          <button type="button" class="toggle-btn ev-active-btn ${!e.is_active ? 'active' : ''}" data-val="false">No</button>
          <button type="button" class="toggle-btn ev-active-btn ${e.is_active ? 'active' : ''}" data-val="true">Sì</button>
        </div>
      </div>
    </div>
    <div class="form-group"><label>Descrizione</label>
      <textarea id="ev-description" rows="2">${e.description || ''}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Data inizio</label>
        <input type="date" id="ev-start-date" value="${e.start_date || ''}" /></div>
      <div class="form-group"><label>Data fine</label>
        <input type="date" id="ev-end-date" value="${e.end_date || ''}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Inizio (data/ora)</label>
        <input type="datetime-local" id="ev-start-time" value="${toLocalInputMaster(e.start_time)}" /></div>
      <div class="form-group"><label>Fine (data/ora)</label>
        <input type="datetime-local" id="ev-end-time" value="${toLocalInputMaster(e.end_time)}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Lat centro mappa</label>
        <input type="number" step="0.000001" id="ev-lat" value="${e.center_lat ?? ''}" /></div>
      <div class="form-group"><label>Lng centro mappa</label>
        <input type="number" step="0.000001" id="ev-lng" value="${e.center_lng ?? ''}" /></div>
      <div class="form-group"><label>Zoom default</label>
        <input type="number" min="1" max="20" id="ev-zoom" value="${e.default_zoom ?? 14}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Percorso (route)</label>
        <div class="toggle-group">
          <button type="button" class="toggle-btn ev-route-btn ${!e.is_route ? 'active' : ''}" data-val="false">No</button>
          <button type="button" class="toggle-btn ev-route-btn ${e.is_route ? 'active' : ''}" data-val="true">Sì</button>
        </div>
      </div>
      <div class="form-group"><label>Griglia (grid)</label>
        <div class="toggle-group">
          <button type="button" class="toggle-btn ev-grid-btn ${!e.is_grid ? 'active' : ''}" data-val="false">No</button>
          <button type="button" class="toggle-btn ev-grid-btn ${e.is_grid ? 'active' : ''}" data-val="true">Sì</button>
        </div>
      </div>
    </div>
    <div class="form-group"><label>Note generali</label>
      <textarea id="ev-notes-general" rows="2">${e.notes_general || ''}</textarea></div>
    <div class="form-group"><label>Note coordinatori</label>
      <textarea id="ev-notes-coord" rows="2">${e.notes_coordinators || ''}</textarea></div>
    <div id="event-error" class="error-msg"></div>`;

  wireToggleGroup('ev-active-btn');
  wireToggleGroup('ev-route-btn');
  wireToggleGroup('ev-grid-btn');

  const saveBtn = document.getElementById('event-modal-save');
  const freshSave = saveBtn.cloneNode(true);
  saveBtn.replaceWith(freshSave);
  document.getElementById('event-modal-save').onclick = () => saveEvent(event?.id || null);

  openModal('modal-event');
}

function wireToggleGroup(cls) {
  document.querySelectorAll(`.${cls}`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`.${cls}`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function toggleGroupValue(cls) {
  return document.querySelector(`.${cls}.active`)?.dataset.val === 'true';
}

async function saveEvent(eventId) {
  const errEl = document.getElementById('event-error');
  errEl.textContent = '';
  const name = document.getElementById('ev-name').value.trim();
  if (!name) { errEl.textContent = 'Nome obbligatorio.'; return; }

  const payload = {
    name,
    description:        document.getElementById('ev-description').value.trim() || null,
    start_date:          document.getElementById('ev-start-date').value || null,
    end_date:            document.getElementById('ev-end-date').value || null,
    start_time:          fromLocalInputMaster(document.getElementById('ev-start-time').value),
    end_time:            fromLocalInputMaster(document.getElementById('ev-end-time').value),
    center_lat:          numOrNull(document.getElementById('ev-lat').value),
    center_lng:          numOrNull(document.getElementById('ev-lng').value),
    default_zoom:        numOrNull(document.getElementById('ev-zoom').value) ?? 14,
    is_active:           toggleGroupValue('ev-active-btn'),
    is_route:            toggleGroupValue('ev-route-btn'),
    is_grid:             toggleGroupValue('ev-grid-btn'),
    notes_general:       document.getElementById('ev-notes-general').value.trim() || null,
    notes_coordinators:  document.getElementById('ev-notes-coord').value.trim() || null,
  };

  const btn = document.getElementById('event-modal-save');
  btn.disabled = true; btn.textContent = 'Salvataggio...';
  try {
    if (eventId) {
      const updated = await updateEvent(eventId, payload);
      MASTER.events = MASTER.events.map(ev => ev.id === eventId ? updated : ev);
    } else {
      const created = await createEvent(payload);
      MASTER.events.unshift(created);
      MASTER.selectedEventId = created.id;
    }
    closeModal('modal-event');
    showToast('Evento salvato ✓', 'success');
    renderEventsGrid();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Salva';
  }
}

/* ================================================================
   RISORSE TAB
================================================================ */
async function mountRisorse(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-left"><h2 class="view-title">Risorse</h2></div>
      <div class="view-header-right">
        <button class="btn-primary" id="btn-add-resources">+ Aggiungi risorse</button>
      </div>
    </div>
    <div class="view-body">
      <div class="event-context-bar">
        <span class="event-context-label">Evento</span>
        <select class="event-context-select" id="risorse-event-select"></select>
      </div>
      <div id="risorse-body"></div>
    </div>`;

  populateEventSelect(document.getElementById('risorse-event-select'));
  document.getElementById('risorse-event-select').addEventListener('change', async (e) => {
    MASTER.selectedEventId = e.target.value;
    await loadAndRenderResources();
  });
  document.getElementById('btn-add-resources').addEventListener('click', openBulkResourcesModal);

  await loadAndRenderResources();
}

function populateEventSelect(sel) {
  if (!sel) return;
  sel.innerHTML = MASTER.events.map(ev =>
    `<option value="${ev.id}" ${ev.id === MASTER.selectedEventId ? 'selected' : ''}>${ev.name}</option>`
  ).join('') || '<option value="">— Nessun evento —</option>';
}

async function loadAndRenderResources() {
  const body = document.getElementById('risorse-body');
  if (!MASTER.selectedEventId) { body.innerHTML = '<div class="empty-state">Seleziona o crea un evento.</div>'; return; }
  body.innerHTML = '<div class="loading-inline">Caricamento...</div>';
  try {
    MASTER.resources = await fetchResourcesForEvent(MASTER.selectedEventId);
    renderResourceGroups(body, { editEmail: false });
  } catch (err) { body.innerHTML = `<div class="error-msg">${err.message}</div>`; }
}

function renderResourceGroups(body, { editEmail }) {
  if (!MASTER.resources.length) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">🚑</div><div class="empty-text">Nessuna risorsa per questo evento.</div></div>';
    return;
  }
  const byType = {};
  MASTER.resources.forEach(r => { (byType[r.resource_type] ||= []).push(r); });

  body.innerHTML = Object.entries(byType).map(([type, list]) => `
    <div class="resource-type-group" style="margin-bottom:14px">
      <div class="resource-type-header">
        <span class="matrix-type-badge">${type}</span>
        <span class="section-count">${list.length} risorse</span>
      </div>
      ${list.map(r => `
        <div class="resource-row" data-id="${r.id}">
          <div class="resource-row-name">
            <input type="text" value="${r.resource}" data-rename="${r.id}" />
          </div>
          ${editEmail ? `
            <div class="resource-row-email">
              <input type="email" placeholder="email di accesso" value="${r.user_email || ''}" data-email="${r.id}" />
            </div>` : `<div class="resource-row-crew">${r.crew_count ?? 0} persone</div>`}
          <button class="btn-icon-sm" data-delete="${r.id}" title="Elimina risorsa">✕</button>
        </div>`).join('')}
    </div>`).join('');

  body.querySelectorAll('[data-rename]').forEach(input => {
    input.addEventListener('blur', () => debouncedSave(input, async () => {
      const newName = input.value.trim();
      if (!newName) return;
      await renameResource(input.dataset.rename, newName);
      const r = MASTER.resources.find(x => x.id === input.dataset.rename);
      if (r) r.resource = newName;
      showToast('Salvato ✓', 'success');
    }));
  });
  body.querySelectorAll('[data-email]').forEach(input => {
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        try {
          await updateResourceUserEmail(input.dataset.email, input.value.trim());
          const r = MASTER.resources.find(x => x.id === input.dataset.email);
          if (r) r.user_email = input.value.trim();
          showToast('Salvato ✓', 'success');
        } catch (err) { showToast(err.message, 'error'); }
      }, 600);
    });
  });
  body.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = MASTER.resources.find(x => x.id === btn.dataset.delete);
      if (!confirm(`Eliminare ${r?.resource}? L'operazione rimuove anche le assegnazioni collegate.`)) return;
      try {
        await deleteResource(btn.dataset.delete);
        MASTER.resources = MASTER.resources.filter(x => x.id !== btn.dataset.delete);
        renderResourceGroups(body, { editEmail });
        showToast('Risorsa eliminata', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
}

async function debouncedSave(input, fn) {
  if (input._saving) return;
  input._saving = true;
  try { await fn(); } catch (err) { showToast(err.message, 'error'); }
  finally { input._saving = false; }
}

function openBulkResourcesModal() {
  if (!MASTER.selectedEventId) { showToast('Seleziona prima un evento', 'error'); return; }
  document.getElementById('bulk-resources-modal-body').innerHTML = `
    <div class="form-group"><label>Tipo risorsa <span class="req">*</span></label>
      <select id="br-type">${RESOURCE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Prefisso nome</label>
        <input type="text" id="br-prefix" value="ASM" /></div>
      <div class="form-group"><label>Numero risorse <span class="req">*</span></label>
        <input type="number" id="br-count" min="1" max="100" value="1" /></div>
      <div class="form-group"><label>Inizia da</label>
        <input type="number" id="br-start" min="1" value="1" /></div>
    </div>
    <div style="font-size:12px;color:var(--text-muted)" id="br-preview"></div>
    <div id="br-error" class="error-msg"></div>`;

  const typeSel = document.getElementById('br-type');
  const prefixInput = document.getElementById('br-prefix');
  prefixInput.value = typeSel.value;
  typeSel.addEventListener('change', () => { prefixInput.value = typeSel.value; updateBulkPreview(); });
  ['br-prefix','br-count','br-start'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateBulkPreview)
  );
  updateBulkPreview();

  const saveBtn = document.getElementById('bulk-resources-modal-save');
  const fresh = saveBtn.cloneNode(true);
  saveBtn.replaceWith(fresh);
  document.getElementById('bulk-resources-modal-save').onclick = confirmBulkResources;

  openModal('modal-bulk-resources');
}

function updateBulkPreview() {
  const names = buildBulkResourceNames();
  const el = document.getElementById('br-preview');
  if (el) el.textContent = names.length ? `Verranno create: ${names.join(', ')}` : '';
}

function buildBulkResourceNames() {
  const prefix = document.getElementById('br-prefix')?.value.trim() || '';
  const count  = parseInt(document.getElementById('br-count')?.value, 10) || 0;
  const start  = parseInt(document.getElementById('br-start')?.value, 10) || 1;
  const names = [];
  for (let i = 0; i < count && i < 100; i++) names.push(`${prefix} ${start + i}`.trim());
  return names;
}

async function confirmBulkResources() {
  const errEl = document.getElementById('br-error');
  errEl.textContent = '';
  const type = document.getElementById('br-type').value;
  const names = buildBulkResourceNames();
  if (!names.length) { errEl.textContent = 'Numero risorse non valido.'; return; }

  const btn = document.getElementById('bulk-resources-modal-save');
  btn.disabled = true; btn.textContent = 'Creazione...';
  try {
    const created = await bulkCreateResources(MASTER.selectedEventId, type, names);
    MASTER.resources.push(...created);
    closeModal('modal-bulk-resources');
    showToast(`${created.length} risorse create ✓`, 'success');
    if (MASTER._currentPage === 'risorse') await loadAndRenderResources();
    else if (MASTER._currentPage === 'utenti') await loadAndRenderUtenti();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Crea';
  }
}

/* ================================================================
   UTENTI TAB
================================================================ */
async function mountUtenti(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-left"><h2 class="view-title">Utenti</h2></div>
    </div>
    <div class="view-body">
      <div class="event-context-bar">
        <span class="event-context-label">Evento</span>
        <select class="event-context-select" id="utenti-event-select"></select>
      </div>
      <div class="admins-panel">
        <div class="admins-panel-title">Amministratori</div>
        <div class="admins-panel-hint">
          Sola lettura. Per aggiungere o rimuovere un amministratore (ruolo <code>master</code> o <code>planner</code>),
          esegui uno script SQL in Supabase — vedi SQL/migrations/README.md. Non è modificabile da qui.
        </div>
        <div id="admins-list">Caricamento...</div>
      </div>
      <div id="utenti-body"></div>
    </div>`;

  populateEventSelect(document.getElementById('utenti-event-select'));
  document.getElementById('utenti-event-select').addEventListener('change', async (e) => {
    MASTER.selectedEventId = e.target.value;
    await loadAndRenderUtenti();
  });

  loadAdminsList();
  await loadAndRenderUtenti();
}

async function loadAdminsList() {
  const el = document.getElementById('admins-list');
  try {
    const admins = await fetchPrivilegedUsers();
    el.innerHTML = admins.length
      ? admins.map(a => `<span class="admin-chip">${a.email} <span class="admin-chip-role role-${a.role}">${a.role}</span></span>`).join('')
      : '<span style="color:var(--text-muted);font-size:13px">Nessuno trovato.</span>';
  } catch (err) { el.innerHTML = `<span class="error-msg">${err.message}</span>`; }
}

async function loadAndRenderUtenti() {
  const body = document.getElementById('utenti-body');
  if (!MASTER.selectedEventId) { body.innerHTML = '<div class="empty-state">Seleziona o crea un evento.</div>'; return; }
  body.innerHTML = '<div class="loading-inline">Caricamento...</div>';
  try {
    MASTER.resources = await fetchResourcesForEvent(MASTER.selectedEventId);
    renderResourceGroups(body, { editEmail: true });
  } catch (err) { body.innerHTML = `<div class="error-msg">${err.message}</div>`; }
}

/* ================================================================
   STORICO TAB
================================================================ */
async function mountStorico(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-left"><h2 class="view-title">Storico modifiche</h2></div>
    </div>
    <div class="view-body">
      <div class="log-filters">
        <select class="event-context-select" id="log-event-select" style="max-width:260px">
          <option value="">Tutti gli eventi</option>
        </select>
        <select class="event-context-select" id="log-table-select" style="max-width:220px">
          <option value="">Tutte le tabelle</option>
          ${LOG_TABLES.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <button class="btn-secondary btn-sm" id="log-refresh">Aggiorna</button>
      </div>
      <div class="table-scroll-wrapper">
        <table class="log-table">
          <thead><tr><th>Quando</th><th>Tabella</th><th>Azione</th><th>Utente</th><th></th></tr></thead>
          <tbody id="log-tbody"></tbody>
        </table>
      </div>
    </div>`;

  const evSel = document.getElementById('log-event-select');
  evSel.innerHTML += MASTER.events.map(ev =>
    `<option value="${ev.id}" ${ev.id === MASTER.selectedEventId ? 'selected' : ''}>${ev.name}</option>`
  ).join('');

  document.getElementById('log-refresh').addEventListener('click', loadAndRenderLog);
  evSel.addEventListener('change', loadAndRenderLog);
  document.getElementById('log-table-select').addEventListener('change', loadAndRenderLog);

  await loadAndRenderLog();
}

async function loadAndRenderLog() {
  const tbody = document.getElementById('log-tbody');
  const eventId   = document.getElementById('log-event-select').value || null;
  const tableName = document.getElementById('log-table-select').value || null;
  tbody.innerHTML = `<tr><td colspan="5" class="loading-inline">Caricamento...</td></tr>`;
  try {
    const rows = await fetchChangeLog({ eventId, tableName });
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nessuna modifica registrata.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r, i) => `
      <tr>
        <td>${new Date(r.changed_at).toLocaleString('it-IT')}</td>
        <td class="log-table-name">${r.table_name}</td>
        <td><span class="log-action log-action-${r.action}">${r.action}</span></td>
        <td>${r.changed_by_email || '—'}</td>
        <td><button class="log-diff-toggle" data-idx="${i}">Dettagli</button></td>
      </tr>
      <tr class="log-diff-row hidden" id="log-diff-${i}">
        <td colspan="5"><pre class="log-diff-pre">${escapeHtml(JSON.stringify({ old: r.old_data, new: r.new_data }, null, 2))}</pre></td>
      </tr>`).join('');

    tbody.querySelectorAll('.log-diff-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(`log-diff-${btn.dataset.idx}`)?.classList.toggle('hidden');
      });
    });
  } catch (err) { tbody.innerHTML = `<tr><td colspan="5" class="error-msg">${err.message}</td></tr>`; }
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ================================================================
   UTILITIES
================================================================ */
function numOrNull(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function fmtDate(d) { try { return new Date(d).toLocaleDateString('it-IT'); } catch { return d; } }
function toLocalInputMaster(iso) { if (!iso) return ''; try { return new Date(iso).toISOString().slice(0, 16); } catch { return ''; } }
function fromLocalInputMaster(v) { if (!v) return null; try { return new Date(v).toISOString(); } catch { return null; } }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}
function openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast toast-${type}`;
  el.classList.remove('hidden'); clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

document.addEventListener('DOMContentLoaded', initMaster);
