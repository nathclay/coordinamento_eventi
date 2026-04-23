/* ================================================================
   js/views/pca-moduli.js  —  Moduli operativi page
   Full resource table grouped by type, with status, coordinator
   assignment, position age, and incident counts.

   Mounted by router.js into #page-content.
   Depends on: pca-rpc.js, pca.js (formatTime, openResourceDetailModal,
               statusItalian, ageLabel, ageClass)
================================================================ */

/* ================================================================
   MOUNT
   mountModuli — builds page shell and triggers render.
================================================================ */
const MODULI_TYPES = [
  { key: 'ASM',  label: 'Ambulanze ASM' },
  { key: 'ASI',  label: 'Ambulanze ASI' },
  { key: 'SAP',  label: 'SAP' },
  { key: 'BICI', label: 'Bici' },
  { key: 'MM',   label: 'Motomedicali' },
  { key: 'LDC',  label: 'LDC — Coordinatori' },
  { key: 'ALTRO',label: 'Altro' },
];

async function mountModuli(container) {
  container.innerHTML = `
    <div class="moduli-page">
      <div class="moduli-header">
        <h2 class="moduli-title">Moduli operativi</h2>
        <span class="moduli-updated" id="moduli-updated">—</span>
      </div>
      <div class="moduli-body" id="moduli-body">
        <div class="empty-state">Caricamento...</div>
      </div>
    </div>`;

  await renderModuliTables();
}

/* ================================================================
   DATA & RENDER
   renderModuliTables — fetches resources and response counts,
                        groups by type, renders all sections.
   buildTypeSection   — builds the table section for a resource type
                        with free/busy/stopped summary counts.
   buildResourceRow   — builds a single resource row with coordinator
                        dropdown, position age and incident counts.
================================================================ */
async function renderModuliTables() {
  const body = document.getElementById('moduli-body');
  if (!body) return;

  // Fetch resources with current status + incident counts
  const resources = await fetchModuliResources(PCA.eventId);

  // Fetch total incident counts per resource (all non-cancelled responses)
  const totalMap = await fetchResourceResponseCounts(PCA.eventId);

  // Group by type
  const byType = {};
  (resources || []).forEach(r => {
    const t = r.resource_type;
    if (!byType[t]) byType[t] = [];
    byType[t].push(r);
  });

  // Update timestamp
  const updatedEl = document.getElementById('moduli-updated');
  if (updatedEl) updatedEl.textContent = `Aggiornato alle ${formatTime(new Date().toISOString())}`;

  // Render
  const sections = MODULI_TYPES
    .filter(t => byType[t.key]?.length > 0)
    .map(t => buildTypeSection(t, byType[t.key], totalMap))
    .join('');

  body.innerHTML = sections || '<div class="empty-state">Nessuna risorsa configurata</div>';
}

function buildTypeSection(typeDef, resources, totalMap) {
  const freeCount    = resources.filter(r => r.resources_current_status?.status === 'free').length;
  const busyCount    = resources.filter(r => r.resources_current_status?.status === 'busy').length;
  const stoppedCount = resources.filter(r => r.resources_current_status?.status === 'stopped').length;

  const rows = resources.map(r => buildResourceRow(r, totalMap)).join('');

  return `
    <div class="moduli-section">
      <div class="moduli-section-header">
        <span class="moduli-section-title">${typeDef.label}</span>
        <div class="moduli-section-stats">
          <span class="mss free">${freeCount} libere</span>
          <span class="mss busy">${busyCount} in intervento</span>
          ${stoppedCount > 0 ? `<span class="mss stopped">${stoppedCount} ferme</span>` : ''}
          <span class="mss total">${resources.length} tot.</span>
        </div>
      </div>
      <table class="moduli-table">
        <thead>
          <tr>
            <th class="col-status">Stato</th>
            <th class="col-name">Nome</th>
            <th class="col-coord">Coordinatore</th>
            <th class="col-pos">Ultima pos.</th>
            <th class="col-lastint">Ultimo int.</th>
            <th class="col-active">Attivi</th>
            <th class="col-total">Tot. int.</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildResourceRow(r, totalMap) {
  const rcs    = r.resources_current_status;
  const status = rcs?.status || 'free';
  const active = rcs?.active_responses || 0;
  const total  = totalMap[r.id] || 0;

  const posAge  = rcs?.location_updated_at ? ageLabel(rcs.location_updated_at) : '—';
  const posClass = rcs?.location_updated_at ? ageClass(rcs.location_updated_at) : '';
  const lastInt = rcs?.last_response_at ? formatTime(rcs.last_response_at) : '—';
  const coord   = r.coordinator?.resource || '—';

  const statusLabels = { free: 'Libera', busy: 'In int.', stopped: 'Ferma' };

  // Build coordinator dropdown from LDC resources in PCA.allResources
  const ldcs = PCA.allResources.filter(res => res.resource_type === 'LDC');
  const coordOptions = `<option value="">— Nessuno —</option>` +
    ldcs.map(ldc => `
      <option value="${ldc.id}" ${r.coordinator?.id === ldc.id ? 'selected' : ''}>
        ${ldc.resource}
      </option>`).join(''); 

  return `
    <tr class="moduli-row ${status}">
      <td class="col-status">
        <span class="moduli-status-badge ${status}">${statusLabels[status]}</span>
      </td>
      <td class="col-name" onclick="openResourceDetailModal('${r.id}')" style="cursor:pointer">
        <strong>${r.resource}</strong>
        ${r.notes ? `<span class="row-notes" title="${r.notes}">…</span>` : ''}
      </td>
      <td class="col-coord">
        <select class="coord-select" onchange="updateCoordinator('${r.id}', this.value)">
          ${coordOptions}
        </select>
      </td>
      <td class="col-pos ${posClass}">${posAge}</td>
      <td class="col-lastint">${lastInt}</td>
      <td class="col-active">${active > 0 ? `<span class="active-badge">${active}</span>` : '—'}</td>
      <td class="col-total">${total || '—'}</td>
    </tr>`;
}

/* ================================================================
   MUTATIONS
   updateCoordinator — updates coordinator assignment via rpc,
                       syncs PCA.allResources local cache so the
                       home map popup stays in sync without a reload.
================================================================ */
async function updateCoordinator(resourceId, coordinatorId) {
  const ok = await updateResourceCoordinator(resourceId, coordinatorId);
  if (!ok) {
    showToast('Errore aggiornamento coordinatore', 'error');
    return;
  }

  showToast('Coordinatore aggiornato ✓', 'success');

  // Update local PCA.allResources so the home map popup stays in sync
  const r = PCA.allResources.find(r => r.id === resourceId);
  if (r) {
    const ldc = PCA.allResources.find(l => l.id === coordinatorId);
    r.coordinator = ldc ? { id: ldc.id, resource: ldc.resource } : null;
  }
}

/* ================================================================
   HELPERS
   ageLabel — converts a timestamp to a human-readable age string
              (e.g. "3 min fa", "1h 12m fa").
   ageClass — returns a CSS class based on position age:
              age-fresh (<10min), age-mid (<30min), age-stale.
================================================================ */
function ageLabel(ts) {
  const mins = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (mins < 1)  return '< 1 min';
  if (mins < 60) return `${mins} min fa`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m fa`;
}

function ageClass(ts) {
  const mins = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (mins < 10) return 'age-fresh';
  if (mins < 30) return 'age-mid';
  return 'age-stale';
}