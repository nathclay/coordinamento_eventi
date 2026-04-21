CREATE OR REPLACE FUNCTION create_incident_with_assessment(
  p_event_id              UUID,
  p_resource_id           UUID,
  p_personnel_id          UUID,        -- nullable: who on the team is recording
  p_reporting_resource_id UUID,        -- nullable, for when an incident is reported from PCA
  p_incident_type         incident_type_enum,
  p_lng                   FLOAT,
  p_lat                   FLOAT,
  p_location_description  TEXT,
  p_patient_name          TEXT,
  p_patient_age           INTEGER,
  p_patient_gender        TEXT,
  p_patient_identifier    TEXT,
  p_initial_outcome       response_outcome_enum,
  -- assessment fields
  p_conscious             BOOLEAN,
  p_respiration           BOOLEAN,
  p_circulation           BOOLEAN,
  p_walking               BOOLEAN,
  p_minor_injuries        BOOLEAN,
  p_heart_rate            INTEGER,
  p_spo2                  INTEGER,
  p_breathing_rate        INTEGER,
  p_blood_pressure        TEXT,
  p_temperature           NUMERIC(4,1),
  p_gcs_total              INTEGER,
  p_hgt                   TEXT,
  p_iv_access             BOOLEAN,
  p_triage                triage_enum,
  p_description           TEXT,
  p_clinical_notes        TEXT
)
RETURNS JSON AS $$
DECLARE
  v_incident_id   UUID;
  v_response_id   UUID;
  v_geom          GEOMETRY;
  v_pca_resp_id   UUID;
  v_assess_resp_id  UUID;
