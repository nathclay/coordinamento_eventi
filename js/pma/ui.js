/* ================================================================
   js/ui.js
   Shared UI helpers: screen transitions, toasts, modals.
   No Supabase calls here — pure DOM manipulation.
================================================================ */

/* ----------------------------------------------------------------
   SCREEN TRANSITIONS
   Screens are stacked absolutely. One is visible at a time.
---------------------------------------------------------------- */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('hidden', s.id !== id);
  });
}

/* ----------------------------------------------------------------
   TOAST NOTIFICATIONS
   Types: 'success' | 'error' | 'offline'
---------------------------------------------------------------- */
function showToast(msg, type = 'success', duration = 3000) {
  const icons = { success: '✓', error: '✕', offline: '⚡' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || '·'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ----------------------------------------------------------------
   MODAL — BOTTOM SHEET
---------------------------------------------------------------- */
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

/* ----------------------------------------------------------------
   ONLINE/OFFLINE STATUS
---------------------------------------------------------------- */
function updateOnlineStatus() {
  STATE.isOnline = navigator.onLine;
  const badge = document.getElementById('offline-badge');
  if (badge) badge.classList.toggle('visible', !STATE.isOnline);
}

window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);