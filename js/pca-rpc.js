/* ================================================================
   js/pca-rpc.js
   All Supabase database calls for the PCA dashboard.
   Views call these functions — never touch `db` directly.

   Organised by domain:
     INCIDENTS   — list queries for home panel and sub-pages
     RESOURCES   — list queries for home panel and sub-pages
     MODALS      — deep single-record fetches for detail modals
     PMA         — PMA page fetch functions
     GEO         — geo layer table fetch
     MUTATIONS   — all writes (update, insert, rpc)

   Depends on: supabase.js (db), state.js (STATE/PCA)
================================================================ */


/* ================================================================
   INCIDENTS
================================================================ */

/* ── Home panel + map markers ──────────────────────────────────
   Lightweight — called on every Realtime event.
   Does NOT include patient_assessments (too heavy for polling).
---------------------------------------------------------------- */
async function fetchPCAIncidents(eventId) {
  const { data, error } = await db
    .from('incidents')
    .select(`
      id, incident_type, status, current_triage,
      patient_name, patient_identifier, patient_age,
      created_at, updated_at, geom, description,
      incident_responses(
        id, outcome, resource_id,
        resources!incident_responses_resource_id_fkey(resource, resource_type)
      )
    `)
    .eq('event_id', eventId)
    .not('status', 'in', '("cancelled")')
    .order('updated_at', { ascending: false });

  if (error) { console.error('fetchPCAIncidents:', error); return []; }
  return data || [];
}

/* ── Soccorsi page ─────────────────────────────────────────────
   Full query including assessments and patient_gender.
   Heavier — only called when user navigates to Soccorsi page.
---------------------------------------------------------------- */
async function fetchSoccorsiIncidents(eventId) {
  const { data, error } = await db
    .from('incidents')
    .select(`
      id, incident_type, status, current_triage,
      patient_name, patient_identifier, patient_age, patient_gender,
      created_at, updated_at, description,
      incident_responses(
        id, outcome, assigned_at, released_at,
        resources!incident_responses_resource_id_fkey(id, resource, resource_type)
      ),
      patient_assessments(
        id, assessed_at, triage,
        conscious, respiration, circulation,
        description, clinical_notes,
        heart_rate, spo2, breathing_rate, blood_pressure,
        temperature, iv_access, bed_number_pma
      )
    `)
    .eq('event_id', eventId)
    .not('status', 'eq', 'cancelled')
    .order('created_at', { ascending: false });

  if (error) { console.error('fetchSoccorsiIncidents:', error); return []; }
  return data || [];
}


/* ================================================================
   RESOURCES
================================================================ */

/* ── Home panel + map markers ──────────────────────────────────
   Called on every Realtime event.
---------------------------------------------------------------- */
async function fetchPCAResources(eventId) {
  const { data, error } = await db
    .from('resources')
    .select(`
      id, resource, resource_type, notes,
      resources_current_status(
        status, active_responses, geom,
        location_updated_at, last_response_at
      )
    `)
    .eq('event_id', eventId)
    .order('resource');

  if (error) { console.error('fetchPCAResources:', error); return []; }
  return data || [];
}

/* ── Moduli page ───────────────────────────────────────────────
   Includes coordinator join. Excludes PMA and PCA rows.
---------------------------------------------------------------- */
async function fetchModuliResources(eventId) {
  const { data, error } = await db
    .from('resources')
    .select(`
      id, resource, resource_type, notes,
      coordinator:coordinator_id(id, resource),
      resources_current_status(
        status, active_responses, geom,
        location_updated_at, last_response_at
      )
    `)
    .eq('event_id', eventId)
    .not('resource_type', 'in', '("PMA","PCA")')
    .order('resource');

  if (error) { console.error('fetchModuliResources:', error); return []; }
  return data || [];
}

/* ── Moduli page — response counts ────────────────────────────
   Returns { resource_id → total count } map.
---------------------------------------------------------------- */
async function fetchResourceResponseCounts(eventId) {
  const { data, error } = await db
    .from('incident_responses')
    .select('resource_id')
    .eq('event_id', eventId)
    .not('outcome', 'eq', 'cancelled');

  if (error) { console.error('fetchResourceResponseCounts:', error); return {}; }

  const map = {};
  (data || []).forEach(r => {
    map[r.resource_id] = (map[r.resource_id] || 0) + 1;
  });
  return map;
}

