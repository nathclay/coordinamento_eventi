-- Repeat for each planning user
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "planner"}'::jsonb
WHERE email = 'pianificazione@tuoemail.it';

SELECT email, raw_app_meta_data
FROM auth.users
WHERE raw_app_meta_data ->> 'role' = 'planner';

-- ── anagrafica ──────────────────────────────────────────────
CREATE POLICY "planners_anagrafica"
ON anagrafica FOR ALL
USING     ((auth.jwt() -> 'app_metadata' ->> 'role') = 'planner')
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'planner');

-- ── resource_days ────────────────────────────────────────────
CREATE POLICY "planners_resource_days"
ON resource_days FOR ALL
USING     ((auth.jwt() -> 'app_metadata' ->> 'role') = 'planner')
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'planner');

-- ── personnel ────────────────────────────────────────────────
CREATE POLICY "planners_personnel_select" ON personnel
  FOR SELECT USING ((auth.jwt()->'app_metadata'->>'role') = 'planner');

CREATE POLICY "planners_personnel_insert" ON personnel
  FOR INSERT WITH CHECK ((auth.jwt()->'app_metadata'->>'role') = 'planner');

CREATE POLICY "planners_personnel_update" ON personnel
  FOR UPDATE USING ((auth.jwt()->'app_metadata'->>'role') = 'planner')
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') = 'planner');

-- ── resource_type_requirements ───────────────────────────────
CREATE POLICY "planners_requirements"
ON resource_type_requirements FOR ALL
USING     ((auth.jwt() -> 'app_metadata' ->> 'role') = 'planner')
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'planner');
