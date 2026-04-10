/* ================================================================
   js/state.js
   Single source of truth for the session.
   All modules read and write STATE — never duplicate state locally.
================================================================ */

const STATE = {
  session:   null,
  resource:  null,
  event:     null,
  personnel: null,
  incidents: [],
  isOnline:  navigator.onLine,
  activeTeamFilter: null,    // ← just a property, no STATE. prefix

  formData: {
    triage:      null,
    conscious:   null,
    respiration: null,
    circulation: null,
    walking:     null,
    minor_injuries:null,
    gender:      null,
    status:      'in_progress',
    outcomeType: null,
    lat:         null,
    lng:         null,
  },

  assessmentData: {
    conscious:   null,
    respiration: null,
    circulation: null,
    walking:     null,
    triage:      null,
  }
};