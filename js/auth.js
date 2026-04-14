/* ================================================================
   js/auth.js
   Unified auth for mobile.html, pma.html, pca.html.

   Each HTML file sets AUTH_MODE before loading this script:
     mobile.html → <script>const AUTH_MODE = 'mobile';</script>
     pma.html    → <script>const AUTH_MODE = 'pma';</script>
     pca.html    → <script>const AUTH_MODE = 'pca';</script>

   Depends on: supabase.js, state.js, ui.js
================================================================ */

/* ----------------------------------------------------------------
   ROLE CONFIG
---------------------------------------------------------------- */
const ROLE_MAP = {
  pma:    ['PMA'],
  pca:    ['PCA'],
  mobile: ['ASM', 'ASI', 'SAP', 'BICI', 'MM', 'LDC', 'ALTRO'],
};

function isAllowed(resource_type) {
  return (ROLE_MAP[AUTH_MODE] || []).includes(resource_type);
}

function accessDeniedMessage(resource_type) {
  const pages = { PMA: 'pma.html', PCA: 'pca.html' };
  const correctPage = pages[resource_type] || 'mobile.html';
  if (AUTH_MODE === 'pma')
    return `Questa pagina è riservata al PMA.`;
  if (AUTH_MODE === 'pca')
    return `Questa pagina è riservata al Posto di Comando.`;
  return `Questa pagina è riservata alle squadre operative.`;
}

/* ----------------------------------------------------------------
   LAUNCH — called after auth + personnel confirmed.
   Each view file exposes one entry point:
     loadMobileView()  — js/views/mobile.js  (was main.js)
     loadPMAView()     — js/views/pma.js
     loadPCAView()     — js/views/pca.js
---------------------------------------------------------------- */
function launchView() {
  if (AUTH_MODE === 'pma')      loadPMAView();
  else if (AUTH_MODE === 'pca') loadPCAView();
  else                          loadMobileView();
}

/* ----------------------------------------------------------------
   BOOT — called via window.addEventListener('load', ...) in each HTML
---------------------------------------------------------------- */
async function boot() {
  if (AUTH_MODE === 'mobile' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Don't show login yet — wait for session check first
  showScreen('screen-loading');

  const { data: { session } } = await db.auth.getSession();

  if (!session) {
    showScreen('screen-login');
    return;
  }

  STATE.session = session;
  await restoreResourceFromSession(session.user.email);
}

/* ----------------------------------------------------------------
   RESTORE SESSION (page reload with existing session)
---------------------------------------------------------------- */
async function restoreResourceFromSession(email) {
  const { data: resource } = await db
    .from('resources')
    .select('*, event_radio_channels(channel_name, description), coordinator:coordinator_id(id, resource, resource_type)')
    .eq('user_email', email)
    .single();

  if (!resource) {
    await db.auth.signOut();
    showScreen('screen-login');
    return;
  }

  if (!isAllowed(resource.resource_type)) {
    await db.auth.signOut();
    showLoginError(accessDeniedMessage(resource.resource_type));
    showScreen('screen-login');
    return;
  }

  STATE.resource = resource;

  const { data: event } = await db
    .from('events')
    .select('*')
    .eq('is_active', true)
    .single();

  STATE.event = event;

  const cachedPersonnel = localStorage.getItem('cge_personnel');
  if (cachedPersonnel) {
    STATE.personnel = JSON.parse(cachedPersonnel);
    launchView();
  } else {
    loadPersonnelScreen();
  }
}

/* ----------------------------------------------------------------
   LOGIN FORM
---------------------------------------------------------------- */
async function handleLogin(e) {
  e.preventDefault();

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('btn-login');

  showLoginError('');
  btn.disabled    = true;
  btn.textContent = 'Accesso...';

  try {
    const { data: authData, error: authError } =
      await db.auth.signInWithPassword({ email, password });
    if (authError) throw new Error('Email o password errati.');

    STATE.session = authData.session;

    const { data: resource, error: resError } = await db
      .from('resources')
      .select('*, event_radio_channels(channel_name, description), coordinator:coordinator_id(id, resource, resource_type)')
      .eq('user_email', email)
      .single();

    if (resError || !resource)
      throw new Error('Nessuna risorsa associata a questa email.');

    if (!isAllowed(resource.resource_type)) {
      await db.auth.signOut();
      throw new Error(accessDeniedMessage(resource.resource_type));
    }

    STATE.resource = resource;

    const { data: event } = await db
      .from('events')
      .select('*')
      .eq('is_active', true)
      .single();

    STATE.event = event;

    loadPersonnelScreen();

  } catch (err) {
    showLoginError(err.message);
    btn.disabled    = false;
    btn.textContent = 'Accedi';
  }
}

/* ----------------------------------------------------------------
   PERSONNEL SCREEN
---------------------------------------------------------------- */
async function loadPersonnelScreen() {
  document.getElementById('personnel-resource-name').textContent =
    STATE.resource.resource;

  const { data: personnel } = await db
    .from('personnel')
    .select('id, name, surname, role')
    .eq('resource', STATE.resource.id)
    // .eq('present', true)  TODO: add when present tracking is live
    .order('name');

  const list = document.getElementById('personnel-list');
  list.innerHTML = '';

  if (!personnel || personnel.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <div class="empty-text">Nessun membro registrato per questa risorsa</div>
      </div>`;
  } else {
    personnel.forEach(p => {
      const card = document.createElement('div');
      card.className = 'personnel-card';
      card.innerHTML = `
        <div class="personnel-avatar">👤</div>
        <div class="personnel-info">
          <div class="personnel-name">${p.name} ${p.surname}</div>
          <div class="personnel-role">${p.role || '—'}</div>
        </div>
        <span class="personnel-arrow">›</span>`;
      card.addEventListener('click', () => selectPersonnel(p));
      list.appendChild(card);
    });
  }

  showScreen('screen-personnel');
}

function selectPersonnel(p) {
  STATE.personnel = p;
  localStorage.setItem('cge_personnel', JSON.stringify(p));
  launchView();
}

/* ----------------------------------------------------------------
   LOGOUT
---------------------------------------------------------------- */
async function logout() {
  await db.auth.signOut();
  localStorage.removeItem('cge_personnel');
  STATE.resource  = null;
  STATE.event     = null;
  STATE.personnel = null;
  STATE.session   = null;
  if (STATE.incidents) STATE.incidents = [];
  showScreen('screen-login');
}

/* ----------------------------------------------------------------
   HELPERS
---------------------------------------------------------------- */
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) el.textContent = msg;
}

/* ----------------------------------------------------------------
   WIRE DOM — called once from each HTML file's boot script
---------------------------------------------------------------- */
function initAuth() {
  document.getElementById('login-form')
    ?.addEventListener('submit', handleLogin);

  document.getElementById('personnel-skip')
    ?.addEventListener('click', () => {
      STATE.personnel = null;
      launchView();
    });

  document.getElementById('btn-logout')
    ?.addEventListener('click', logout);
}