CREATE TRIGGER trg_incident_responses_updated_at
BEFORE UPDATE ON incident_responses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_incidents_updated_at
BEFORE UPDATE ON incidents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_resources_current_status_updated_at
BEFORE UPDATE ON resources_current_status
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_resources_updated_at
BEFORE UPDATE ON resources
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_event_radio_channels_updated_at
BEFORE UPDATE ON event_radio_channels
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_personnel_updated_at
BEFORE UPDATE ON personnel
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TRIGGER trg_sync_incident_shortcuts
AFTER INSERT ON patient_assessments
FOR EACH ROW EXECUTE FUNCTION sync_incident_shortcuts();

CREATE TRIGGER trg_update_resource_location
AFTER INSERT ON location_history
FOR EACH ROW EXECUTE FUNCTION update_resource_location();

CREATE TRIGGER trg_check_resource_radio_channel
BEFORE INSERT OR UPDATE ON resources
FOR EACH ROW EXECUTE FUNCTION check_resource_radio_channel_event();

CREATE TRIGGER trg_handle_response_insert
AFTER INSERT ON incident_responses
FOR EACH ROW EXECUTE FUNCTION handle_response_insert();

CREATE TRIGGER trg_handle_response_update
AFTER UPDATE OF outcome ON incident_responses
FOR EACH ROW EXECUTE FUNCTION handle_response_update();

CREATE TRIGGER trg_sync_crew_count
AFTER INSERT OR UPDATE OF resource OR DELETE ON personnel
FOR EACH ROW EXECUTE FUNCTION sync_crew_count();

CREATE TRIGGER trg_auto_create_first_response
AFTER INSERT ON incidents
FOR EACH ROW EXECUTE FUNCTION auto_create_first_response();

CREATE TRIGGER trg_sync_incident_status
AFTER INSERT OR UPDATE OF outcome ON incident_responses
FOR EACH ROW EXECUTE FUNCTION sync_incident_status();

CREATE TRIGGER trg_sync_sibling_responses
AFTER UPDATE OF outcome ON incident_responses
FOR EACH ROW EXECUTE FUNCTION sync_sibling_responses();

CREATE TRIGGER trg_anagrafica_audit
BEFORE INSERT OR UPDATE ON anagrafica
FOR EACH ROW EXECUTE FUNCTION set_audit_fields();
 
CREATE TRIGGER trg_resource_days_audit
BEFORE INSERT OR UPDATE ON resource_days
FOR EACH ROW EXECUTE FUNCTION set_audit_fields();
 
CREATE TRIGGER trg_personnel_audit
BEFORE INSERT OR UPDATE ON personnel
FOR EACH ROW EXECUTE FUNCTION set_audit_fields();