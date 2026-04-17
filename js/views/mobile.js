/* ================================================================
   js/views/mobile.js
   Main view of mobile: loads all data, populates panels, wires up tabs.
   Called after auth + personnel selection are complete.
   Depends on: rpc.js, ui.js, state.js, realtime.js, location.js,
               map.js, incidents.js
================================================================ */

/* ----------------------------------------------------------------
   RESOURCE TYPE LABELS
---------------------------------------------------------------- */
const RESOURCE_TYPE_LABELS = {
  ASM:   'Ambulanza Medicalizzata',
  ASI:   'Ambulanza Infermieristica',
  SAP:   'Squadra appiedata',
  BICI:  'Cri in Bici',
  MM:    'Moto Medica',
  LDC:   'Linea di Comando',
  PMA:   'Posto Medico Avanzato',
  ALTRO: 'Altra Risorsa',
};

/* ----------------------------------------------------------------
   LOAD MAIN VIEW
   Entry point called by auth.js after login + personnel selection.
---------------------------------------------------------------- */
async function loadMobileView() {
  const r = STATE.resource;

  // Set coordinator mode — shows extra tab + sector blocks
  if (r.resource_type === 'LDC') {
    document.body.classList.add('is-coordinator');
    await loadSectorResources();
    await loadTeamFilter();
    await loadCoordinatorResources();
  }

  // Header
  document.getElementById('header-resource-name').textContent = r.resource;
  document.getElementById('header-user-name').textContent = STATE.personnel
    ? `${STATE.personnel.name} ${STATE.personnel.surname}`
    : 'Nessuna identità selezionata';

  // Info panel hero
  const badge = document.getElementById('resource-type-badge');
  badge.textContent = r.resource_type;
  badge.className   = `resource-type-badge ${r.resource_type}`;

  document.getElementById('hero-resource-name').textContent =
    r.resource;
  document.getElementById('hero-resource-type').textContent =
    RESOURCE_TYPE_LABELS[r.resource_type] || r.resource_type;
  document.getElementById('resource-notes').textContent =
    r.notes || 'Nessuna nota operativa';

  // Event panel
  populateEventPanel();

  // Start live clock
  startClock();

  // Load data
  await Promise.all([
    loadCrew(),
    loadIncidents(),
    loadCoordinatorSection(),
    r.resource_type === 'LDC' ? loadSectorResources() : Promise.resolve(),
  ]);
  //status
  const { data: rcs } = await db
    .from('resources_current_status')
    .select('status, active_responses')
    .eq('resource_id', STATE.resource.id)
    .single();

  if (rcs) {
    updateHeaderStatus(rcs);
  } else {
    // No status row yet — resource is free by definition
    updateHeaderStatus({ status: 'free' });
  }

  // Realtime + location
  subscribeRealtime();
  startLocationTracking();

  // Register Realtime callbacks
  onIncidentChange(() => loadIncidents());
  onResourceStatusChange(rcs => updateHeaderStatus(rcs));

  // Wire up tab bar
  initTabs();

  // Wire up incident form events
  initIncidentForm();

  // Show the main view
  showScreen('screen-main');

  //refresh button
  document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';
    await Promise.all([
      loadIncidents(),
      loadCrew(),
      refreshHeaderStatus(),
      STATE.resource.resource_type === 'LDC' ? loadSectorResources() : Promise.resolve(),
    ]);
    // If on map tab, also refresh markers
    const mapPanel = document.getElementById('panel-map');
    if (mapPanel?.classList.contains('active')) await refreshMapMarkers();
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
  });
}

