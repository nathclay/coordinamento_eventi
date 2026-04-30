/* ================================================================
   js/rpc-dispositivo.js
   All Supabase calls for the Dispositivo planning page.
   No UI logic — pure data layer.
================================================================ */

/* ── Auth ──────────────────────────────────────────────────────*/
async function getDispositivoUser() {
  const { data: { user } } = await db.auth.getUser();
  return user;
}
async function signInWithEmail(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}
async function signInWithGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo: window.location.href },
  });
  if (error) throw error;
}
async function signOut() { await db.auth.signOut(); }

/* ── Events ────────────────────────────────────────────────────*/
async function fetchActiveEvents() {
  const { data, error } = await db
    .from('events')
    .select('id, name, start_time, end_date, current_session, is_active')
    .order('start_time', { ascending: false });
  if (error) throw error;
  return data || [];
}

/* ── Sessions ──────────────────────────────────────────────────*/
async function fetchSessionsForEvent(eventId) {
  const { data: event, error } = await db
    .from('events').select('start_time, end_date').eq('id', eventId).single();
  if (error) throw error;

  const start = new Date(event.start_time);
  start.setHours(0, 0, 0, 0);
  const end = event.end_date ? new Date(event.end_date) : new Date(start);
  end.setHours(0, 0, 0, 0);

  const sessions = [];
  const cursor = new Date(start);
  let session = 1;
  while (cursor <= end) {
    sessions.push({
      session, date: cursor.toISOString().slice(0, 10),
      label: cursor.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }),
    });
    cursor.setDate(cursor.getDate() + 1);
    session++;
  }
  return sessions;
}

/* ── Resource Days ─────────────────────────────────────────────*/
async function fetchResourceDaysForSession(eventId, session) {
  const { data, error } = await db
    .from('resource_days')
    .select(`
      id, session, date, notes, start_time, end_time,
      resources!inner(
        id, resource, resource_type, targa, notes,
        start_time, end_time, user_email,
        coordinator:coordinator_id(id, resource)
      )
    `)
    .eq('event_id', eventId)
    .eq('session', session)
    .order('resources(resource)');

  if (error) throw error;
  return (data || []).map(rd => ({
    resource_day_id: rd.id, session: rd.session, date: rd.date,
    rd_notes: rd.notes, rd_start: rd.start_time, rd_end: rd.end_time,
    ...rd.resources,
  }));
}

async function fetchPersonnelForSession(eventId, session) {
  const { data, error } = await db
    .from('personnel')
    .select(`
      id, role, status, notes,
      scheduled_start, scheduled_end,
      mandata_comunicazione, time_comunicazione, notes_comunicazione,
      competenza_attivazione,
      mandata_attivazione, activation_protocol, 
      time_activation_protocol, notes_activation_protocol,
      partenza,
      updated_at, updated_by, resource_day_id,
      anagrafica(
        id, name, surname, cf, comitato, number, email,
        qualifications, competenza_attivazione,
        ice, allergies
      ),
      resource_days!inner(session)
    `)
    .eq('event_id', eventId)
    .eq('resource_days.session', session);

  if (error) throw error;
  return data || [];
}

async function fetchRequirements() {
  const { data, error } = await db
    .from('resource_type_requirements')
    .select('id, resource_type, role, count')
    .order('resource_type');
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => {
    if (!map[r.resource_type]) map[r.resource_type] = [];
    map[r.resource_type].push({ id: r.id, role: r.role, count: r.count });
  });
  return map;
}

