-- ============================================================================
-- 017_admin_overview_and_team.sql - what an administrator needs to run the platform
--
--   admin_overview()   one call: applications by status, storefronts live/hidden/suspended, a row per area and
--                      per category (INCLUDING areas with no shops yet), items listed, requests, waitlist,
--                      notification queue health, people by role. Counts only, no personal data.
--   admin_list_team()  who holds the admin / operator role.
--   set_user_role()    grant or revoke admin / operator by e-mail. Audited. Cannot remove the last
--                      administrator and cannot remove your own admin role (no accidental lock-out).
--
-- All three are administrator-only (checked inside, not just by the page) and closed to anon.
-- ============================================================================

CREATE FUNCTION public.admin_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'generated_at', NOW(),
        'applications', COALESCE((
            SELECT JSONB_OBJECT_AGG(status, n)
            FROM (SELECT status, COUNT(*) AS n FROM public.merchant_applications WHERE status <> 'draft' GROUP BY status) s
        ), '{}'::jsonb),
        'storefronts', (
            SELECT JSONB_BUILD_OBJECT(
                'total', COUNT(*),
                'live', COUNT(*) FILTER (WHERE sf.is_published AND sf.visibility_status = 'visible' AND s.is_active),
                'hidden', COUNT(*) FILTER (WHERE sf.visibility_status = 'hidden'),
                'suspended', COUNT(*) FILTER (WHERE sf.visibility_status = 'suspended'),
                'unpublished', COUNT(*) FILTER (WHERE NOT sf.is_published AND sf.visibility_status = 'visible')
            )
            FROM public.storefronts sf JOIN public.shops s ON s.id = sf.shop_id
        ),
        'items', (
            SELECT JSONB_BUILD_OBJECT('total', COUNT(*), 'published', COUNT(*) FILTER (WHERE is_published))
            FROM public.storefront_products
        ),
        'by_area', COALESCE((
            SELECT JSONB_AGG(a ORDER BY a.name)
            FROM (
                SELECT l.id, l.name, l.is_active,
                       COUNT(sf.id) FILTER (WHERE sf.is_published AND sf.visibility_status = 'visible' AND s.is_active) AS live,
                       COUNT(sf.id) FILTER (WHERE sf.visibility_status = 'hidden') AS hidden,
                       COUNT(sf.id) FILTER (WHERE sf.visibility_status = 'suspended') AS suspended,
                       (SELECT COUNT(*) FROM public.storefront_products p JOIN public.shops s2 ON s2.id = p.shop_id
                         WHERE s2.locality_id = l.id AND p.is_published) AS items,
                       (SELECT COUNT(*) FROM public.area_waitlist w WHERE w.locality_id = l.id AND w.status = 'waiting') AS waiting
                FROM public.localities l
                LEFT JOIN public.shops s ON s.locality_id = l.id
                LEFT JOIN public.storefronts sf ON sf.shop_id = s.id
                GROUP BY l.id
            ) a
        ), '[]'::jsonb),
        'by_category', COALESCE((
            SELECT JSONB_AGG(c ORDER BY c.name)
            FROM (
                SELECT cat.id, cat.name, cat.is_active,
                       COUNT(sf.id) FILTER (WHERE sf.is_published AND sf.visibility_status = 'visible' AND s.is_active) AS live,
                       COUNT(sf.id) FILTER (WHERE sf.visibility_status IN ('hidden', 'suspended')) AS not_visible
                FROM public.categories cat
                LEFT JOIN public.shops s ON s.category_id = cat.id
                LEFT JOIN public.storefronts sf ON sf.shop_id = s.id
                GROUP BY cat.id
            ) c
        ), '[]'::jsonb),
        'help_requests', COALESCE((
            SELECT JSONB_OBJECT_AGG(status, n) FROM (SELECT status, COUNT(*) AS n FROM public.help_me_find_it_requests GROUP BY status) h
        ), '{}'::jsonb),
        'waitlist_waiting', (SELECT COUNT(*) FROM public.area_waitlist WHERE status = 'waiting'),
        'notifications', COALESCE((
            SELECT JSONB_OBJECT_AGG(status, n) FROM (SELECT status, COUNT(*) AS n FROM public.notification_queue GROUP BY status) q
        ), '{}'::jsonb),
        'people', COALESCE((
            SELECT JSONB_OBJECT_AGG(role, n) FROM (SELECT role, COUNT(*) AS n FROM public.user_roles GROUP BY role) r
        ), '{}'::jsonb)
    );
END;
$$;

CREATE FUNCTION public.admin_list_team()
RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT, roles TEXT[], is_active BOOLEAN, since TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
    SELECT p.id, p.full_name, p.email,
           ARRAY(SELECT ur2.role FROM public.user_roles ur2 WHERE ur2.user_id = p.id AND ur2.role IN ('admin', 'operator') ORDER BY ur2.role),
           p.is_active,
           MIN(ur.created_at)
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('admin', 'operator')
    GROUP BY p.id
    ORDER BY MIN(ur.created_at), p.full_name;
END;
$$;

CREATE FUNCTION public.set_user_role(p_email TEXT, p_role TEXT, p_grant BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target UUID;
    v_active BOOLEAN;
    v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
    IF NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_role NOT IN ('admin', 'operator') THEN
        RAISE EXCEPTION 'only the admin and operator roles can be managed here' USING ERRCODE = 'check_violation';
    END IF;
    IF p_grant IS NULL THEN
        RAISE EXCEPTION 'grant or revoke must be stated' USING ERRCODE = 'check_violation';
    END IF;
    IF v_reason IS NOT NULL AND CHAR_LENGTH(v_reason) > 500 THEN
        RAISE EXCEPTION 'reason is too long' USING ERRCODE = 'check_violation';
    END IF;

    SELECT id, is_active INTO v_target, v_active FROM public.profiles WHERE LOWER(email) = LOWER(BTRIM(COALESCE(p_email, '')));
    IF v_target IS NULL THEN
        RAISE EXCEPTION 'no registered account with that e-mail; ask the person to sign up first' USING ERRCODE = 'no_data_found';
    END IF;

    -- One role change at a time, so "the last administrator" cannot be raced past by two simultaneous revokes.
    PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXT('user_roles:change'));

    IF p_grant THEN
        IF NOT v_active THEN
            RAISE EXCEPTION 'that account is deactivated' USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_target AND role = p_role) THEN
            RETURN 'unchanged';
        END IF;
        INSERT INTO public.user_roles (user_id, role) VALUES (v_target, p_role);
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, new_state, reason)
        VALUES (auth.uid(), 'role.granted', 'profile', v_target, JSONB_BUILD_OBJECT('role', p_role), v_reason);
        RETURN 'granted';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_target AND role = p_role) THEN
        RETURN 'unchanged';
    END IF;
    IF p_role = 'admin' THEN
        IF v_target = auth.uid() THEN
            RAISE EXCEPTION 'you cannot remove your own administrator role; ask another administrator' USING ERRCODE = 'check_violation';
        END IF;
        IF (SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
            RAISE EXCEPTION 'cannot remove the last administrator' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    DELETE FROM public.user_roles WHERE user_id = v_target AND role = p_role;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, reason)
    VALUES (auth.uid(), 'role.revoked', 'profile', v_target, JSONB_BUILD_OBJECT('role', p_role), v_reason);
    RETURN 'revoked';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_team() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_user_role(TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_team() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
