/* ================================================================
   js/views/main.js
   Main view: loads all data, populates panels, wires up tabs.
   Called after auth + personnel selection are complete.
   Depends on: rpc.js, ui.js, state.js, realtime.js, location.js,
               map.js, incidents.js
================================================================ */

/* ----------------------------------------------------------------
   RESOURCE TYPE LABELS
---------------------------------------------------------------- */
const RESOURCE_TYPE_LABELS = {
  ASM:   'Ambulanza di Soccorso',
  ASI:   'Ambulanza di Supporto Infermieristico',
  SAP:   'Squadra a Piedi',
  BICI:  'Squadra in Bicicletta',
  MM:    'Medico Mobile',
  LDC:   'Luogo di Coordinamento',
  PMA:   'Posto Medico Avanzato',
  ALTRO: 'Altra Risorsa',
};

/* ----------------------------------------------------------------
   LOAD MAIN VIEW
   Entry point called by auth.js after login + personnel selection.
---------------------------------------------------------------- */
async function loadMainView() {
  const r = STATE.resource;

  // Set coordinator mode — shows extra tab + sector blocks
  if (r.resource_type === 'LDC') {
    document.body.classList.add('is-coordinator');
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
    r.resource_type === 'LDC' ? loadSectorResources() : Promise.resolve(),
  ]);

  // Realtime + location
  subscribeRealtime();
  startLocationTracking();

  // Register Realtime callbacks
  onIncidentChange(() => loadIncidents());
  onResourceStatusChange(rcs => updateHeaderStatus(rcs));

  // Init maps (lazy — mini-map renders immediately, coordinator map deferred)
  initMiniMap();

  // Wire up tab bar
  initTabs();

  // Wire up incident form events
  initIncidentForm();

  // Show the main view
  showScreen('screen-main');
}

/* ----------------------------------------------------------------
   EVENT PANEL
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

  // Coordinator — fetch from resources where this resource's coordinator field is set
  if (r.coordinator) {
    document.getElementById('coordinator-name').textContent = r.coordinator;
  }
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

  crew.forEach(p => {
    const isMe = STATE.personnel && STATE.personnel.id === p.id;
    const row  = document.createElement('div');
    row.className = 'crew-member-row';
    row.innerHTML = `
      <div class="crew-avatar ${isMe ? 'is-me' : ''}">👤</div>
      <div class="crew-name">${p.name} ${p.surname}</div>
      <div class="crew-role">${p.role || ''}</div>
      ${isMe ? '<span class="you-badge">TU</span>' : ''}
    `;
    list.appendChild(row);
  });
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

  // Invalidate Leaflet maps when switching to their panels
  if (targetId === 'panel-map')  initCoordinatorMap();
  if (targetId === 'panel-map')  invalidateCoordinatorMap();
  if (targetId === 'panel-info') invalidateMiniMap();
}