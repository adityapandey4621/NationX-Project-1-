-- ============================================================================
-- 003_identity_auth.sql — Identity hooks for Supabase Auth
--
-- 1. Auto-create a profile + default 'customer' role when an auth user signs up.
-- 2. Safe, one-time administrator bootstrap (service role only).
--
-- SECURITY NOTE: raw_user_meta_data is writable by the end user (it is sent by
-- the client on sign-up and via auth.updateUser). It is therefore used ONLY for
-- display data (name, phone, language). Roles are NEVER derived from it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name  TEXT := NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'full_name'), '');
    v_phone TEXT := NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'phone'), '');
    v_lang  TEXT := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'preferred_language', ''), 'en');
BEGIN
    IF v_name IS NULL OR v_phone IS NULL THEN
        RAISE EXCEPTION 'full_name and phone are required to create a profile'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_lang NOT IN ('en', 'te') THEN
        v_lang := 'en';
    END IF;

    INSERT INTO public.profiles (id, full_name, phone, email, preferred_language)
    VALUES (NEW.id, v_name, v_phone, NEW.email, v_lang);

    -- Every account starts as a customer. Merchant is granted on application
    -- approval; admin only through bootstrap_first_admin() or by another admin.
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer');

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Keep profiles.email in step with auth.users.email (confirmed changes only).
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_auth_user_email_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_email_changed
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.handle_auth_user_email_change();

-- Administrator bootstrap ------------------------------------------------------
-- Grants 'admin' to an EXISTING account, and only while no admin exists.
-- Callable exclusively with the service-role key (never from a browser).
-- Run via `npm run bootstrap:admin -- <email>`; see docs/SETUP.md.
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
        RAISE EXCEPTION 'an administrator already exists; use the admin tools to grant roles'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT id INTO v_user_id FROM public.profiles WHERE LOWER(email) = LOWER(BTRIM(p_email));
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'no registered account with that email; sign up first'
            USING ERRCODE = 'no_data_found';
    END IF;

    INSERT INTO public.user_roles (user_id, role) VALUES (v_user_id, 'admin');

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, new_state, reason)
    VALUES (v_user_id, 'role.bootstrap_admin', 'profile', v_user_id,
            jsonb_build_object('role', 'admin'), 'first administrator bootstrap');

    RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_first_admin(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(TEXT) TO service_role;
