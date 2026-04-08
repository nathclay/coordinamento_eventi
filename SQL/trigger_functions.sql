-- Trigger fo automatically update the updated_at timestamp on any table that has it, whenever a row is updated.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


--Trigger to update the triage to incidents table whenever a new patient assessment is recorded, to keep the current triage status up to date for quick access.
CREATE OR REPLACE FUNCTION sync_incident_shortcuts()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE incidents
  SET
    current_triage = COALESCE(NEW.triage, current_triage),
    updated_at = NOW()
  WHERE id = NEW.incident_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--Trigger to check that each resource is assigned to a allowed radio_channel 
CREATE OR REPLACE FUNCTION check_resource_radio_channel_event()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.radio_channel_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM event_radio_channels erc
      WHERE erc.id = NEW.radio_channel_id
        AND erc.event_id = NEW.event_id
    ) THEN
      RAISE EXCEPTION 'radio_channel_id does not belong to this asset''s event';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--Count number of crew members for each resource
CREATE OR REPLACE FUNCTION sync_crew_count()
RETURNS TRIGGER AS $$
DECLARE
  v_resource_id UUID;
BEGIN
  -- Determine which resource_id(s) need recounting. On UPDATE we may need to recount both old and new resource if it changed
  IF TG_OP = 'DELETE' THEN
    v_resource_id := OLD.resource;
  ELSE
    v_resource_id := NEW.resource;
  END IF;
  IF v_resource_id IS NOT NULL THEN  
    UPDATE resources
    SET crew_count = (
      SELECT COUNT(*) FROM personnel
      WHERE resource = v_resource_id AND present IS NOT FALSE
    )
    WHERE id = v_resource_id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.resource IS DISTINCT FROM NEW.resource   -- On UPDATE: if the resource assignment changed, also recount the OLD resource
     AND OLD.resource IS NOT NULL THEN
    UPDATE resources
    SET crew_count = (
      SELECT COUNT(*) FROM personnel
      WHERE resource = OLD.resource AND present IS NOT FALSE
    )
    WHERE id = OLD.resource;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Trigger to update the last known location of a resource in the resources_current_status table whenever a new location_history record is inserted for that resource. Also updates the status to 'busy' if they have an active response, or 'free' if they don't.
CREATE OR REPLACE FUNCTION update_resource_location()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN -- If its the first time we see this resource set the status to free, otherwise keep the existing status (location updates never change free/busy/stopped)
  INSERT INTO resources_current_status (
    event_id, resource_id, geom, accuracy_m, speed_kmh, heading_deg,location_updated_at, status, updated_at
  )
  VALUES (
    NEW.event_id, NEW.resource_id, NEW.geom, NEW.accuracy_m, NEW.speed_kmh, NEW.heading_deg, NEW.recorded_at, 'free', NOW()
  )
  ON CONFLICT (resource_id) DO UPDATE SET
    geom    = NEW.geom,
    accuracy_m          = NEW.accuracy_m,
    speed_kmh           = NEW.speed_kmh,
    heading_deg         = NEW.heading_deg,
    location_updated_at = NEW.recorded_at,
    updated_at          = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


--When a team inserts an incident it automatically creates a first response for the reporting resource (if provided) with outcome 'treating' and role 'first_responder', so that the resource is immediately marked as busy and the response shows up on the map. The location of the response is set to the location of the incident report, which is usually the location of the resource at the time of reporting, so that it appears on the map right away without waiting for a location update from the resource.
CREATE OR REPLACE FUNCTION auto_create_first_response()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reported_by_resource_id IS NOT NULL THEN
    INSERT INTO incident_responses (
      event_id,
      incident_id,
      resource_id,
      geom,
      role,
      outcome,
      assigned_at
    )
    VALUES (
      NEW.event_id,
      NEW.id,
      NEW.reported_by_resource_id,
      NEW.geom,
      'first_responder',
      COALESCE(NEW.initial_outcome, 'treating'),  -- ← initial_outcome, not outcome  defaults to treating if null
      NEW.created_at
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--Updates the status of the incident from incident_responses to table incidents
CREATE OR REPLACE FUNCTION sync_incident_status()
RETURNS TRIGGER AS $$
DECLARE
  v_treating_count    INTEGER;
  v_transported_count INTEGER;
  v_total_count       INTEGER;
  v_new_status        incident_status_enum;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE outcome = 'treating'),
    COUNT(*) FILTER (WHERE outcome = 'transported')
  INTO v_total_count, v_treating_count, v_transported_count
  FROM incident_responses
  WHERE incident_id = NEW.incident_id;
  v_new_status :=
    CASE
      WHEN v_total_count = 0        THEN 'open'::incident_status_enum
      WHEN v_treating_count > 0     THEN 'in_progress'::incident_status_enum
      WHEN v_transported_count > 0  THEN 'taken_to_hospital'::incident_status_enum
      ELSE                               'resolved'::incident_status_enum
    END;
  -- Only update if status actually changed, to avoid unnecessary writes
  UPDATE incidents
  SET status     = v_new_status,
      updated_at = NOW()
  WHERE id = NEW.incident_id
    AND status IS DISTINCT FROM v_new_status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


