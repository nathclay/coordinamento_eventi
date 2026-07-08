/* ================================================================
   js/rpc-master.js
   All Supabase calls for the Master admin console.
   No UI logic — pure data layer.
================================================================ */

/* ── Auth ──────────────────────────────────────────────────────*/
async function getMasterSession() {
  const { data: { session } } = await db.auth.getSession();
  return session;
}

async function signInMasterWithGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo: window.location.href },
  });
  if (error) throw error;
}

async function signOutMaster() { await db.auth.signOut(); }

/* ── Events ────────────────────────────────────────────────────*/
async function fetchAllEvents() {
  const { data, error } = await db
    .from('events')
    .select('*')
    .order('start_time', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createEvent(payload) {
  const { data, error } = await db.from('events').insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function updateEvent(id, payload) {
  const { data, error } = await db.from('events').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/* ── Resources ─────────────────────────────────────────────────*/
async function fetchResourcesForEvent(eventId) {
  const { data, error } = await db
    .from('resources')
    .select('id, resource, resource_type, user_email, notes, crew_count')
    .eq('event_id', eventId)
    .order('resource_type')
    .order('resource');
  if (error) throw error;
  return data || [];
}

async function bulkCreateResources(eventId, resourceType, names) {
  const rows = names.map(name => ({ event_id: eventId, resource: name, resource_type: resourceType }));
  const { data, error } = await db.from('resources').insert(rows).select();
  if (error) throw error;
  return data || [];
}

async function renameResource(resourceId, newName) {
  const { error } = await db.from('resources').update({ resource: newName }).eq('id', resourceId);
  if (error) throw error;
}

async function updateResourceUserEmail(resourceId, email) {
  const { error } = await db.from('resources').update({ user_email: email || null }).eq('id', resourceId);
  if (error) throw error;
}

async function deleteResource(resourceId) {
  const { error } = await db.from('resources').delete().eq('id', resourceId);
  if (error) throw error;
}

/* ── Admins (read-only) ───────────────────────────────────────*/
async function fetchPrivilegedUsers() {
  const { data, error } = await db.rpc('list_privileged_users');
  if (error) throw error;
  return data || [];
}

/* ── Change log ────────────────────────────────────────────────*/
async function fetchChangeLog({ eventId = null, tableName = null, limit = 200 } = {}) {
  let query = db
    .from('change_log')
    .select('id, event_id, table_name, row_id, action, changed_by_email, changed_at, old_data, new_data')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (eventId)   query = query.eq('event_id', eventId);
  if (tableName) query = query.eq('table_name', tableName);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