async function fetchAvailableResources(eventId, session) {
  const { data: existing } = await db
    .from('resource_days').select('resource_id')
    .eq('event_id', eventId).eq('session', session);
  const usedIds = (existing || []).map(r => r.resource_id);

  let query = db.from('resources')
    .select('id, resource, resource_type')
    .eq('event_id', eventId).order('resource');
  if (usedIds.length > 0)
    query = query.not('id', 'in', `(${usedIds.map(id => `"${id}"`).join(',')})`);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function fetchAllResources(eventId) {
  const { data, error } = await db
    .from('resources')
    .select('id, resource, resource_type, targa, start_time, end_time')
    .eq('event_id', eventId).order('resource_type').order('resource');
  if (error) throw error;
  return data || [];
}

async function fetchAllResourceDays(eventId) {
  const { data, error } = await db
    .from('resource_days').select('id, resource_id, session, start_time, end_time')
    .eq('event_id', eventId);
  if (error) throw error;
  return data || [];
}

async function createResourceDay(eventId, resourceId, session, date, startTime, endTime) {
  const { data, error } = await db
    .from('resource_days')
    .insert({ event_id: eventId, resource_id: resourceId, session, date,
      start_time: startTime || null, end_time: endTime || null })
    .select().single();
  if (error) throw error;
  return data;
}

async function deleteResourceDay(resourceDayId) {
  const { error } = await db.from('resource_days').delete().eq('id', resourceDayId);
  if (error) throw error;
}

async function bulkCreateResourceDays(eventId, resourceIds, sessions, startTime, endTime) {
  const rows = [];
  resourceIds.forEach(resourceId => {
    sessions.forEach(s => {
      rows.push({ event_id: eventId, resource_id: resourceId, session: s.session,
        date: s.date, start_time: startTime || null, end_time: endTime || null });
    });
  });
  if (!rows.length) return { created: 0 };
  const { data, error } = await db
    .from('resource_days')
    .upsert(rows, { onConflict: 'resource_id,session', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return { created: (data || []).length };
}

async function updateResourceDayTimes(resourceDayId, startTime, endTime) {
  const { error } = await db.from('resource_days')
    .update({ start_time: startTime, end_time: endTime }).eq('id', resourceDayId);
  if (error) throw error;
}

/* ── Personnel ─────────────────────────────────────────────────*/

async function assignPersonnel(eventId, anagraficaId, resourceDayId, fields) {
  // fields: role, competenza_override, scheduled_start, scheduled_end,
  //         mandata_comunicazione, time_comunicazione, notes_comunicazione,
  //         mandata_attivazione, activation_protocol, time_activation_protocol, notes_activation_protocol,
  //         partenza, notes, status
  const payload = {
    event_id:        eventId,
    anagrafica_id:   anagraficaId,
    resource_day_id: resourceDayId,
    status:          'scheduled',
    ...fields,  
  };
  // If mandata_attivazione is true, force activated status
  if (payload.mandata_attivazione) payload.status = 'activated';

  const { data, error } = await db
    .from('personnel').insert(payload).select(`
      id, role, status, scheduled_start, scheduled_end,
      mandata_attivazione, partenza,
      anagrafica(id, name, surname, comitato, competenza_attivazione)
    `).single();
  if (error) throw error;
  return data;
}

async function updatePersonnelFields(personnelId, fields) {
  if (fields.mandata_attivazione) fields.status = 'activated';
  const { error } = await db.from('personnel').update(fields).eq('id', personnelId);
  if (error) throw error;
}

async function bulkUpdatePersonnelStatus(personnelIds, status) {
  const { error } = await db.from('personnel').update({ status }).in('id', personnelIds);
  if (error) throw error;
}

/* ── Anagrafica ────────────────────────────────────────────────*/
async function searchAnagrafica({ surname = '', name = '', cf = '', phone = '' } = {}, limit = 30) {
  if (!surname && !name && !cf && !phone) return [];

  let query = db
    .from('anagrafica')
    .select('id, name, surname, cf, comitato, number, email, qualifications, competenza_attivazione, ice, allergies')
    .order('surname')
    .limit(limit);

  if (surname) query = query.ilike('surname', `%${surname}%`);
  if (name)    query = query.ilike('name',    `%${name}%`);
  if (cf)      query = query.ilike('cf',      `%${cf}%`);
  if (phone)   query = query.ilike('number',  `%${phone}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function fetchAnagraficaById(id) {
  const { data, error } = await db.from('anagrafica').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function upsertAnagrafica(id, payload) {
  if (id) {
    const { data, error } = await db
      .from('anagrafica').update(payload).eq('id', id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await db
      .from('anagrafica').insert(payload).select().single();
    if (error) throw error;
    return data;
  }
}

async function deleteAnagrafica(id) {
  const { error } = await db.from('anagrafica').delete().eq('id', id);
  if (error) throw error;
}

async function bulkImportAnagrafica(rows) {
  const results = { inserted: 0, errors: [] };
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { data, error } = await db
      .from('anagrafica')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'cf', ignoreDuplicates: false })
      .select();
    if (error) results.errors.push(`Batch ${Math.floor(i/BATCH)+1}: ${error.message}`);
    else results.inserted += (data || []).length;
  }
  return results;
}

/* ── Requirements ──────────────────────────────────────────────*/
async function upsertRequirement(id, resourceType, role, count) {
  if (id) {
    const { error } = await db.from('resource_type_requirements').update({ count }).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await db.from('resource_type_requirements')
      .insert({ resource_type: resourceType, role, count });
    if (error) throw error;
  }
}

async function deleteRequirement(id) {
  const { error } = await db.from('resource_type_requirements').delete().eq('id', id);
  if (error) throw error;
}

/* ── Export ────────────────────────────────────────────────────*/
async function fetchExportData(eventId, session) {
  const [resourceDays, personnel] = await Promise.all([
    fetchResourceDaysForSession(eventId, session),
    fetchPersonnelForSession(eventId, session),
  ]);
  const rows = [];
  resourceDays.forEach(rd => {
    const crew = personnel.filter(p => p.resource_day_id === rd.resource_day_id);
    if (!crew.length) {
      rows.push({ risorsa: rd.resource, tipo: rd.resource_type, ruolo: '',
        nome: '', cognome: '', cf: '', comitato: '', competenza: '', stato: 'vuoto',
        inizio: rd.rd_start || '', fine: rd.rd_end || '', note: rd.rd_notes || '' });
    } else {
      crew.forEach(p => {
        const ana = p.anagrafica || {};
        rows.push({
          risorsa: rd.resource, tipo: rd.resource_type, ruolo: p.role || '',
          nome: ana.name || '', cognome: ana.surname || '', cf: ana.cf || '',
          comitato: ana.comitato || '', competenza: ana.competenza_attivazione || '',
          stato: p.status || '',
          inizio: p.scheduled_start ? fmtExportTime(p.scheduled_start) : (rd.rd_start || ''),
          fine: p.scheduled_end ? fmtExportTime(p.scheduled_end) : (rd.rd_end || ''),
          mandata_attivazione: p.mandata_attivazione ? 'Sì' : 'No',
          partenza: p.partenza || '',
          note: p.notes || '',
        });
      });
    }
  });
  return rows;
}

function fmtExportTime(iso) {
  try { return new Date(iso).toLocaleString('it-IT'); } catch { return iso; }
}