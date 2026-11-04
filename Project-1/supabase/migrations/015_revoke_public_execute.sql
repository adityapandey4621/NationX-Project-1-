-- ============================================================================
-- 015_revoke_public_execute.sql
-- Migrations 011 and 013 revoked EXECUTE on three staff/admin functions from `anon`, but PostgreSQL grants
-- EXECUTE to PUBLIC by default and anon inherits it, so anon could still call them (each refuses non-staff
-- inside the function, but access should be denied at the privilege layer too). Fixed here, not by editing
-- the applied migrations.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.create_service_client(TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_service_client(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_waitlist_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_service_client(TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_service_client(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_waitlist_status(UUID, TEXT) TO authenticated;