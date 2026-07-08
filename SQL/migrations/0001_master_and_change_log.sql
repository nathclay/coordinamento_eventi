-- ================================================================
-- 0001_master_and_change_log.sql
-- Phase 1: master role + event provisioning guardrails + generic
-- audit log (change_log) for the dispositivo-side tables.
--
-- Run order: after tables.sql, geom_tables.sql, enums.sql,
-- security.sql, policies.sql (i.e. against the current prod schema).
-- ================================================================


-- ================================================================
-- 1. ROLE HELPERS
-- ================================================================
-- `master` is a superset of the existing `planner` role: anywhere
-- planner has access today, master gets it too, plus event/user
-- management. Both are granted by hand via auth.users.raw_app_meta_data
-- (see migrations/README.md) — never editable from any frontend.

CREATE OR REPLACE FUNCTION is_master()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'master';
$$;

CREATE OR REPLACE FUNCTION is_planner_or_master()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'role') IN ('master', 'planner');
$$;


-- ================================================================
-- 2. WIDEN EXISTING PLANNER POLICIES TO INCLUDE MASTER
-- ================================================================
-- Superset relationship: replace the `role = 'planner'` checks from
-- SQL/security.sql with is_planner_or_master().

DROP POLICY IF EXISTS "planners_anagrafica" ON anagrafica;
CREATE POLICY "planners_anagrafica" ON anagrafica FOR ALL
  USING (is_planner_or_master()) WITH CHECK (is_planner_or_master());

DROP POLICY IF EXISTS "planners_resource_days" ON resource_days;
CREATE POLICY "planners_resource_days" ON resource_days FOR ALL
  USING (is_planner_or_master()) WITH CHECK (is_planner_or_master());

DROP POLICY IF EXISTS "planners_personnel_select" ON personnel;
CREATE POLICY "planners_personnel_select" ON personnel
  FOR SELECT USING (is_planner_or_master());

DROP POLICY IF EXISTS "planners_personnel_insert" ON personnel;
CREATE POLICY "planners_personnel_insert" ON personnel
  FOR INSERT WITH CHECK (is_planner_or_master());

DROP POLICY IF EXISTS "planners_personnel_update" ON personnel;
CREATE POLICY "planners_personnel_update" ON personnel
  FOR UPDATE USING (is_planner_or_master()) WITH CHECK (is_planner_or_master());

DROP POLICY IF EXISTS "planners_requirements" ON resource_type_requirements;
CREATE POLICY "planners_requirements" ON resource_type_requirements FOR ALL
  USING (is_planner_or_master()) WITH CHECK (is_planner_or_master());

-- NOTE: `personnel` (and `resources`, `events`, etc.) also carry the
-- pre-existing blanket "authenticated all operations" policy from
-- SQL/policies.sql. RLS policies are OR'd together (permissive by
-- default), so that wide-open grant still applies on top of these —
-- these master/planner policies only start actually restricting
-- access once policies.sql's blanket grants are tightened, which is
-- tracked separately (see the phase-1 review doc) and deliberately
-- NOT done here to avoid breaking PCA's existing direct writes to
-- `resources` (see js/views/pca-import.js) and `events` (see
-- js/pca-rpc.js) without a dedicated look at that flow first.


-- ================================================================
-- 3. EVENTS: ONLY MASTER CREATES/DELETES EVENTS
-- ================================================================
-- events currently has one blanket FOR ALL policy from policies.sql.
-- Split it: SELECT/UPDATE stay open to any authenticated user (PCA
-- already relies on updating is_active/current_session/notes on the
-- active event), INSERT/DELETE now require master. Nothing else in
-- the codebase creates or deletes events today, so this is safe to
-- narrow immediately.

DROP POLICY IF EXISTS "authenticated all operations" ON events;

CREATE POLICY "events_select_authenticated" ON events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "events_update_authenticated" ON events
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "events_insert_master" ON events
  FOR INSERT TO authenticated WITH CHECK (is_master());

CREATE POLICY "events_delete_master" ON events
  FOR DELETE TO authenticated USING (is_master());


