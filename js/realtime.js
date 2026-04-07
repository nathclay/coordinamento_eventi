/* ================================================================
   js/realtime.js
   Single subscription manager — one channel per table.
   Views register callbacks here instead of subscribing directly.
   Prevents duplicate WebSocket connections.
   Depends on: supabase.js, state.js
================================================================ */

const listeners = {
  incidents:         [],
  resources_status:  [],
};

let subscribed = false;

function onIncidentChange(callback) {
  listeners.incidents.push(callback);
}

function onResourceStatusChange(callback) {
  listeners.resources_status.push(callback);
}

function subscribeRealtime() {
  if (subscribed || !STATE.resource) return;
  subscribed = true;

  // Incidents channel — filtered to this event
  supabase
    .channel('mobile-incidents')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'incidents',
      filter: `event_id=eq.${STATE.resource.event_id}`,
    }, payload => {
      listeners.incidents.forEach(cb => cb(payload));
    })
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'incident_responses',
    }, payload => {
      listeners.incidents.forEach(cb => cb(payload));
    })
    .subscribe();

  // Resource status channel — filtered to this resource only
  db
    .channel('mobile-resource-status')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'resources_current_status',
      filter: `resource_id=eq.${STATE.resource.id}`,
    }, payload => {
      listeners.resources_status.forEach(cb => cb(payload.new));
    })
    .subscribe();
}

function unsubscribeRealtime() {
  db.removeAllChannels();
  subscribed = false;
  listeners.incidents        = [];
  listeners.resources_status = [];
}