--When multiple teams are responding to same incident, if one sets the status to treated and realesed or transported, the incident status should be updated to resolved or taken_to_hospital respectively for all teams
CREATE OR REPLACE FUNCTION sync_sibling_responses()
RETURNS TRIGGER AS $$
BEGIN   -- Only fire when outcome actually changes
  IF OLD.outcome IS NOT DISTINCT FROM NEW.outcome THEN
    RETURN NEW;
  END IF;
  -- ── Case 1: one team marks patient as treated and released ────────────────
  -- All other active responses on this incident close with the same outcome
  IF NEW.outcome = 'treated_and_released' THEN
    UPDATE incident_responses
    SET
      outcome     = 'treated_and_released'::response_outcome_enum,
      released_at = NOW(),
      notes       = COALESCE(notes || ' | ', '') ||
                    'Auto-closed: patient treated and released by another unit.'
    WHERE incident_id = NEW.incident_id
      AND id          != NEW.id
      AND outcome     = 'treating';
  END IF;
  -- ── Case 2: one team transports the patient to hospital ───────────────────
  -- All other active responses close as handed_off TO the transporting unit
  IF NEW.outcome = 'transported' THEN
    UPDATE incident_responses
    SET
      outcome                = 'handed_off'::response_outcome_enum,
      released_at            = NOW(),
      handoff_to_response_id = NEW.id,   -- points to the transporting response
      notes                  = COALESCE(notes || ' | ', '') ||
                               'Auto-closed: patient transported to hospital by another unit.'
    WHERE incident_id = NEW.incident_id
      AND id          != NEW.id
      AND outcome     = 'treating';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;



-- Update the status of a resource in the resources_current_status table whenever a new incident_response is inserted for that resource. If they have at least one active response (outcome = 'treating') they are 'busy', otherwise they are 'free'. If they are marked as 'stopped' (control room stop) they remain stopped regardless of responses.
CREATE OR REPLACE FUNCTION handle_response_insert()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  v_active_count INTEGER;
BEGIN   -- Count how many responses this resource has with outcome = 'treating'
  SELECT COUNT(*) INTO v_active_count
  FROM incident_responses
  WHERE resource_id = NEW.resource_id
    AND outcome = 'treating';
  INSERT INTO resources_current_status (
    event_id, resource_id, status, active_responses, last_response_at,
    geom, location_updated_at, updated_at
  )
  VALUES (
    NEW.event_id,
    NEW.resource_id,
    CASE WHEN v_active_count > 0 THEN 'busy'::resource_status_enum ELSE 'free'::resource_status_enum END,
    v_active_count,
    NEW.assigned_at,
    NEW.geom,                 -- location at time of assignment
    NEW.assigned_at,
    NOW()
  )
  ON CONFLICT (resource_id) DO UPDATE SET
    active_responses = v_active_count,
    last_response_at = NEW.assigned_at, 
    geom    = CASE     -- Only update location if the response has a geom (active incident, not backdated)
                            WHEN NEW.geom IS NOT NULL THEN NEW.geom 
                            ELSE resources_current_status.geom 
                          END,
    location_updated_at = CASE 
                            WHEN NEW.geom IS NOT NULL THEN NEW.assigned_at 
                            ELSE resources_current_status.location_updated_at 
                          END,
    status = CASE     -- Only flip to busy if not stopped — control room stop is never overridden
               WHEN resources_current_status.status = 'stopped'::resource_status_enum THEN 'stopped'::resource_status_enum
               WHEN v_active_count > 0 THEN 'busy'::resource_status_enum
               ELSE 'free'::resource_status_enum
             END,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;



-- Similar to the above but for updates to the outcome of a response, which can change the active response count and thus the status of the resource.
CREATE OR REPLACE FUNCTION handle_response_update()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  v_active_count INTEGER;
BEGIN   -- Only care when outcome changes
  IF OLD.outcome IS NOT DISTINCT FROM NEW.outcome THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO v_active_count
  FROM incident_responses
  WHERE resource_id = NEW.resource_id
    AND outcome = 'treating';
  UPDATE resources_current_status SET
    active_responses = v_active_count,
    status = CASE
               WHEN status = 'stopped'::resource_status_enum THEN 'stopped'::resource_status_enum  -- never override stopped
               WHEN v_active_count > 0 THEN 'busy'::resource_status_enum
               ELSE 'free'::resource_status_enum
             END,
    updated_at = NOW()
  WHERE resource_id = NEW.resource_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