/* ── PMA resource list ─────────────────────────────────────────
   Used by pca-pma mount to build tab list.
---------------------------------------------------------------- */
async function fetchPMAResources(eventId) {
  const { data, error } = await db
    .from('resources')
    .select('id, resource')
    .eq('event_id', eventId)
    .eq('resource_type', 'PMA')
    .order('resource');

  if (error) { console.error('fetchPMAResources:', error); return []; }
  return data || [];
}


/* ================================================================
   MODALS — deep single-record fetches
================================================================ */

/* ── Incident detail modal ─────────────────────────────────────
   Full incident with all responses, assessments and personnel.
   Called when operator clicks a card or map popup.
---------------------------------------------------------------- */
async function fetchIncidentDetail(incidentId) {
  const { data, error } = await db
    .from('incidents')
    .select(`
      *,
      incident_responses(
        id, role, outcome, assigned_at, released_at, notes, hospital_info,
        resources!incident_responses_resource_id_fkey(id, resource, resource_type)
      ),
      patient_assessments(
        id, assessed_at, response_id, triage,
        conscious, respiration, circulation, walking, minor_injuries,
        heart_rate, spo2, breathing_rate, blood_pressure,
        temperature, gcs_total, iv_access, bed_number_pma,
        description, clinical_notes,
        personnel:assessed_by(name, surname)
      )
    `)
    .eq('id', incidentId)
    .single();

  if (error) { console.error('fetchIncidentDetail:', error); return null; }
  return data;
}

/* ── Resource detail modal — crew ──────────────────────────────
   Personnel list for a single resource.
---------------------------------------------------------------- */
async function fetchResourceCrew(resourceId) {
  const { data, error } = await db
    .from('personnel')
    .select('id, name, surname, role, number, comitato')
    .eq('resource', resourceId)
    .order('name');

  if (error) { console.error('fetchResourceCrew:', error); return []; }
  return data || [];
}

/* ── Resource detail modal — incident history ──────────────────
   All responses for a resource, ordered newest first.
---------------------------------------------------------------- */
async function fetchResourceHistory(resourceId) {
  const { data, error } = await db
    .from('incident_responses')
    .select('incident_id, outcome, assigned_at, incidents(incident_type, current_triage, status)')
    .eq('resource_id', resourceId)
    .order('assigned_at', { ascending: false });

  if (error) { console.error('fetchResourceHistory:', error); return []; }
  return data || [];
}


/* ================================================================
   PMA PAGE
   These were already extracted functions in pca-pma.js.
   Moved here to centralise all DB access.
================================================================ */

async function fetchPCAPMAIncoming(pmaId) {
  const { data, error } = await db
    .from('incident_responses')
    .select(`
      id, outcome, dest_pma_id, assigned_at,
      incidents(
        id, patient_name, patient_identifier, patient_age, patient_gender,
        current_triage, description,
        patient_assessments(
          id, assessed_at, conscious, respiration, circulation,
          walking, minor_injuries, heart_rate, spo2, breathing_rate,
          blood_pressure, temperature, gcs_total, hgt, triage,
          description, clinical_notes, iv_access
        )
      ),
      resources!incident_responses_resource_id_fkey(resource, resource_type)
    `)
    .eq('outcome', 'en_route_to_pma')
    .eq('dest_pma_id', pmaId)
    .order('assigned_at', { ascending: false });

  if (error) { console.error('fetchPCAPMAIncoming:', error); return []; }
  return data || [];
}

async function fetchPCAPMAActive(pmaId) {
  const { data, error } = await db
    .from('incident_responses')
    .select(`
      id, outcome, assigned_at,
      incidents(
        id, patient_name, patient_identifier, patient_age, patient_gender,
        current_triage, description,
        patient_assessments(
          id, assessed_at, conscious, respiration, circulation,
          walking, minor_injuries, heart_rate, spo2, breathing_rate,
          blood_pressure, temperature, gcs_total, hgt, triage,
          description, clinical_notes, iv_access, bed_number_pma
        )
      )
    `)
    .eq('resource_id', pmaId)
    .eq('outcome', 'treating')
    .order('assigned_at', { ascending: false });

  if (error) { console.error('fetchPCAPMAActive:', error); return []; }
  return data || [];
}

