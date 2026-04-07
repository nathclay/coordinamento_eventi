/* ================================================================
   js/rpc.js
   All Supabase database calls — queries, inserts, RPCs.
   Views call these functions, never supabase directly.
   Handles offline queuing transparently.
================================================================ */

/* ----------------------------------------------------------------
   INCIDENTS
---------------------------------------------------------------- */

// Load incidents for this resource (or all sector resources for coordinator)
async function fetchIncidents() {
  if (STATE.resource.resource_type === 'LDC') {
    // Coordinator: get all resources in their sector first
    const { data: sectorResources } = await db
      .from('resources')
      .select('id')
      .eq('event_id', STATE.resource.event_id)
      .eq('coordinator', STATE.resource.resource);

    const resourceIds = (sectorResources || []).map(r => r.id);
    // Also include the coordinator's own resource
    resourceIds.push(STATE.resource.id);

    // Get all incidents where any of these resources has a response
    const { data: responses } = await db
      .from('incident_responses')
      .select('incident_id')
      .in('resource_id', resourceIds);

    const incidentIds = [...new Set((responses || []).map(r => r.incident_id))];
    if (incidentIds.length === 0) return [];

    const { data: incidents } = await db
      .from('incidents')
      .select('id, incident_type, status, current_triage, patient_name, patient_identifier, patient_age, patient_gender, created_at, reported_by_resource_id')
      .in('id', incidentIds)
      .order('created_at', { ascending: false });

    return incidents || [];

  } else {
    // Regular resource: only incidents they have a response on
    const { data: responses } = await db
      .from('incident_responses')
      .select('incident_id')
      .eq('resource_id', STATE.resource.id)
      .order('assigned_at', { ascending: false });

    const incidentIds = [...new Set((responses || []).map(r => r.incident_id))];
    if (incidentIds.length === 0) return [];

    const { data: incidents } = await db
      .from('incidents')
      .select('id, incident_type, status, current_triage, patient_name, patient_identifier, patient_age, patient_gender, created_at')
      .in('id', incidentIds)
      .order('created_at', { ascending: false });

    return incidents || [];
  }
}

// Load full incident detail including responses and assessments
async function fetchIncidentDetail(incidentId) {
  const { data, error } = await db
    .from('incidents')
    .select(`
      *,
      incident_responses(
        id, role, outcome, assigned_at, released_at, notes, hospital_info,
        resources(resource, resource_type)
      ),
      patient_assessments(
        id, assessed_at, conscious, respiration, circulation,
        walking, heart_rate, spo2, breathing_rate, GCS_total,
        triage, notes, blood_pressure
      )
    `)
    .eq('id', incidentId)
    .single();

  if (error) return null;
  return data;
}

// Create new incident via RPC (atomic — incidents + response + assessment in one transaction)
async function createIncident(params) {
  if (!STATE.isOnline) {
    queueOffline('create_incident_with_assessment', params);
    return { offline: true };
  }

  const { data, error } = await db
    .rpc('create_incident_with_assessment', params);

  if (error) throw error;
  return { data };
}

// Update a response outcome (close/transport/release)
async function updateResponseOutcome(responseId, outcome, extraFields = {}) {
  const { error } = await db
    .from('incident_responses')
    .update({
      outcome,
      released_at: new Date().toISOString(),
      ...extraFields
    })
    .eq('id', responseId);

  if (error) throw error;
}

// Find the active (treating) response for the current resource on a given incident
async function findActiveResponse(incidentId) {
  const { data, error } = await db
    .from('incident_responses')
    .select('id')
    .eq('incident_id', incidentId)
    .eq('resource_id', STATE.resource.id)
    .eq('outcome', 'treating')
    .single();

  if (error) return null;
  return data;
}

/* ----------------------------------------------------------------
   PERSONNEL & CREW
---------------------------------------------------------------- */
async function fetchCrew() {
  const { data } = await db
    .from('personnel')
    .select('id, name, surname, role')
    .eq('resource', STATE.resource.id)
    .eq('present', true)
    .order('name');

  return data || [];
}

/* ----------------------------------------------------------------
   RESOURCES (for coordinator sector view)
---------------------------------------------------------------- */
async function fetchSectorResources() {
  const { data } = await db
    .from('resources')
    .select('id, resource, resource_type, resources_current_status(status, active_responses)')
    .eq('event_id', STATE.resource.event_id)
    .eq('coordinator', STATE.resource.resource);

  return data || [];
}

/* ----------------------------------------------------------------
   LOCATION
---------------------------------------------------------------- */
async function insertLocation(coords) {
  const { error } = await db
    .from('location_history')
    .insert({
      resource_id: STATE.resource.id,
      event_id:    STATE.resource.event_id,
      geom:        `POINT(${coords.longitude} ${coords.latitude})`,
      accuracy_m:  coords.accuracy   || null,
      speed_kmh:   coords.speed != null ? coords.speed * 3.6 : null,
      heading_deg: coords.heading    || null,
    });

  // Location inserts fail silently — best effort
  if (error) console.warn('Location insert failed:', error.message);
}

/* ----------------------------------------------------------------
   OFFLINE QUEUE
   Simple sessionStorage fallback — replaced by IndexedDB in offline.js
---------------------------------------------------------------- */
function queueOffline(fn, params) {
  const queue = JSON.parse(sessionStorage.getItem('wai_offline_queue') || '[]');
  queue.push({ fn, params, timestamp: Date.now() });
  sessionStorage.setItem('wai_offline_queue', JSON.stringify(queue));
}

async function replayOfflineQueue() {
  const queue = JSON.parse(sessionStorage.getItem('wai_offline_queue') || '[]');
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    try {
      if (item.fn === 'create_incident_with_assessment') {
        await db.rpc(item.fn, item.params);
      }
      // Add other queued function types here as needed
    } catch (err) {
      remaining.push(item); // keep failed items for next retry
    }
  }

  sessionStorage.setItem('wai_offline_queue', JSON.stringify(remaining));

  if (queue.length > remaining.length) {
    const sent = queue.length - remaining.length;
    showToast(`${sent} intervento/i offline sincronizzato/i ✓`, 'success', 4000);
    loadIncidents(); // refresh the list
  }
}

// Try to replay queue whenever we come back online
window.addEventListener('online', () => {
  setTimeout(replayOfflineQueue, 1000);
});