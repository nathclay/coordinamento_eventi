-- Enum types for various fields in the database. These are defined as separate types to allow for easy modification and consistency across tables.

--Incident_status
CREATE TYPE incident_status_enum AS ENUM (
  'open',             -- recorded, no unit assigned yet
  'in_progress',      -- at least one field unit actively responding
  'in_progress_in_pma',  --patient treated in pma, no field unit responding
  'resolved',         -- patient treated and released on scene (all units are free)
  'taken_to_hospital',-- patient transported to hospital (all units are free)
  'cancelled'         -- false alarm / duplicate
);

--Triage category for patients involved in incidents
CREATE TYPE triage_enum AS ENUM (
  'red',      
  'yellow',   
  'green',    
  'white'     
);

--Current outcome
CREATE TYPE response_outcome_enum AS ENUM (
  'reporting', --this is only for the pca, when they are reporting the incident
  'en_route_to_incident', --unit not yet on the incident, already set to busy
  'treating',           -- currently active, no outcome yet
  'treated_and_released', -- the unit is now free
  'handed_off',         -- passed to another unit on scene, the original unit becomes free
  'en_route_to_pma',     --the unit is still busy
  'en_route_to_hospital',  --the unit is still busy
  'taken_to_pma',     --after the patient has arrived to pma, unit is free again
  'taken_to_hospital',        -- after the patient has arrived to hospital, unit is free again
  'consegnato_118',
  'refused_transport',
  'cancelled'
);

--Resource types
CREATE TYPE type_enum AS ENUM (
    'ASM',
    'ASI',
    'SAP',
    'BICI',
    'MM',
    'PMA',
    'LDC',
    'PCA',
    'ALTRO');


--Resource status
CREATE TYPE resource_status_enum AS ENUM ('free', 'busy', 'stopped');

--Incident types
CREATE TYPE incident_type_enum AS ENUM (
  'medical',
  'trauma', 
  'cardiac',
  'respiratory',
  'environmental',
  'other'
);


CREATE TYPE competenza_enum AS ENUM ('SOP', 'Sala_Roma', 'SOR');

CREATE TYPE personnel_role_enum AS ENUM (
  'autista', 'infermiere', 'medico', 'soccorritore',
  'coordinatore', 'volontario_generico', 'opem',
  'tlc', 'logista', 'sep', 'droni'
);

CREATE TYPE personnel_status_enum AS ENUM (
  'scheduled', 'activated', 'cancelled', 'no_show'
);

CREATE TYPE partenza_enum AS ENUM (
  'sala_roma', 'sul_posto'
);