async function fetchPCAPMAClosed(pmaId) {
  const { data, error } = await db
    .from('incident_responses')
    .select(`
      id, outcome, released_at, dest_hospital, handoff_to_response_id,
      incidents(
        id, patient_name, patient_identifier, patient_age, patient_gender,
        current_triage,
        patient_assessments(
          id, assessed_at, conscious, respiration, circulation,
          walking, minor_injuries, heart_rate, spo2, breathing_rate,
          blood_pressure, temperature, gcs_total, hgt, triage,
          description, clinical_notes, iv_access
        )
      )
    `)
    .eq('resource_id', pmaId)
    .in('outcome', ['treated_and_released', 'handed_off'])
    .order('released_at', { ascending: false });

  if (error) { console.error('fetchPCAPMAClosed:', error); return []; }
  return data || [];
}

/* ── PMA storico modal ─────────────────────────────────────────
   Full assessment history for a single incident.
   Returns { incident, assessments[] } with resource names resolved.
---------------------------------------------------------------- */
async function fetchPCAStorico(incidentId) {
  const { data: inc, error } = await db
    .from('incidents')
    .select(`
      *, patient_assessments(
        id, assessed_at, conscious, respiration, circulation,
        walking, minor_injuries, heart_rate, spo2, breathing_rate,
        blood_pressure, temperature, gcs_total, hgt, triage,
        description, clinical_notes, response_id
      )
    `)
    .eq('id', incidentId)
    .single();

  if (error || !inc) { console.error('fetchPCAStorico:', error); return null; }

  // Resolve resource names for each assessment
  const responseIds = [...new Set(
    (inc.patient_assessments || []).map(a => a.response_id).filter(Boolean)
  )];

  let resourceMap = {};
  if (responseIds.length > 0) {
    const { data: responses } = await db
      .from('incident_responses')
      .select('id, resources!incident_responses_resource_id_fkey(resource)')
      .in('id', responseIds);
    (responses || []).forEach(r => {
      resourceMap[r.id] = r.resources?.resource ?? '—';
    });
  }

  const assessments = (inc.patient_assessments || [])
    .map(a => ({ ...a, resourceName: resourceMap[a.response_id] ?? '—' }))
    .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at));

  return { inc, assessments };
}


/* ================================================================
   HOSPITAL PAGE
================================================================ */

async function fetchHospitalResponses(eventId) {
  const { data, error } = await db
    .from('incident_responses')
    .select(`
      id, outcome, assigned_at, released_at,
      dest_hospital, hospital_info, gipse, notes,
      incident_id,
      incidents(
        id, patient_name, patient_identifier, patient_age,
        patient_gender, current_triage
      ),
      resources!incident_responses_resource_id_fkey(id, resource, resource_type)
    `)
    .eq('event_id', eventId)
    .in('outcome', ['taken_to_hospital', 'en_route_to_hospital'])
    .order('assigned_at', { ascending: false });

  if (error) { console.error('fetchHospitalResponses:', error); return []; }
  return data || [];
}

/* Returns a map: incident_id → latest assessment object */
async function fetchHospitalAssessments(incidentIds) {
  if (!incidentIds || incidentIds.length === 0) return {};

  const { data, error } = await db
    .from('patient_assessments')
    .select(`
      incident_id, assessed_at, triage,
      heart_rate, spo2, breathing_rate, blood_pressure,
      temperature, gcs_total, hgt, iv_access
    `)
    .in('incident_id', incidentIds)
    .order('assessed_at', { ascending: false });

  if (error) { console.error('fetchHospitalAssessments:', error); return {}; }

  // Keep only latest per incident
  const map = {};
  (data || []).forEach(a => {
    if (!map[a.incident_id]) map[a.incident_id] = a;
  });
  return map;
}
 
/* ================================================================
   DISPOSITIVO PAGE
================================================================ */
 
