/* ================================================================
   js/router.js  —  PCA page router
   Swaps content inside #page-content.
   Home page is always kept in DOM, just shown/hidden.
================================================================ */

const PAGES = {
  home:         { label: 'Home',         mount: null,              el: () => document.getElementById('workspace') },
  soccorsi:     { label: 'Soccorsi',     mount: mountSoccorsi     },
  moduli: { label: 'Moduli', mount: mountModuli },
  pma:          { label: 'PMA',          mount: mountPMA          },
  ospedalizzazioni: { label: 'Ospedalizzazioni', mount: mountOspedalizzazioni },
  dispositivo: { label: 'Dispositivo', mount: mountDispositivo },
  impostazioni: { label: 'Impostazioni', mount: mountImpostazioni },
};

let _currentPage = 'home';
let _workspace   = null;   // saved reference, survives innerHTML wipes

function initRouter() {
  // Save workspace reference once — before anything can detach it
  _workspace = document.getElementById('workspace');

  document.querySelectorAll('.sidebar-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  document.getElementById('sidebar-logout')?.addEventListener('click', logout);
}
async function navigateTo(page) {
  if (page === _currentPage) return;

  // Update sidebar active state immediately
  document.querySelectorAll('.sidebar-item[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  const content = document.getElementById('page-content');

  if (page === 'home') {
    _currentPage = page;
    content.innerHTML = '';
    content.appendChild(_workspace);
    if (PCA.map) PCA.map.invalidateSize();
    loadAllIncidents();
    loadAllResources();

    return;
  }

  // Detach workspace safely before wiping content
  if (_workspace && _workspace.parentNode) {
    _workspace.remove();
  }

  content.innerHTML = '<div class="page-loading">Caricamento...</div>';

  const pageDef = PAGES[page];
  if (!pageDef?.mount) {
    _currentPage = page;
    return;
  }

  try {
    await pageDef.mount(content);
    _currentPage = page;
  } catch (err) {
    console.error('Navigation error:', err);
    content.innerHTML = `<div class="empty-state">Errore: ${err.message}</div>`;
    // Revert sidebar active state
    document.querySelectorAll('.sidebar-item[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === _currentPage);
    });
  }
}
