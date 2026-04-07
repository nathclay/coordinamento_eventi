/* ================================================================
   js/auth.js
   Login flow, session persistence, personnel selection.
   Depends on: supabase.js, state.js, ui.js
================================================================ */

/* ----------------------------------------------------------------
   BOOT — called on window load
   Checks for existing session first, shows login if none.
---------------------------------------------------------------- */
async function boot() {
  // Register service worker (mobile PWA only)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Check for existing db session
  const { data: { session } } = await db.auth.getSession();

  if (!session) {
    showScreen('screen-login');
    return;
  }

  // Session found — restore state without showing login
  STATE.session = session;
  await restoreResourceFromSession(session.user.email);
}

/* ----------------------------------------------------------------
   RESTORE RESOURCE FROM SESSION
   Used on page load when session already exists.
---------------------------------------------------------------- */
async function restoreResourceFromSession(email) {
  const { data: resource } = await db
    .from('resources')
    .select('*, event_radio_channels(channel_name, description)')
    .eq('user_email', email)
    .single();

  if (!resource) {
    // Resource not found — session is stale, sign out
    await db.auth.signOut();
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

  // Skip personnel selection if already chosen this session
  const cachedPersonnel = sessionStorage.getItem('wai_personnel');
  if (cachedPersonnel) {
    STATE.personnel = JSON.parse(cachedPersonnel);
    loadMainView();
  } else {
    loadPersonnelScreen();
  }
}

/* ----------------------------------------------------------------
   LOGIN FORM HANDLER
---------------------------------------------------------------- */
async function handleLogin(e) {
  e.preventDefault();

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('btn-login');
  const errEl    = document.getElementById('login-error');

  errEl.textContent = '';
  btn.disabled  = true;
  btn.textContent = 'Accesso...';

  try {
    // 1. Sign in with db Auth
    const { data: authData, error: authError } =
      await db.auth.signInWithPassword({ email, password });

    if (authError) throw new Error('Email o password errati.');

    STATE.session = authData.session;

    // 2. Find the resource linked to this email
    const { data: resource, error: resError } = await db
      .from('resources')
      .select('*, event_radio_channels(channel_name, description)')
      .eq('user_email', email)
      .single();

    if (resError || !resource) {
      throw new Error('Nessuna risorsa associata a questa email.');
    }

    // 3. Role guard — PCA users belong on pca.html
    const mobileRoles = ['ASM','ASI','SAP','BICI','MM','LDC','ALTRO','PMA'];
    if (!mobileRoles.includes(resource.resource_type)) {
      window.location.href = 'pca.html';
      return;
    }

    STATE.resource = resource;

    // 4. Load active event
    const { data: event } = await db
      .from('events')
      .select('*')
      .eq('is_active', true)
      .single();

    STATE.event = event;

    // 5. Move to personnel selection
    loadPersonnelScreen();

  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled  = false;
    btn.textContent = 'Accedi';
  }
}

/* ----------------------------------------------------------------
   PERSONNEL SELECTION SCREEN
---------------------------------------------------------------- */
async function loadPersonnelScreen() {
  // Show resource name badge
  document.getElementById('personnel-resource-name').textContent =
    STATE.resource.resource;

  // Load present crew members
  const { data: personnel } = await db
    .from('personnel')
    .select('id, name, surname, role')
    .eq('resource', STATE.resource.id)
    .eq('present', true)
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
        <span class="personnel-arrow">›</span>
      `;
      card.addEventListener('click', () => selectPersonnel(p));
      list.appendChild(card);
    });
  }

  showScreen('screen-personnel');
}

function selectPersonnel(p) {
  STATE.personnel = p;
  sessionStorage.setItem('wai_personnel', JSON.stringify(p));
  loadMainView();
}

/* ----------------------------------------------------------------
   LOGOUT
---------------------------------------------------------------- */
async function logout() {
  await db.auth.signOut();
  sessionStorage.removeItem('wai_personnel');
  STATE.resource = STATE.event = STATE.personnel = STATE.session = null;
  STATE.incidents = [];
  showScreen('screen-login');
}

/* ----------------------------------------------------------------
   WIRE UP DOM EVENTS
   Called once on load after DOM is ready.
---------------------------------------------------------------- */
function initAuth() {
  document.getElementById('login-form')
    .addEventListener('submit', handleLogin);

  document.getElementById('personnel-skip')
    .addEventListener('click', () => {
      STATE.personnel = null;
      loadMainView();
    });

  document.getElementById('btn-logout')
    ?.addEventListener('click', logout);
}