/* ── Full resource list for dispositivo page ───────────────────
   Includes all fields needed for table display and the edit modal:
   geom, targa, schedule, email, coordinator.
---------------------------------------------------------------- */
async function fetchDispositivoResources(eventId) {
  const { data, error } = await db
    .from('resources')
    .select(`
      id, resource, resource_type, geom, notes,
      user_email, targa, start_time, end_time,
      coordinator:coordinator_id(resource)
    `)
    .eq('event_id', eventId)
    .order('resource');
 
  if (error) { console.error('fetchDispositivoResources:', error); return []; }
  return data || [];
}
 
/* ── Full personnel list for dispositivo page ──────────────────
   All personnel for the event, ordered by surname.
---------------------------------------------------------------- */
async function fetchDispositivoPersonnel(eventId) {
  const { data, error } = await db
    .from('personnel')
    .select(`
      id, name, surname, comitato, number,
      qualifications, role, resource_fk:resource, present
    `)
    .eq('event_id', eventId)
    .order('surname');
 
  if (error) { console.error('fetchDispositivoPersonnel:', error); return []; }
  return data || [];
}
 
/* ── Lightweight resource list for person modal dropdown ───────
   Only id, resource name and type — no joins needed.
---------------------------------------------------------------- */
async function fetchDispResourceDropdown(eventId) {
  const { data, error } = await db
    .from('resources')
    .select('id, resource, resource_type')
    .eq('event_id', eventId)
    .order('resource');
 
  if (error) { console.error('fetchDispResourceDropdown:', error); return []; }
  return data || [];
}
 
/* ── Single personnel fetch for edit modal ─────────────────────*/
async function fetchPersonnelById(personnelId) {
  const { data, error } = await db
    .from('personnel')
    .select('*')
    .eq('id', personnelId)
    .single();
 
  if (error) { console.error('fetchPersonnelById:', error); return null; }
  return data;
}
 
/* ── Personnel upsert ──────────────────────────────────────────
   If personnelId is provided → update, otherwise → insert.
   Returns { ok, message? }
---------------------------------------------------------------- */
async function upsertPersonnel(personnelId, payload, eventId) {
  let error;
  if (personnelId) {
    ({ error } = await db
      .from('personnel')
      .update(payload)
      .eq('id', personnelId));
  } else {
    ({ error } = await db
      .from('personnel')
      .insert({ ...payload, event_id: eventId }));
  }
 
  if (error) { console.error('upsertPersonnel:', error); return { ok: false, message: error.message }; }
  return { ok: true };
}
 
/* ── Personnel delete ──────────────────────────────────────────*/
async function removePersonnel(personnelId) {
  const { error } = await db
    .from('personnel')
    .delete()
    .eq('id', personnelId);
 
  if (error) { console.error('removePersonnel:', error); return false; }
  return true;
}
 
/* ── Resource detail update ────────────────────────────────────
   Used by saveResource in the resource edit modal.
   Accepts any subset of resource columns as payload.
---------------------------------------------------------------- */
async function updateResourceDetails(resourceId, payload) {
  const { error } = await db
    .from('resources')
    .update(payload)
    .eq('id', resourceId);
 
  if (error) { console.error('updateResourceDetails:', error); return false; }
  return true;
}

/* ================================================================
   SETTINGS PAGE
================================================================ */
 
/* ── Event settings fetch ──────────────────────────────────────
   Fetches the event fields needed by the settings page.
---------------------------------------------------------------- */
async function fetchEventSettings(eventId) {
  const { data, error } = await db
    .from('events')
    .select('id, name, is_route, is_grid, notes_general, notes_coordinators')
    .eq('id', eventId)
    .single();
 
  if (error) { console.error('fetchEventSettings:', error); return null; }
  return data;
}
 
/* ── Generic event field update ────────────────────────────────
   Used by saveEventToggle (single boolean) and saveNotes (single
   text field). Pass any subset of event columns as `fields`.
---------------------------------------------------------------- */
async function updateEventFields(eventId, fields) {
  const { error } = await db
    .from('events')
    .update(fields)
    .eq('id', eventId);
 
  if (error) { console.error('updateEventFields:', error); return false; }
  return true;
}
 
/* ── Geo layer write ───────────────────────────────────────────
   deleteGeoLayer  — removes all rows for this event from the table.
   insertGeoRows   — bulk inserts pre-built row objects.
   Both are called together by uploadGeoJSON in replace mode.
---------------------------------------------------------------- */
async function deleteGeoLayer(eventId, table) {
  const { error } = await db
    .from(table)
    .delete()
    .eq('event_id', eventId);
 
  if (error) { console.error(`deleteGeoLayer(${table}):`, error); return false; }
  return true;
}
 
