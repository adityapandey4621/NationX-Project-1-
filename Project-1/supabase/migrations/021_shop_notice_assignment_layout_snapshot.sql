-- 021: the last spec gaps in Foundation (ADR-016).
--   A. Shop notice: a temporary-closure note and an announcement on the storefront (REQ-STR-03, REQ-STR-05).
--   B. Help Me Find It: an administrator can assign a request to a named operator (REQ-ADM-05).
--   C. Homepage layout: which sections show, and in what order, without a redeploy (REQ-HOM-07).
--   D. Review snapshot: what the administrator saw when corrections were requested, so the resubmission can be
--      shown as a before/after comparison (REQ-ADM-01 "visual diffs for resubmissions").

-- A. Shop notice --------------------------------------------------------------------------------
-- Owners and managers edit these like the headline: the storefront guard only blocks platform-controlled columns.
ALTER TABLE public.storefronts
    ADD COLUMN announcement TEXT CHECK (announcement IS NULL OR CHAR_LENGTH(BTRIM(announcement)) BETWEEN 1 AND 280),
    ADD COLUMN closure_note TEXT CHECK (closure_note IS NULL OR CHAR_LENGTH(BTRIM(closure_note)) BETWEEN 1 AND 200),
    ADD COLUMN closed_until DATE,
    ADD CONSTRAINT storefronts_closed_until_needs_note CHECK (closed_until IS NULL OR closure_note IS NOT NULL);

-- B. Assign a help request -----------------------------------------------------------------------
-- People who can be given a request: active administrators and operators.
CREATE FUNCTION public.list_assignable_operators()
RETURNS TABLE (user_id UUID, full_name TEXT, roles TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT (public.has_role('admin') OR public.has_role('operator')) THEN
        RAISE EXCEPTION 'staff role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
    SELECT p.id, p.full_name, ARRAY_AGG(DISTINCT ur.role ORDER BY ur.role)
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('admin', 'operator')
    WHERE p.is_active
    GROUP BY p.id, p.full_name
    ORDER BY p.full_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.list_assignable_operators() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_assignable_operators() TO authenticated;

-- Assign (or, with NULL, unassign) a request. Administrators only; the assignee must be an active operator or
-- administrator. Does not change the status, so the customer is not messaged.
CREATE FUNCTION public.assign_help_request(p_request_id UUID, p_operator_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_prev UUID;
    v_status TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT operator_id, status INTO v_prev, v_status FROM public.help_me_find_it_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'request not found' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'a cancelled request cannot be assigned' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF p_operator_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE p.id = p_operator_id AND p.is_active AND ur.role IN ('admin', 'operator')
    ) THEN
        RAISE EXCEPTION 'that person is not an active operator or administrator' USING ERRCODE = 'check_violation';
    END IF;
    IF v_prev IS NOT DISTINCT FROM p_operator_id THEN
        RETURN 'unchanged';
    END IF;
    UPDATE public.help_me_find_it_requests SET operator_id = p_operator_id WHERE id = p_request_id;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
    VALUES (auth.uid(), CASE WHEN p_operator_id IS NULL THEN 'help_request.unassigned' ELSE 'help_request.assigned' END,
            'help_request', p_request_id,
            JSONB_BUILD_OBJECT('operator_id', v_prev), JSONB_BUILD_OBJECT('operator_id', p_operator_id));
    RETURN CASE WHEN p_operator_id IS NULL THEN 'unassigned' ELSE 'assigned' END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assign_help_request(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_help_request(UUID, UUID) TO authenticated;

-- C. Homepage layout -----------------------------------------------------------------------------
-- The hero stays fixed; these are the sections below it. A section can be hidden or moved. Nothing is invented:
-- hiding a section only hides it, and a section with no data renders nothing either way.
CREATE TABLE public.homepage_sections (
    section_key TEXT PRIMARY KEY CHECK (section_key IN ('banners', 'featured', 'categories', 'stores', 'items', 'community', 'areas')),
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL CHECK (display_order BETWEEN 0 AND 1000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.homepage_sections (section_key, display_order) VALUES
    ('banners', 10), ('featured', 20), ('categories', 30), ('stores', 40), ('items', 50), ('community', 60), ('areas', 70);

ALTER TABLE public.homepage_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY homepage_sections_public_read ON public.homepage_sections FOR SELECT USING (TRUE);
REVOKE ALL ON public.homepage_sections FROM anon, authenticated;
GRANT SELECT ON public.homepage_sections TO anon, authenticated;

CREATE FUNCTION public.admin_set_homepage_section(p_key TEXT, p_visible BOOLEAN, p_order INT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_prev public.homepage_sections%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_visible IS NULL OR p_order IS NULL OR p_order NOT BETWEEN 0 AND 1000 THEN
        RAISE EXCEPTION 'visibility and an order between 0 and 1000 are required' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_prev FROM public.homepage_sections WHERE section_key = p_key FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown homepage section' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_prev.is_visible = p_visible AND v_prev.display_order = p_order THEN
        RETURN 'unchanged';
    END IF;
    UPDATE public.homepage_sections SET is_visible = p_visible, display_order = p_order, updated_at = NOW() WHERE section_key = p_key;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
    VALUES (auth.uid(), 'homepage_section.changed', 'homepage_section', MD5('homepage_section:' || p_key)::UUID,
            JSONB_BUILD_OBJECT('section', p_key, 'is_visible', v_prev.is_visible, 'display_order', v_prev.display_order),
            JSONB_BUILD_OBJECT('section', p_key, 'is_visible', p_visible, 'display_order', p_order));
    RETURN 'changed';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_homepage_section(TEXT, BOOLEAN, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_homepage_section(TEXT, BOOLEAN, INT) TO authenticated;

-- D. What the administrator saw ---------------------------------------------------------------------
-- When corrections are requested, the application's content at that moment is kept. After the applicant
-- resubmits, the admin screen compares it with the current content. Only the workflow writes it: a request role
-- cannot set or change it (so an applicant cannot forge the "before").
ALTER TABLE public.merchant_applications ADD COLUMN review_snapshot JSONB;

CREATE FUNCTION public.merchant_applications_review_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
    v_request_role BOOLEAN := CURRENT_USER IN ('anon', 'authenticated');
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF v_request_role THEN NEW.review_snapshot := NULL; END IF;
        RETURN NEW;
    END IF;
    IF NEW.status = 'correction_requested' AND OLD.status IS DISTINCT FROM 'correction_requested' THEN
        NEW.review_snapshot := TO_JSONB(OLD) - ARRAY[
            'id', 'applicant_user_id', 'status', 'rejection_reason', 'correction_notes', 'reviewed_by', 'reviewed_at',
            'associated_business_id', 'created_at', 'updated_at', 'review_snapshot', 'logo_storage_path',
            'photos_storage_paths', 'document_storage_paths'];
    ELSIF v_request_role AND NEW.review_snapshot IS DISTINCT FROM OLD.review_snapshot THEN
        RAISE EXCEPTION 'the review snapshot is set by the review workflow only' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_applications_review_snapshot() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_merchant_applications_review_snapshot BEFORE INSERT OR UPDATE ON public.merchant_applications
    FOR EACH ROW EXECUTE FUNCTION public.merchant_applications_review_snapshot();
