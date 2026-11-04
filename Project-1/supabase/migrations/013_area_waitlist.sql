-- ============================================================================
-- 013_area_waitlist.sql - "tell me when shops open near me" (demand capture)
--
-- A person gives a mobile number, an area (and optionally a category) and explicit consent to be
-- contacted when shops open there. NationX has no notification infrastructure yet (contract C8), so
-- nothing is sent automatically: staff see the list and contact people by hand. The same list gives
-- merchant acquisition a real demand signal ("N people are waiting in <area>").
--
-- Privacy: consent is mandatory and timestamped; a person can remove themselves (the row, including
-- the phone number, is deleted); only staff can read rows; the public sees counts per area only.
-- ============================================================================

CREATE TABLE public.area_waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    locality_id UUID NOT NULL REFERENCES public.localities(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    contact_phone TEXT NOT NULL CHECK (contact_phone ~ '^\+91[6-9][0-9]{9}$'),
    contact_name TEXT CHECK (contact_name IS NULL OR CHAR_LENGTH(BTRIM(contact_name)) BETWEEN 1 AND 120),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'contacted')),
    consent_given BOOLEAN NOT NULL CHECK (consent_given),
    consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    contacted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (locality_id, contact_phone)
);
CREATE INDEX idx_area_waitlist_locality ON public.area_waitlist (locality_id, status);

ALTER TABLE public.area_waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY area_waitlist_staff_read ON public.area_waitlist
    FOR SELECT TO authenticated USING (public.has_role('admin') OR public.has_role('operator'));
REVOKE ALL ON public.area_waitlist FROM anon, authenticated;
GRANT SELECT ON public.area_waitlist TO authenticated;

CREATE FUNCTION public.join_area_waitlist(
    p_locality_id UUID, p_category_id UUID, p_phone TEXT, p_name TEXT, p_consent BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name TEXT := NULLIF(BTRIM(COALESCE(p_name, '')), '');
BEGIN
    IF p_consent IS NOT TRUE THEN
        RAISE EXCEPTION 'consent is required' USING ERRCODE = 'check_violation';
    END IF;
    IF p_phone IS NULL OR p_phone !~ '^\+91[6-9][0-9]{9}$' THEN
        RAISE EXCEPTION 'enter a valid Indian mobile number' USING ERRCODE = 'check_violation';
    END IF;
    IF v_name IS NOT NULL AND CHAR_LENGTH(v_name) > 120 THEN
        RAISE EXCEPTION 'name is too long' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.localities WHERE id = p_locality_id AND is_active) THEN
        RAISE EXCEPTION 'unknown area' USING ERRCODE = 'check_violation';
    END IF;
    IF p_category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categories WHERE id = p_category_id AND is_active) THEN
        RAISE EXCEPTION 'unknown category' USING ERRCODE = 'check_violation';
    END IF;

    -- Lock per phone, THEN count: concurrent requests from one number serialise instead of racing past the limit.
    PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXT('waitlist:phone:' || p_phone));
    IF EXISTS (SELECT 1 FROM public.area_waitlist WHERE locality_id = p_locality_id AND contact_phone = p_phone) THEN
        RETURN 'already_waiting';
    END IF;
    IF (SELECT COUNT(*) FROM public.area_waitlist WHERE contact_phone = p_phone) >= 5 THEN
        RAISE EXCEPTION 'this number is already on the maximum number of area lists' USING ERRCODE = 'program_limit_exceeded';
    END IF;

    INSERT INTO public.area_waitlist (locality_id, category_id, contact_phone, contact_name, consent_given)
    VALUES (p_locality_id, p_category_id, p_phone, v_name, TRUE);
    RETURN 'joined';
END;
$$;

-- Withdraw consent: the row, phone number included, is deleted. Whoever knows the number can do this
-- (there is no OTP yet), which at worst removes someone from a list they can simply rejoin.
CREATE FUNCTION public.leave_area_waitlist(p_locality_id UUID, p_phone TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n INT;
BEGIN
    IF p_phone IS NULL OR p_phone !~ '^\+91[6-9][0-9]{9}$' THEN
        RAISE EXCEPTION 'enter a valid Indian mobile number' USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM public.area_waitlist WHERE locality_id = p_locality_id AND contact_phone = p_phone;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n > 0;
END;
$$;

-- Public, aggregate only: how many people are waiting per area. No phone numbers or names.
CREATE FUNCTION public.waitlist_demand()
RETURNS TABLE (locality_slug TEXT, locality_name TEXT, waiting BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT l.slug, l.name, COUNT(w.id) FILTER (WHERE w.status = 'waiting')
    FROM public.localities l
    LEFT JOIN public.area_waitlist w ON w.locality_id = l.id
    WHERE l.is_active
    GROUP BY l.id
    ORDER BY l.name;
$$;

-- Staff mark a person contacted (or put them back). Audited.
CREATE FUNCTION public.set_waitlist_status(p_id UUID, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_n INT;
BEGIN
    IF v_uid IS NULL OR NOT (public.has_role('admin') OR public.has_role('operator')) THEN
        RAISE EXCEPTION 'staff role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_status NOT IN ('waiting', 'contacted') THEN
        RAISE EXCEPTION 'unknown status' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.area_waitlist
       SET status = p_status, contacted_at = CASE WHEN p_status = 'contacted' THEN NOW() ELSE NULL END
     WHERE id = p_id AND status IS DISTINCT FROM p_status;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
        IF NOT EXISTS (SELECT 1 FROM public.area_waitlist WHERE id = p_id) THEN
            RAISE EXCEPTION 'waitlist entry not found' USING ERRCODE = 'no_data_found';
        END IF;
        RETURN FALSE;
    END IF;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, new_state)
    VALUES (v_uid, 'waitlist.' || p_status, 'area_waitlist', p_id, JSONB_BUILD_OBJECT('status', p_status));
    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_area_waitlist(UUID, UUID, TEXT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_area_waitlist(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waitlist_demand() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_waitlist_status(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_waitlist_status(UUID, TEXT) FROM anon;