-- ================================================================
-- 4. CHANGE LOG
-- ================================================================
-- One generic, trigger-populated audit table instead of one log
-- table per entity. Covers INSERT/UPDATE/DELETE (the existing
-- set_audit_fields() trigger only stamped created_by/updated_by on
-- INSERT/UPDATE — deletes were invisible).

CREATE TABLE change_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID,              -- denormalized, for fast per-event filtering; NULL when not applicable
  table_name        TEXT NOT NULL,
  row_id            UUID NOT NULL,
  action            TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_by        UUID REFERENCES auth.users(id),
  changed_by_email  TEXT,              -- denormalized, since auth.users isn't client-joinable
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_data          JSONB,             -- full row before (UPDATE/DELETE)
  new_data          JSONB              -- full row after (INSERT/UPDATE)
);
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_change_log_event     ON change_log (event_id, changed_at DESC);
CREATE INDEX idx_change_log_table_row ON change_log (table_name, row_id, changed_at DESC);

-- Only master can read the log. No client-facing INSERT/UPDATE/DELETE
-- policy exists at all — only the SECURITY DEFINER trigger function
-- below writes to this table, so it can't be tampered with or
-- bypassed by a caller forgetting to log something.
CREATE POLICY "master_select_change_log" ON change_log
  FOR SELECT TO authenticated USING (is_master());

CREATE OR REPLACE FUNCTION log_change()
RETURNS TRIGGER
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row_id   UUID;
  v_event_id UUID;
  v_email    TEXT;
BEGIN
  v_row_id := COALESCE(NEW.id, OLD.id);

  -- event_id is a column on personnel/resource_days/resources, absent on
  -- anagrafica/resource_type_requirements (event-independent). ->>'event_id'
  -- returns NULL safely on rows/tables without that key — no error.
  IF TG_TABLE_NAME = 'events' THEN
    v_event_id := v_row_id;
  ELSE
    v_event_id := COALESCE(
      (to_jsonb(NEW) ->> 'event_id')::UUID,
      (to_jsonb(OLD) ->> 'event_id')::UUID
    );
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO change_log (
    event_id, table_name, row_id, action,
    changed_by, changed_by_email, old_data, new_data
  )
  VALUES (
    v_event_id, TG_TABLE_NAME, v_row_id, TG_OP,
    auth.uid(), v_email,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_change_log_personnel
  AFTER INSERT OR UPDATE OR DELETE ON personnel
  FOR EACH ROW EXECUTE FUNCTION log_change();

CREATE TRIGGER trg_change_log_resource_days
  AFTER INSERT OR UPDATE OR DELETE ON resource_days
  FOR EACH ROW EXECUTE FUNCTION log_change();

CREATE TRIGGER trg_change_log_resources
  AFTER INSERT OR UPDATE OR DELETE ON resources
  FOR EACH ROW EXECUTE FUNCTION log_change();

CREATE TRIGGER trg_change_log_anagrafica
  AFTER INSERT OR UPDATE OR DELETE ON anagrafica
  FOR EACH ROW EXECUTE FUNCTION log_change();

CREATE TRIGGER trg_change_log_resource_type_requirements
  AFTER INSERT OR UPDATE OR DELETE ON resource_type_requirements
  FOR EACH ROW EXECUTE FUNCTION log_change();

CREATE TRIGGER trg_change_log_events
  AFTER INSERT OR UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION log_change();


-- ================================================================
-- 5. RPC: list current master/planner role holders (read-only)
-- ================================================================
-- The client can't query auth.users directly. This RPC exposes just
-- email + role, and only to callers who are already master — anyone
-- else gets an empty result set (not an error).

CREATE OR REPLACE FUNCTION list_privileged_users()
RETURNS TABLE (email TEXT, role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.email, au.raw_app_meta_data ->> 'role' AS role
  FROM auth.users au
  WHERE (au.raw_app_meta_data ->> 'role') IN ('master', 'planner')
    AND is_master()
  ORDER BY role, au.email;
$$;

GRANT EXECUTE ON FUNCTION list_privileged_users TO authenticated;