async function loadPositionSection() {
  const container = document.getElementById('mini-map-container');
  if (!container) return;

  const rcs = await fetchResourcePosition();
   if (rcs?.geom) {
    const coords = rcs.geom.coordinates;
    const lat = coords[1].toFixed(5);
    const lng = coords[0].toFixed(5);

    const label = rcs.type === 'live'
      ? `✓ Posizione inviata al PCA — ${new Date(rcs.updated_at).toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'})}`
      : '📍 Posizione iniziale del modulo';

    const labelColor = rcs.type === 'live' ? 'var(--green)' : 'var(--text-secondary)';


    container.innerHTML = `
    <div style="font-size:11px;color:${labelColor};font-weight:600;margin-bottom:6px;">
      ${label}
    </div>
    <div style="margin-top:8px;border-radius:var(--radius);overflow:hidden;">
      <iframe
        style="width:100%;height:180px;border:none;display:block;"
        src="https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lng)-0.002},${parseFloat(lat)-0.002},${parseFloat(lng)+0.002},${parseFloat(lat)+0.002}&layer=mapnik&marker=${lat},${lng}">
      </iframe>
    </div>
    <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;margin-bottom:8px;">
      ${lat}, ${lng}
    </div>
    <button id="btn-send-position" style="
      width:100%;padding:12px;border-radius:var(--radius);
      border:1.5px solid var(--border-bright);background:var(--bg-card);
      color:var(--text-primary);font-size:13px;font-weight:600;
      font-family:var(--font);cursor:pointer;text-align:center;">
      📍 Invia posizione attuale
    </button>`;


    document.getElementById('btn-send-position')
      ?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-send-position');
        btn.textContent = '📍 Localizzazione...';
        try {
          const pos = await getCurrentPosition();
          await insertLocation(pos.coords);
          showToast('Posizione inviata ✓', 'success');
          loadPositionSection();
        } catch (_) {
          btn.textContent = '📍 Invia posizione attuale';
          showToast('GPS non disponibile', 'error');
        }
      });

  } else {
    // No position at all
    container.innerHTML = `
      <button id="btn-send-position" style="
        width:100%;padding:14px;border-radius:var(--radius);
        border:1.5px solid var(--border-bright);background:var(--bg-card);
        color:var(--text-primary);font-size:13px;font-weight:600;
        font-family:var(--font);cursor:pointer;text-align:center;">
        📍 Invia posizione attuale
      </button>`;

    document.getElementById('btn-send-position')
      ?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-send-position');
        btn.textContent = '📍 Localizzazione...';
        try {
          const pos = await getCurrentPosition();
          await insertLocation(pos.coords);
          showToast('Posizione inviata ✓', 'success');
          loadPositionSection();
        } catch (_) {
          btn.textContent = '📍 Invia posizione attuale';
          showToast('GPS non disponibile', 'error');
        }
      });
  }
}

/* ----------------------------------------------------------------
   PANEL: EVENTO
---------------------------------------------------------------- */
function populateEventPanel() {
  const ev = STATE.event;
  const r  = STATE.resource;

  document.getElementById('event-name').textContent =
    ev ? ev.name : '—';

  document.getElementById('event-start').textContent =
    ev?.start_time
      ? new Date(ev.start_time).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' })
      : '--:--';

  // Radio channel
  if (r.event_radio_channels) {
    document.getElementById('radio-channel-name').textContent =
      r.event_radio_channels.channel_name || '—';
    document.getElementById('radio-channel-desc').textContent =
      r.event_radio_channels.description  || '';
  }

}

/* Filter teams (coordinator only) */
async function loadTeamFilter() {
  const bar = document.getElementById('team-filter-bar');
  if (!bar) return;

  const resources = await fetchSectorResources();

  // Add "Tutti" button + one per resource
  const buttons = [
    { id: null, label: 'Tutti' },
    ...resources.map(r => ({ id: r.id, label: r.resource }))
  ];

  bar.innerHTML = buttons.map(b => `
    <button class="team-filter-btn ${b.id === null ? 'active' : ''}"
      data-resource-id="${b.id || ''}"
      style="display:inline-block;margin-right:6px;padding:6px 14px;
        border-radius:20px;border:1.5px solid var(--border-bright);
        background:${b.id === null ? 'var(--red)' : 'var(--bg-card)'};
        color:${b.id === null ? 'white' : 'var(--text-primary)'};
        font-size:12px;font-weight:600;font-family:var(--font);
        cursor:pointer;white-space:nowrap;">
      ${b.label}
    </button>`
  ).join('');

  // Wire up filter clicks
  bar.querySelectorAll('.team-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.team-filter-btn').forEach(b => {
        b.style.background = 'var(--bg-card)';
        b.style.color = 'var(--text-primary)';
        b.classList.remove('active');
      });
      btn.style.background = 'var(--red)';
      btn.style.color = 'white';
      btn.classList.add('active');

      STATE.activeTeamFilter = btn.dataset.resourceId || null;
      renderIncidents(); // re-render with filter
    });
  });
}
/* ----------------------------------------------------------------
   CLOCK
---------------------------------------------------------------- */
function startClock() {
  function tick() {
    const el = document.getElementById('clock-now');
    if (el) el.textContent =
      new Date().toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
  }
  tick();
  setInterval(tick, 30000);
}