async function insertGeoRows(table, rows) {
  const { error } = await db
    .from(table)
    .insert(rows);
 
  if (error) { console.error(`insertGeoRows(${table}):`, error); return false; }
  return true;
}


/* ================================================================
   GEO LAYERS
================================================================ */

/* ── Single geo table fetch ────────────────────────────────────
   Called once per layer during loadGeoLayers().
   Returns raw rows or [] on error.
---------------------------------------------------------------- */
async function fetchGeoLayer(eventId, table) {
  const { data, error } = await db
    .from(table)
    .select('*')
    .eq('event_id', eventId);

  if (error) { console.error(`fetchGeoLayer(${table}):`, error); return []; }
  return data || [];
}


/* ================================================================
   MUTATIONS
================================================================ */

/* ── Response outcome ──────────────────────────────────────────
   Updates a single incident_response row.
   Automatically sets released_at for terminal outcomes.
---------------------------------------------------------------- */
const ACTIVE_OUTCOMES = [
  'en_route_to_incident', 'treating',
  'en_route_to_pma', 'en_route_to_hospital', 'reporting',
];

async function updateResponseOutcome(responseId, outcome) {
  const updates = { outcome };
  if (!ACTIVE_OUTCOMES.includes(outcome)) {
    updates.released_at = new Date().toISOString();
  }

  const { error } = await db
    .from('incident_responses')
    .update(updates)
    .eq('id', responseId);

  if (error) { console.error('updateResponseOutcome:', error); return false; }
  return true;
}

/* ── Add resource to incident ──────────────────────────────────*/
async function insertIncidentResponse(payload) {
  const { error } = await db
    .from('incident_responses')
    .insert({
      event_id:    payload.eventId,
      incident_id: payload.incidentId,
      resource_id: payload.resourceId,
      outcome:     payload.outcome,
      role:        payload.role || 'backup',
      assigned_at: new Date().toISOString(),
    });

  if (error) { console.error('insertIncidentResponse:', error); return false; }
  return true;
}

/* ── Bulk-close all active responses on an incident ───────────*/
async function closeIncidentResponses(incidentId, outcome) {
  const { error } = await db
    .from('incident_responses')
    .update({ outcome, released_at: new Date().toISOString() })
    .eq('incident_id', incidentId)
    .in('outcome', ACTIVE_OUTCOMES);

  if (error) { console.error('closeIncidentResponses:', error); return false; }
  return true;
}

/* ── Resource status ───────────────────────────────────────────*/
async function setResourceStatus(resourceId, status) {
  const { error } = await db
    .from('resources_current_status')
    .update({ status })
    .eq('resource_id', resourceId);

  if (error) { console.error('setResourceStatus:', error); return false; }
  return true;
}

/* ── Coordinator assignment ────────────────────────────────────*/
async function updateResourceCoordinator(resourceId, coordinatorId) {
  const { error } = await db
    .from('resources')
    .update({ coordinator_id: coordinatorId || null })
    .eq('id', resourceId);

  if (error) { console.error('updateResourceCoordinator:', error); return false; }
  return true;
}

/* ── Spatial queries ───────────────────────────────────────────*/
async function fetchZoneForPoint(eventId, lat, lng) {
  const { data } = await db.rpc('get_zone_for_point', {
    p_event_id: eventId,
    p_lng:      lng,
    p_lat:      lat,
  });
  return (data && data.length > 0) ? data[0] : null;
}

async function fetchNearestRouteMarker(eventId, lat, lng) {
  const { data } = await db.rpc('get_nearest_route_marker', {
    p_event_id: eventId,
    p_lng:      lng,
    p_lat:      lat,
  });
  return (data && data.length > 0) ? data[0] : null;
}

/* ── Create incident (RPC) ─────────────────────────────────────
   Wraps the create_incident_with_assessment RPC.
   Returns { ok: true } or { ok: false, message }
---------------------------------------------------------------- */
async function createPCAIncident(params) {
  const { error } = await db.rpc('create_incident_with_assessment', params);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}