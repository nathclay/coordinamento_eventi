-- Events table: each row represent one event 
CREATE TABLE events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  area geometry(POLYGON, 4326),
  center_lat NUMERIC,
  center_lng NUMERIC,
  default_zoom INTEGER DEFAULT 14,
  is_active BOOL DEFAULT FALSE NOT NULL,
 -- created_by UUID REFERENCES auth.users, TODO: when users will be enabled
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE TABLE personnel (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid REFERENCES events(id) NOT NULL,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  cf TEXT, -- codice fiscale,
  comitato TEXT, -- comitato di appartenenza
  number bigint, -- phone number
  email TEXT,
  qualifications TEXT,
  role TEXT, -- e.g. coordinator, medic, volunteer, etc
  ICE TEXT, -- in case of emergency, contact info
  allergies TEXT,
  activation_protocols TEXT,
  resource uuid REFERENCES resources(id), -- if this person is assigned to a specific resource, otherwise null
  checkin_time TIMESTAMPTZ, -- when they checked in for the event
  checkout_time TIMESTAMPTZ, -- when they checked out for the event
  present BOOL DEFAULT null, --
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
ALTER TABLE personnel ENABLE ROW LEVEL SECURITY;

--Radio channels table: all of the radio channels used for each event
CREATE TABLE event_radio_channels(
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES events(id) NOT NULL,
    channel_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
ALTER TABLE event_radio_channels ENABLE ROW LEVEL SECURITY;


--Resources table: represent all of the deployable resources: ambulances, foot medical teams, first-aid posts, coordinators. Doesnt include non health-related resources (logistics, telecomunications etc)
-- Each asset belongs to one event. Contains only static information (current location, location history, current status and status history are stored in other tables)
CREATE TABLE resources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid REFERENCES events(id) NOT NULL,
  resource TEXT NOT NULL,
  resource_type type_enum NOT NULL,
  targa TEXT,
  geom GEOMETRY(POINT, 4326), --initial position of resource, as per the health plan
  start_time TIMESTAMPTZ, --from timetable
  end_time TIMESTAMPTZ,
  coordinator_id uuid REFERENCES resources(id) ON DELETE SET NULL, --coordinator assigned to that resource. Can vary during the event. 
  radio_channel_id UUID REFERENCES event_radio_channels(id) ON DELETE SET NULL, 
  crew_count INTEGER DEFAULT 0, -- automatically updated based on the number of personnel assigned to this resource in the personnel table
  user_email TEXT, --email of the user currently assigned to that resource. Used for autentication and authorization.
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  notes TEXT
);
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;


--location_history table: Time-series GPS position history for all assets. Every position update is appended here, 
--and a trigger also updates the resources_current_status table. This table enables route replay and historical analysis.
CREATE TABLE location_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid REFERENCES events(id) NOT NULL,
  resource_id uuid REFERENCES resources(id) NOT NULL,
  geom GEOMETRY(POINT, 4326), -- location of the resource at the time of recording
  accuracy_m NUMERIC(6,2), --accuracy in meters
  speed_kmh NUMERIC(5,1), -- speed in km/h
  heading_deg NUMERIC(5,1), --direction of movement in degrees, where 0 is north, 90 is east, etc.
  recorded_by uuid REFERENCES personnel(id),
  recorded_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
ALTER TABLE location_history ENABLE ROW LEVEL SECURITY;

-- Table resources_current_status: one row per resource, updated in real time by triggers on location_history and incident_responses. Used for the map view and for quick access to the current status of each resource without having to query the full history tables.
CREATE TABLE resources_current_status (
  event_id uuid REFERENCES events(id) NOT NULL,
  resource_id UUID REFERENCES resources(id) PRIMARY KEY,
  geom GEOMETRY(POINT, 4326),
  accuracy_m NUMERIC(6,2),
  speed_kmh NUMERIC(5,1), 
  heading_deg NUMERIC(5,1),
  location_updated_at TIMESTAMPTZ,-- when the location was last recorded
  status resource_status_enum,   -- free | busy | stopped
  active_responses INTEGER NOT NULL DEFAULT 0,  -- count of outcome = 'treating'
  last_response_at TIMESTAMPTZ, -- when their last incident_response was created
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE resources_current_status ENABLE ROW LEVEL SECURITY;



-- TABLE: incidents- one row per patient/case. Never updated except for the two shortcut columns
-- (current_triage, status) which are maintained automatically by triggers.
CREATE TABLE incidents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES events(id) NOT NULL,
  patient_name TEXT,
  patient_identifier TEXT, --For sporting events, pettorale
  patient_age INTEGER,
  patient_gender TEXT,
  geom GEOMETRY(POINT, 4326), -- location of the incident (not necessarily the same as the location of the assigned unit)
  incident_type incident_type_enum NOT NULL,
  description TEXT,
  reported_by_resource_id UUID REFERENCES resources(id),
  current_triage triage_enum,-- latest triage from patient_assessments
  status incident_status_enum NOT NULL DEFAULT 'open',
  initial_outcome response_outcome_enum,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_incidents_event_id ON incidents(event_id);
CREATE INDEX idx_incidents_status   ON incidents(status);
CREATE INDEX idx_incidents_geom ON incidents USING GIST (geom);




-- TABLE: incident_responses. One row per resource per involvement. New row = new resource assigned.
-- Chained via handoff_to_response_id for transfer history.
CREATE TABLE incident_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES events(id) NOT NULL,
  incident_id UUID NOT NULL REFERENCES incidents(id),
  resource_id UUID NOT NULL REFERENCES resources(id),
  personnel_id UUID REFERENCES personnel(id),
  geom GEOMETRY(POINT, 4326), -- location of the resource at the time of assignment.
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrived_at TIMESTAMPTZ,-- when unit reached scene (used for response time calculation)
  released_at TIMESTAMPTZ, -- when unit finished involvement
  role TEXT NOT NULL DEFAULT 'first_responder',-- e.g. first_responder, backup, transport, receiving
  outcome response_outcome_enum NOT NULL DEFAULT 'treating',
  dest_pma_id uuid REFERENCES resources(id), --To only use when a unit is in route for a PMA, when the handoff happens we use handoff column
  handoff_to_response_id UUID REFERENCES incident_responses(id),   -- Handoff chain: points to the next response row when this unit passes to another
  dest_hospital TEXT, -- To only use when a unit is in route for a hospital, when the patient is left we use hospital_info 
  hospital_info JSONB, -- Filled only when outcome = taken_to_hospital
  gipse TEXT,
  notes TEXT,
  --assigned_by UUID REFERENCES personnel(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE incident_responses ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_incident_responses_incident_id ON incident_responses(incident_id);
CREATE INDEX idx_incident_responses_resource_id    ON incident_responses(resource_id);



-- TABLE: patient_assessments, append-only vitals history. One row per assessment.
-- Linked to incident_id directly so ALL assigned units see ALL assessments.
-- This table is insert only, rows are never updated. If an assessment is modified, a new row is inserted with the updated information and a reference to the previous assessment (if needed for tracking changes).
CREATE TABLE patient_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  response_id UUID NOT NULL REFERENCES incident_responses(id),
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assessed_by UUID REFERENCES personnel(id),
  conscious BOOLEAN,
  respiration BOOLEAN,
  circulation BOOLEAN,
  walking BOOLEAN,
  minor_injuries BOOLEAN,
  description TEXT,
  clinical_notes TEXT,
  heart_rate INTEGER,
  blood_pressure TEXT,   
  spo2 INTEGER,
  breathing_rate INTEGER,
  temperature NUMERIC(4,1), 
  gcs_total INTEGER, 
  hgt TEXT, 
  bed_number_pma TEXT,
  iv_access BOOLEAN,
  gipse TEXT,
  hospital_destination TEXT, -- if known at the time of assessment
  triage triage_enum,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  geom GEOMETRY(POINT, 4326) -- location of the assessment
);
ALTER TABLE patient_assessments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_patient_assessments_incident_id ON patient_assessments(incident_id);
CREATE INDEX idx_patient_assessments_assessed_at ON patient_assessments(assessed_at);







