-- ============================================================================
-- 008_hardening.sql - Defence-in-depth found by the pre-launch audit
--
-- 1. Supabase's default privileges give the `anon` and `authenticated` roles
--    ALL privileges on new tables/functions. Row-level security is the real gate,
--    but TRUNCATE is NOT subject to RLS, and `anon` never needs to write anything
--    directly (public writes go through SECURITY DEFINER functions). Remove what
--    is not needed so a single missing policy cannot become a hole.
-- 2. set_storefront_visibility() was executable by anon (it refused non-admins,
--    but there is no reason for anon to reach it).
-- 3. Help Me Find It throttling counted rows and then inserted, so a burst of
--    parallel requests could all pass the count. A row trigger now serialises on
--    the phone / user and re-checks.
-- ============================================================================

-- 1. Table privileges --------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
-- Views are read-only for clients (products_with_stock exposes storefront_products, which has its own writes).
REVOKE INSERT, UPDATE, DELETE ON public.products_with_stock FROM authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

-- 2. Function privileges -----------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_storefront_visibility(UUID, TEXT, TEXT) FROM anon;

-- 3. Race-free Help Me Find It throttle -------------------------------------
CREATE OR REPLACE FUNCTION public.hmf_enforce_throttle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Lock per phone (and per user) for the rest of this transaction, THEN count: a competing
    -- insert that committed first is visible to the count, one that has not yet will wait here.
    PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXT('hmf:phone:' || NEW.contact_phone));
    IF (SELECT COUNT(*) FROM public.help_me_find_it_requests
        WHERE contact_phone = NEW.contact_phone AND created_at > NOW() - INTERVAL '1 hour') >= 5 THEN
        RAISE EXCEPTION 'too many requests from this number; please try again later' USING ERRCODE = 'program_limit_exceeded';
    END IF;
    IF NEW.customer_user_id IS NOT NULL THEN
        PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXT('hmf:user:' || NEW.customer_user_id::TEXT));
        IF (SELECT COUNT(*) FROM public.help_me_find_it_requests
            WHERE customer_user_id = NEW.customer_user_id AND created_at > NOW() - INTERVAL '1 day') >= 10 THEN
            RAISE EXCEPTION 'daily request limit reached; please try again tomorrow' USING ERRCODE = 'program_limit_exceeded';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_hmf_enforce_throttle
    BEFORE INSERT ON public.help_me_find_it_requests
    FOR EACH ROW EXECUTE FUNCTION public.hmf_enforce_throttle();