/* ----------------------------------------------------------------
   CREW LIST
---------------------------------------------------------------- */
async function loadCrew() {
  const crew = await fetchCrew();
  const list = document.getElementById('crew-list');
  list.innerHTML = '';

  if (crew.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-text">Nessun membro registrato</div></div>';
    return;
  }

  // Header row
  list.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;
      padding:6px 0;border-bottom:2px solid var(--border-bright);margin-bottom:4px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Nome</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Numero</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Ruolo</div>
    </div>`;

  crew.forEach(p => {
    const isMe = STATE.personnel && STATE.personnel.id === p.id;
    const row  = document.createElement('div');
    row.style.cssText = `display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;
      padding:8px 0;border-bottom:1px solid var(--border);align-items:center;`;

    row.innerHTML = `
      <div style="font-size:13px;font-weight:${isMe ? 'bold' : '500'};
        color:var(--text-primary);">
        ${p.name} ${p.surname}
        ${isMe ? '<span style="font-size:9px;color:var(--blue);background:var(--blue-dim);border-radius:4px;padding:1px 5px;margin-left:4px;font-weight:bold;">TU</span>' : ''}
      </div>
      <div>
        ${p.number ? `
          <a href="tel:${p.number}" style="font-size:13px;color:var(--blue);
            font-weight:600;text-decoration:none;">
            📞 ${p.number}
          </a>` : '<span style="font-size:12px;color:var(--text-muted);">—</span>'}
      </div>
      <div style="font-size:12px;color:var(--text-secondary);
        font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
        ${p.role || '—'}
      </div>
    `;
    list.appendChild(row);

  });
}

async function loadCoordinatorSection() {
  const block = document.getElementById('coordinator-crew-block');
  if (!block) return;

  const result = await fetchCoordinatorCrew();

  if (!result) {
    block.style.display = 'none';
    return;
  }

  block.style.display = 'block';
  block.innerHTML = `
    <div class="section-label">Coordinatore di zona</div>
    <div style="font-size:15px;font-weight:bold;color:var(--text-primary);
      margin-bottom:10px;">
      ${result.coordinator.resource}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;
      padding:6px 0;border-bottom:2px solid var(--border-bright);margin-bottom:4px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Nome</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Numero</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Ruolo</div>
    </div>
    ${result.crew.map(p => `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;
        padding:8px 0;border-bottom:1px solid var(--border);align-items:center;">
        <div style="font-size:13px;font-weight:500;color:var(--text-primary);">
          ${p.name} ${p.surname}
        </div>
        <div>
          ${p.number ? `<a href="tel:${p.number}" style="font-size:13px;color:var(--blue);
            font-weight:600;text-decoration:none;">📞 ${p.number}</a>`
            : '<span style="font-size:12px;color:var(--text-muted);">—</span>'}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);
          font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
          ${p.role || '—'}
        </div>
      </div>`
    ).join('')}
  `;
}
/* ----------------------------------------------------------------
   SECTOR RESOURCES (coordinator only)
---------------------------------------------------------------- */
async function loadSectorResources() {
  const resources = await fetchSectorResources();
  const list = document.getElementById('sector-resources-list');
  if (!list) return;
  list.innerHTML = '';

  const statusIcon = { free:'🟢', busy:'🟠', stopped:'⚫' };

  resources.forEach(r => {
    const rcs    = r.resources_current_status;
    const status = rcs?.status || 'free';
    const row    = document.createElement('div');
    row.className = 'contact-row';
    row.innerHTML = `
      <div class="contact-icon">${statusIcon[status] || '⚫'}</div>
      <div class="contact-info">
        <div class="contact-name">${r.resource}</div>
        <div class="contact-detail">${RESOURCE_TYPE_LABELS[r.resource_type] || r.resource_type}</div>
      </div>
      <div class="contact-channel">${rcs?.active_responses || 0} int.</div>
    `;
    list.appendChild(row);
  });
}