BEGIN
  -- Build geometry (handle null coordinates gracefully)
  IF p_lng IS NOT NULL AND p_lat IS NOT NULL THEN
    v_geom := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  ELSE
    v_geom := NULL;
  END IF;

  -- 1. Insert incident (this is done thanks to a trigger TODO: maybe change this?) 
  INSERT INTO incidents (
    event_id, incident_type, geom,
    patient_name, patient_age, patient_gender, patient_identifier,
    description, location_description, reported_by_resource_id, initial_outcome
  )
  VALUES (
    p_event_id, p_incident_type, v_geom,
    p_patient_name, p_patient_age, p_patient_gender, p_patient_identifier,
    p_description, p_location_description, p_resource_id, p_initial_outcome
  )
  RETURNING id INTO v_incident_id;

  -- 2. Get the auto-created response id (created by trigger)
  --    Also update it with personnel_id now that we have the response id
  SELECT id INTO v_response_id
  FROM incident_responses
  WHERE incident_id = v_incident_id
    AND resource_id = p_resource_id
  ORDER BY assigned_at DESC
  LIMIT 1;

  -- Set personnel on the response
  IF v_response_id IS NOT NULL AND p_personnel_id IS NOT NULL THEN
    UPDATE incident_responses
    SET personnel_id = p_personnel_id
    WHERE id = v_response_id;
  END IF;

  -- 3. Insert initial assessment
  -- Determine which response owns the assessment
  IF p_reporting_resource_id IS NOT NULL 
    AND p_reporting_resource_id IS DISTINCT FROM p_resource_id
    AND (p_initial_outcome = 'en_route_to_incident' OR p_resource_id IS NULL) THEN 
    INSERT INTO incident_responses (
      event_id, incident_id, resource_id,
      role, outcome, assigned_at
    )
    VALUES (
      p_event_id, v_incident_id, p_reporting_resource_id,
      'reporting', 'reporting', now()
    )
    RETURNING id INTO v_pca_resp_id;
    v_assess_resp_id := v_pca_resp_id;
  ELSE
    v_assess_resp_id := v_response_id;
  END IF;
  IF v_assess_resp_id IS NOT NULL THEN
    INSERT INTO patient_assessments (
      incident_id, response_id,
      assessed_by,
      conscious, respiration, circulation, walking, minor_injuries,
      heart_rate, spo2, breathing_rate, blood_pressure, temperature,
      triage, description, clinical_notes, iv_access, gcs_total, hgt,
      geom
    )
    VALUES (
      v_incident_id, v_assess_resp_id,
      p_personnel_id,
      p_conscious, p_respiration, p_circulation, p_walking, p_minor_injuries,
      p_heart_rate, p_spo2, p_breathing_rate, p_blood_pressure, p_temperature,
      p_triage, p_description, p_clinical_notes, p_iv_access, p_gcs_total, p_hgt,
      v_geom
    );
  END IF;

  RETURN json_build_object(
    'incident_id', v_incident_id,
    'response_id', v_response_id,
    'pca_response_id', v_pca_resp_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;



-- Function for the case when team A handsoff to team B a patient
CREATE OR REPLACE FUNCTION handoff_incident(
  p_from_response_id  UUID,
  p_to_resource_id    UUID,
  p_to_personnel_id   UUID,        -- nullable: who on receiving team
  p_outcome           response_outcome_enum,
  p_notes             TEXT,
  p_hospital_info     JSONB
)
RETURNS UUID AS $$
DECLARE
  v_incident_id   UUID;
  v_event_id      UUID;
  v_new_response  UUID;
BEGIN
  SELECT incident_id, event_id
  INTO v_incident_id, v_event_id
  FROM incident_responses
  WHERE id = p_from_response_id;
  -- Create receiving team's response row
  INSERT INTO incident_responses (
    event_id, incident_id, resource_id, personnel_id,
    role, outcome, assigned_at
  )
  VALUES (
    v_event_id, v_incident_id, p_to_resource_id, p_to_personnel_id,
    'receiving', 'treating', now()
  )
  RETURNING id INTO v_new_response;
  -- Close sending team's response
  UPDATE incident_responses
  SET
    outcome                = p_outcome,
    released_at            = now(),
    handoff_to_response_id = v_new_response,
    notes                  = p_notes,
    hospital_info          = p_hospital_info
  WHERE id = p_from_response_id;

  RETURN v_new_response;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ================================================================
-- SQL/spatial_functions.sql
-- PostGIS spatial query functions — Coordinamento Grandi Eventi
--
-- Run order: after tables.sql, geom_tables.sql, enums.sql
-- Requires: PostGIS extension enabled in Supabase
-- ================================================================


-- ----------------------------------------------------------------
-- INDEXES
-- Add any missing GIST indexes for spatial columns not already
-- covered in tables.sql / geom_tables.sql.
-- ----------------------------------------------------------------

-- resources_current_status — primary map layer, hit on every pan/zoom
CREATE INDEX IF NOT EXISTS idx_rcs_geom
  ON resources_current_status USING GIST (geom);

-- Also filter by event + status constantly — partial composite index
CREATE INDEX IF NOT EXISTS idx_rcs_event_status
  ON resources_current_status (event_id, status);

-- location_history — trail queries scan by resource + time window
CREATE INDEX IF NOT EXISTS idx_lochist_resource_time
  ON location_history (resource_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_lochist_geom
  ON location_history USING GIST (geom);

-- Spatial tables — geometry columns
CREATE INDEX IF NOT EXISTS idx_event_route_geom
  ON event_route USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_markers_route_geom
  ON markers_route USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_grid_geom
  ON grid USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_event_poi_geom
  ON event_poi USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_event_poi_type
  ON event_poi (event_id, poi_type);


-- ================================================================
-- 1. get_nearest_free_resources
-- ================================================================
-- Given a coordinate and event, returns the N closest resources
-- ordered by straight-line distance (metres, WGS84 geodesic).
-- Optionally filter by resource type.
--
-- Called from PCA when a new incident is created — suggests which
-- unit to dispatch without the operator having to scan the map.
--
-- Returns: resource info + distance_m from the given point.
--          Includes ALL resources (any status) when p_free_only = false.
-- ================================================================

CREATE OR REPLACE FUNCTION get_nearest_free_resources(
  p_event_id   UUID,
  p_lng        FLOAT,
  p_lat        FLOAT,
  p_limit      INT     DEFAULT 5,
  p_type       type_enum DEFAULT NULL,   -- NULL = all types
  p_free_only  BOOLEAN   DEFAULT TRUE    -- FALSE = include busy units too
)
RETURNS TABLE (
  resource_id   UUID,
  resource_name TEXT,
  resource_type type_enum,
  status        resource_status_enum,
  active_responses INT,
  distance_m    FLOAT,
  lat           FLOAT,
  lng           FLOAT,
  heading_deg   NUMERIC,
  location_updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id                              AS resource_id,
    r.resource                        AS resource_name,
    r.resource_type                   AS resource_type,
    rcs.status                        AS status,
    rcs.active_responses              AS active_responses,
    ST_Distance(
      rcs.geom::geography,
      ST_MakePoint(p_lng, p_lat)::geography
    )                                 AS distance_m,
    ST_Y(rcs.geom)                    AS lat,
    ST_X(rcs.geom)                    AS lng,
    rcs.heading_deg                   AS heading_deg,
    rcs.location_updated_at           AS location_updated_at
  FROM resources r
  JOIN resources_current_status rcs
    ON rcs.resource_id = r.id
  WHERE
    r.event_id  = p_event_id
    AND rcs.geom IS NOT NULL
    AND (p_free_only = FALSE OR rcs.status = 'free')
    AND (p_type IS NULL       OR r.resource_type = p_type)
    -- Exclude non-deployable types (command posts, fixed PMA)
    AND r.resource_type NOT IN ('PCA', 'LDC')
  ORDER BY distance_m ASC
  LIMIT p_limit;
$$;


-- ================================================================
-- 2. get_incident_route_position
-- ================================================================
-- Snaps an incident's geometry to the nearest point on the event
-- route and returns:
--   • km_on_route  — distance along the route to the snap point
--   • distance_from_route_m — how far the incident is from the route
--   • nearest_marker_label / nearest_marker_km — the closest named
--     km marker (e.g. "KM 5", "Ristoro Acqua")
--
-- Used for display ("Incident at ~KM 12.3, near Km 12 marker") and
-- for sector filtering by coordinators.
--
-- NOTE: ST_LineLocatePoint returns a fraction 0..1 of the full line.
--       For a MultiLineString the fraction is over the total merged
--       length, so results are consistent as long as the route is
--       a single connected MultiLineString per event.
-- ================================================================

CREATE OR REPLACE FUNCTION get_incident_route_position(
  p_incident_id UUID
)
RETURNS TABLE (
  incident_id           UUID,
  km_on_route           FLOAT,
  distance_from_route_m FLOAT,
  nearest_marker_label  TEXT,
  nearest_marker_km     FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    -- Fetch the incident geometry + event
    inc AS (
      SELECT id, event_id, geom
      FROM incidents
      WHERE id = p_incident_id
        AND geom IS NOT NULL
    ),
    -- Fetch the event route (take the first row if multiple exist)
    route AS (
      SELECT er.event_id, er.geom, er.total_distance_km
      FROM event_route er
      JOIN inc ON inc.event_id = er.event_id
      ORDER BY er.id
      LIMIT 1
    ),
    -- Compute position along the route as a fraction, then convert to km
    route_pos AS (
      SELECT
        inc.id AS incident_id,
        -- fraction × total km = km along route
        ST_LineLocatePoint(route.geom, inc.geom)
          * route.total_distance_km                      AS km_on_route,
        -- perpendicular distance from route (metres, geodesic)
        ST_Distance(
          ST_ClosestPoint(route.geom, inc.geom)::geography,
          inc.geom::geography
        )                                                AS distance_from_route_m
      FROM inc, route
    ),
    -- Find the nearest km marker by label
    nearest_marker AS (
      SELECT DISTINCT ON (inc.id)
        inc.id                AS incident_id,
        mr.label              AS marker_label,
        mr.km                 AS marker_km
      FROM inc
      JOIN markers_route mr ON mr.event_id = inc.event_id
      ORDER BY inc.id,
        ST_Distance(mr.geom::geography, inc.geom::geography) ASC
    )
  SELECT
    rp.incident_id,
    rp.km_on_route,
    rp.distance_from_route_m,
    nm.marker_label           AS nearest_marker_label,
    nm.marker_km              AS nearest_marker_km
  FROM route_pos rp
  LEFT JOIN nearest_marker nm ON nm.incident_id = rp.incident_id;
$$;


-- ================================================================
-- 3. get_resources_in_zone
-- ================================================================
-- Returns all resources whose CURRENT position falls inside a
-- specific grid cell (MultiPolygon).
--
-- Used in PCA map panel: click a zone → see which units are inside.
-- ================================================================

CREATE OR REPLACE FUNCTION get_resources_in_zone(
  p_event_id UUID,
  p_grid_id  UUID
)
RETURNS TABLE (
  resource_id   UUID,
  resource_name TEXT,
  resource_type type_enum,
  status        resource_status_enum,
  active_responses INT,
  lat           FLOAT,
  lng           FLOAT,
  location_updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH zone AS (
    SELECT geom FROM grid WHERE id = p_grid_id LIMIT 1
  )
  SELECT
    r.id                     AS resource_id,
    r.resource               AS resource_name,
    r.resource_type          AS resource_type,
    rcs.status               AS status,
    rcs.active_responses     AS active_responses,
    ST_Y(rcs.geom)           AS lat,
    ST_X(rcs.geom)           AS lng,
    rcs.location_updated_at  AS location_updated_at
  FROM resources r
  JOIN resources_current_status rcs ON rcs.resource_id = r.id
  CROSS JOIN zone
  WHERE
    r.event_id  = p_event_id
    AND rcs.geom IS NOT NULL
    AND ST_Within(rcs.geom, zone.geom)
  ORDER BY r.resource;
$$;


-- ================================================================
-- 4. get_zone_summary
-- ================================================================
-- Returns one row per grid cell for the event with:
--   • counts of free / busy resources currently inside the cell
--   • count of open/in-progress incidents inside the cell
--   • cell area in km²
--
-- This is the data feed for a coverage heatmap overlay on the PCA
-- map. A low free_resources + high open_incidents = danger zone.
-- ================================================================

CREATE OR REPLACE FUNCTION get_zone_summary(
  p_event_id UUID
)
RETURNS TABLE (
  grid_id          UUID,
  grid_label       TEXT,
  free_resources   BIGINT,
  busy_resources   BIGINT,
  open_incidents   BIGINT,
  area_km2         FLOAT,
  centroid_lat     FLOAT,
  centroid_lng     FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    -- All grid cells for this event
    cells AS (
      SELECT id, label, geom,
        ST_Area(geom::geography) / 1e6   AS area_km2,
        ST_Y(ST_Centroid(geom))          AS centroid_lat,
        ST_X(ST_Centroid(geom))          AS centroid_lng
      FROM grid
      WHERE event_id = p_event_id
    ),
    -- Free resources per cell
    free_res AS (
      SELECT g.id AS grid_id, COUNT(*) AS cnt
      FROM cells g
      JOIN resources_current_status rcs
        ON rcs.geom IS NOT NULL
       AND ST_Within(rcs.geom, g.geom)
      JOIN resources r ON r.id = rcs.resource_id
      WHERE r.event_id = p_event_id
        AND rcs.status = 'free'
      GROUP BY g.id
    ),
    -- Busy resources per cell
    busy_res AS (
      SELECT g.id AS grid_id, COUNT(*) AS cnt
      FROM cells g
      JOIN resources_current_status rcs
        ON rcs.geom IS NOT NULL
       AND ST_Within(rcs.geom, g.geom)
      JOIN resources r ON r.id = rcs.resource_id
      WHERE r.event_id = p_event_id
        AND rcs.status = 'busy'
      GROUP BY g.id
    ),
    -- Open / in-progress incidents per cell
    open_inc AS (
      SELECT g.id AS grid_id, COUNT(*) AS cnt
      FROM cells g
      JOIN incidents i
        ON i.geom IS NOT NULL
       AND i.event_id = p_event_id
       AND ST_Within(i.geom, g.geom)
      WHERE i.status IN ('open', 'in_progress', 'in_progress_in_pma')
      GROUP BY g.id
    )
  SELECT
    c.id,
    c.label,
    COALESCE(fr.cnt, 0)  AS free_resources,
    COALESCE(br.cnt, 0)  AS busy_resources,
    COALESCE(oi.cnt, 0)  AS open_incidents,
    c.area_km2,
    c.centroid_lat,
    c.centroid_lng
  FROM cells c
  LEFT JOIN free_res fr ON fr.grid_id = c.id
  LEFT JOIN busy_res br ON br.grid_id = c.id
  LEFT JOIN open_inc oi ON oi.grid_id = c.id
  ORDER BY c.label;
$$;


-- ================================================================
-- 5. get_route_incidents_by_km
-- ================================================================
-- Returns all incidents (of any status unless filtered) whose
-- position on the event route falls within [p_km_from, p_km_to].
--
-- Used by coordinators to see everything happening in their sector
-- (e.g. "sector B: km 10–20") without caring about grid polygons.
--
-- Incidents with no geometry or no route match are excluded.
-- ================================================================

CREATE OR REPLACE FUNCTION get_route_incidents_by_km(
  p_event_id UUID,
  p_km_from  FLOAT,
  p_km_to    FLOAT,
  p_status   incident_status_enum DEFAULT NULL  -- NULL = all statuses
)
RETURNS TABLE (
  incident_id     UUID,
  km_on_route     FLOAT,
  status          incident_status_enum,
  triage          triage_enum,
  incident_type   incident_type_enum,
  patient_identifier TEXT,
  lat             FLOAT,
  lng             FLOAT,
  created_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    route AS (
      SELECT geom, total_distance_km
      FROM event_route
      WHERE event_id = p_event_id
      ORDER BY id
      LIMIT 1
    ),
    positioned AS (
      SELECT
        i.id,
        i.status,
        i.current_triage,
        i.incident_type,
        i.patient_identifier,
        i.geom,
        i.created_at,
        ST_LineLocatePoint(r.geom, i.geom)
          * r.total_distance_km        AS km_on_route
      FROM incidents i
      CROSS JOIN route r
      WHERE i.event_id = p_event_id
        AND i.geom IS NOT NULL
        AND (p_status IS NULL OR i.status = p_status)
    )
  SELECT
    id                AS incident_id,
    km_on_route,
    status,
    current_triage    AS triage,
    incident_type,
    patient_identifier,
    ST_Y(geom)        AS lat,
    ST_X(geom)        AS lng,
    created_at
  FROM positioned
  WHERE km_on_route BETWEEN p_km_from AND p_km_to
  ORDER BY km_on_route ASC;
$$;


-- ================================================================
-- 6. get_nearest_poi
-- ================================================================
-- Returns the N nearest POIs to a given coordinate, optionally
-- filtered by poi_type (e.g. 'defibrillator', 'water_station').
--
-- Used in the incident detail panel to show the operator what
-- fixed resources are close by ("nearest defibrillator: 120m NE").
-- ================================================================

CREATE OR REPLACE FUNCTION get_nearest_poi(
  p_event_id UUID,
  p_lng      FLOAT,
  p_lat      FLOAT,
  p_poi_type TEXT    DEFAULT NULL,  -- NULL = all types
  p_limit    INT     DEFAULT 3
)
RETURNS TABLE (
  poi_id      UUID,
  name        TEXT,
  poi_type    TEXT,
  distance_m  FLOAT,
  bearing_deg FLOAT,   -- compass bearing from the query point to the POI
  lat         FLOAT,
  lng         FLOAT,
  properties  JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ep.id                                          AS poi_id,
    ep.name,
    ep.poi_type,
    ST_Distance(
      ep.geom::geography,
      ST_MakePoint(p_lng, p_lat)::geography
    )                                              AS distance_m,
    -- bearing: degrees clockwise from north, 0–360
    degrees(
      ST_Azimuth(
        ST_MakePoint(p_lng, p_lat)::geography,
        ep.geom::geography
      )
    )                                              AS bearing_deg,
    ST_Y(ep.geom)                                  AS lat,
    ST_X(ep.geom)                                  AS lng,
    ep.properties
  FROM event_poi ep
  WHERE
    ep.event_id = p_event_id
    AND ep.geom IS NOT NULL
    AND (p_poi_type IS NULL OR ep.poi_type = p_poi_type)
  ORDER BY distance_m ASC
  LIMIT p_limit;
$$;


-- ================================================================
-- 7. get_resource_trail
-- ================================================================
-- Returns the recent GPS track for a single resource from
-- location_history, ordered oldest-first for polyline drawing.
--
-- The frontend (PCA map, mobile map) draws this as a fading trail.
-- p_minutes controls how far back to look (default 60 min).
-- p_limit caps the number of points to avoid over-fetching.
--
-- Returns points oldest → newest so Leaflet can draw L.polyline
-- directly from the array without reversing.
-- ================================================================

CREATE OR REPLACE FUNCTION get_resource_trail(
  p_resource_id UUID,
  p_minutes     INT DEFAULT 60,
  p_limit       INT DEFAULT 120
)
RETURNS TABLE (
  recorded_at TIMESTAMPTZ,
  lat         FLOAT,
  lng         FLOAT,
  speed_kmh   NUMERIC,
  heading_deg NUMERIC,
  accuracy_m  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    recorded_at,
    ST_Y(geom)  AS lat,
    ST_X(geom)  AS lng,
    speed_kmh,
    heading_deg,
    accuracy_m
  FROM (
    SELECT
      recorded_at, geom, speed_kmh, heading_deg, accuracy_m
    FROM location_history
    WHERE
      resource_id = p_resource_id
      AND geom IS NOT NULL
      AND recorded_at >= now() - (p_minutes || ' minutes')::INTERVAL
    ORDER BY recorded_at DESC
    LIMIT p_limit
  ) sub
  ORDER BY recorded_at ASC;   -- oldest first for polyline drawing
$$;

-- ================================================================
-- 8. get_zone_for_point
-- ================================================================
-- Given a coordinate, returns the grid cell that contains it.
-- Lightweight — used by mobile units to display their current zone.
-- Returns NULL if the point falls outside all grid cells.
-- ================================================================

CREATE OR REPLACE FUNCTION get_zone_for_point(
  p_event_id UUID,
  p_lng      FLOAT,
  p_lat      FLOAT
)
RETURNS TABLE (
  grid_id    UUID,
  grid_label TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, label
  FROM grid
  WHERE event_id = p_event_id
    AND ST_Within(
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
      geom
    )
  LIMIT 1;
$$;

-- ================================================================
-- 9. get_nearest_route_marker
-- ================================================================
-- Returns the single closest km marker to a given coordinate.
-- Used by mobile map to display "Sei vicino al km X".
-- ================================================================

CREATE OR REPLACE FUNCTION get_nearest_route_marker(
  p_event_id UUID,
  p_lng      FLOAT,
  p_lat      FLOAT
)
RETURNS TABLE (
  marker_id  UUID,
  km         FLOAT,
  label      TEXT,
  distance_m FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    km,
    label,
    ST_Distance(
      geom::geography,
      ST_MakePoint(p_lng, p_lat)::geography
    ) AS distance_m
  FROM markers_route
  WHERE event_id = p_event_id
    AND geom IS NOT NULL
  ORDER BY distance_m ASC
  LIMIT 1;
$$;



-- ================================================================
-- GRANT EXECUTE to authenticated role (Supabase default)
-- ================================================================
GRANT EXECUTE ON FUNCTION get_nearest_free_resources    TO authenticated;
GRANT EXECUTE ON FUNCTION get_incident_route_position   TO authenticated;
GRANT EXECUTE ON FUNCTION get_resources_in_zone         TO authenticated;
GRANT EXECUTE ON FUNCTION get_zone_summary              TO authenticated;
GRANT EXECUTE ON FUNCTION get_route_incidents_by_km     TO authenticated;
GRANT EXECUTE ON FUNCTION get_nearest_poi               TO authenticated;
GRANT EXECUTE ON FUNCTION get_resource_trail            TO authenticated;
GRANT EXECUTE ON FUNCTION get_zone_for_point            TO authenticated;
GRANT EXECUTE ON FUNCTION get_nearest_route_marker      TO authenticated;