async function loadCoordinatorResources() {
  const list = document.getElementById('coordinator-resources-list');
  if (!list) return;

  const resources = await fetchSectorResources();

  if (resources.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-text">Nessuna squadra</div></div>';
    return;
  }

  const statusIcon = { free: '🟢', busy: '🟠', stopped: '⚫' };
  const statusLabel = { free: 'Libera', busy: 'In intervento', stopped: 'Ferma' };

  // Header
  list.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;
      padding:6px 0;border-bottom:2px solid var(--border-bright);margin-bottom:4px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Squadra</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Tipo</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Stato</div>
    </div>`;

  resources.forEach(r => {
    const rcs    = r.resources_current_status;
    const status = rcs?.status || 'free';
    const row    = document.createElement('div');
    row.style.cssText = `display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;
      padding:10px 0;border-bottom:1px solid var(--border);
      align-items:center;cursor:pointer;`;

    row.innerHTML = `
      <div style="font-size:13px;font-weight:bold;color:var(--text-primary);">
        ${r.resource}
      </div>
      <div style="font-size:12px;color:var(--text-secondary);font-weight:500;">
        ${r.resource_type}
      </div>
      <div style="font-size:12px;font-weight:600;">
        ${statusIcon[status]} ${statusLabel[status] || status}
      </div>`;

    row.addEventListener('click', () => openResourceDetail(r));
    list.appendChild(row);
  });
}

async function openResourceDetail(resource) {
  // Fetch crew for this resource
  const { data: crew } = await db
    .from('personnel')
    .select('id, name, surname, role, number')
    .eq('resource', resource.id)
    .order('name');

  const crewRows = (crew || []).map(p => `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;
      padding:8px 0;border-bottom:1px solid var(--border);align-items:center;">
      <div style="font-size:13px;font-weight:500;color:var(--text-primary);">
        ${p.name} ${p.surname}
      </div>
      <div>
        ${p.number ? `<a href="tel:${p.number}" style="font-size:13px;color:var(--blue);
          font-weight:600;text-decoration:none;">📞 ${p.number}</a>`
          : '<span style="font-size:12px;color:var(--text-muted);">—</span>'}
      </div>
      <div style="font-size:12px;color:var(--text-secondary);
        font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
        ${p.role || '—'}
      </div>
    </div>`
  ).join('');

  // Use the detail modal to show crew
  const body = document.getElementById('detail-body');
  body.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:18px;font-weight:bold;color:var(--text-primary);">
        ${resource.resource}
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
        ${resource.resource_type}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;
      padding:6px 0;border-bottom:2px solid var(--border-bright);margin-bottom:4px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Nome</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Numero</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;
        color:var(--text-secondary);text-transform:uppercase;">Ruolo</div>
    </div>
    ${crewRows || '<div style="padding:16px 0;color:var(--text-secondary);">Nessun membro</div>'}
  `;

  document.getElementById('detail-title').textContent = resource.resource;
  openModal('modal-detail');
}
/* ----------------------------------------------------------------
   HEADER STATUS UPDATE (from Realtime)
---------------------------------------------------------------- */
function updateHeaderStatus(rcs) {
  if (!rcs) return;
  const dot    = document.getElementById('status-dot');
  const label  = document.getElementById('status-label');
  const labels = { free:'libero', busy:'in intervento', stopped:'fermo' };
  dot.className    = `status-dot ${rcs.status}`;
  label.textContent = labels[rcs.status] || rcs.status;
}
// This updates the status when user changes an intervention status
async function refreshHeaderStatus() {
  const { data: rcs } = await db
    .from('resources_current_status')
    .select('status, active_responses')
    .eq('resource_id', STATE.resource.id)
    .single();
  if (rcs) updateHeaderStatus(rcs);
}
/* ----------------------------------------------------------------
   TAB BAR
---------------------------------------------------------------- */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(targetId) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === targetId)
  );
  document.querySelectorAll('.panel').forEach(p =>
    p.classList.toggle('active', p.id === targetId)
  );

  if (targetId === 'panel-info') {
    loadPositionSection();  // ← reload when tab becomes visible
  }
  if (targetId === 'panel-map') {
    setTimeout(() => {
      initMap();
      invalidateMap();
    }, 50);
  }
}