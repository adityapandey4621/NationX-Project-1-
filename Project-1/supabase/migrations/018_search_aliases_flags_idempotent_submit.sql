-- ============================================================================
-- 018_search_aliases_flags_idempotent_submit.sql
--
-- 1. Search aliases (AC-12). Administrator-managed spelling / script variants ("laxmi" = "lakshmi",
--    "kirana" = Telugu "కిరాణా"). Applied when a storefront's search document is BUILT, not when a
--    customer searches: if the document contains a term, its aliases are appended to the document.
--    search_storefronts() is therefore unchanged and stays as fast as before (no query-time joins).
-- 2. admin_set_feature_flag() (AC-19). Audited, administrator-only toggle for module flags, and the two
--    documented module keys (grocery, shared_delivery) are seeded DISABLED. They ship dark: no module
--    code exists, so enabling one changes nothing visible until that module is built.
-- 3. submit_merchant_application() becomes idempotent (AC-20). A double click or a network retry after
--    the first call succeeded used to answer "an application in status submitted cannot be submitted"
--    although it HAD been submitted. It now returns success, writes no second audit row, and changes nothing.
-- ============================================================================

-- 1. Search aliases -----------------------------------------------------------------------------
CREATE TABLE public.search_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term TEXT NOT NULL,
    alias TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT search_aliases_term_ck CHECK (CHAR_LENGTH(term) BETWEEN 2 AND 60 AND term = LOWER(BTRIM(term))),
    CONSTRAINT search_aliases_alias_ck CHECK (CHAR_LENGTH(alias) BETWEEN 2 AND 60 AND alias = LOWER(BTRIM(alias))),
    CONSTRAINT search_aliases_differ_ck CHECK (term <> alias),
    CONSTRAINT search_aliases_unique UNIQUE (term, alias)
);
ALTER TABLE public.search_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.search_aliases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.search_aliases TO authenticated;
-- Only administrators can even read the list; every write goes through the audited functions below.
CREATE POLICY search_aliases_admin_read ON public.search_aliases
    FOR SELECT TO authenticated USING (public.has_role('admin'));

CREATE FUNCTION public.expand_search_aliases(p_text TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT COALESCE(STRING_AGG(DISTINCT a.alias, ' '), '')
    FROM public.search_aliases a
    WHERE POSITION(a.term IN LOWER(COALESCE(p_text, ''))) > 0;
$$;
REVOKE ALL ON FUNCTION public.expand_search_aliases(TEXT) FROM PUBLIC, anon, authenticated;

-- Same document as migration 007, plus the aliases of every term the document contains.
CREATE OR REPLACE FUNCTION public.storefront_refresh_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_base TEXT;
BEGIN
    v_base := CONCAT_WS(' ', public.shop_search_text(NEW.shop_id), NEW.headline, NEW.description,
                        NULLIF(public.shop_products_search_text(NEW.shop_id), ''));
    NEW.search_text := CONCAT_WS(' ', v_base, NULLIF(public.expand_search_aliases(v_base), ''));
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_refresh_search_text() FROM PUBLIC, anon, authenticated;

-- Re-index only the storefronts whose document contains one of the given words.
CREATE FUNCTION public.reindex_storefronts_containing(p_words TEXT[])
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_n INT;
BEGIN
    UPDATE public.storefronts sf SET search_text = sf.search_text
    WHERE EXISTS (SELECT 1 FROM UNNEST(p_words) w WHERE POSITION(w IN LOWER(sf.search_text)) > 0);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.reindex_storefronts_containing(TEXT[]) FROM PUBLIC, anon, authenticated;

-- Add an alias (and, by default, the reverse pair so either spelling finds the other).
CREATE FUNCTION public.admin_add_search_alias(p_term TEXT, p_alias TEXT, p_both BOOLEAN DEFAULT TRUE)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_term TEXT := LOWER(BTRIM(REGEXP_REPLACE(COALESCE(p_term, ''), '\s+', ' ', 'g')));
    v_alias TEXT := LOWER(BTRIM(REGEXP_REPLACE(COALESCE(p_alias, ''), '\s+', ' ', 'g')));
    v_added INT := 0;
    v_n INT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF CHAR_LENGTH(v_term) NOT BETWEEN 2 AND 60 OR CHAR_LENGTH(v_alias) NOT BETWEEN 2 AND 60 THEN
        RAISE EXCEPTION 'both words must be 2 to 60 characters' USING ERRCODE = 'check_violation';
    END IF;
    IF v_term = v_alias THEN
        RAISE EXCEPTION 'the two words are the same' USING ERRCODE = 'check_violation';
    END IF;
    -- A hard ceiling keeps one mistake (or one bad actor with an admin session) from bloating every search document.
    IF (SELECT COUNT(*) FROM public.search_aliases) >= 2000 THEN
        RAISE EXCEPTION 'the alias list is full (2000); remove some first' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.search_aliases (term, alias, created_by) VALUES (v_term, v_alias, auth.uid())
    ON CONFLICT (term, alias) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_added := v_added + v_n;
    IF p_both THEN
        INSERT INTO public.search_aliases (term, alias, created_by) VALUES (v_alias, v_term, auth.uid())
        ON CONFLICT (term, alias) DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_added := v_added + v_n;
    END IF;

    IF v_added > 0 THEN
        PERFORM public.reindex_storefronts_containing(ARRAY[v_term, v_alias]);
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, new_state)
        VALUES (auth.uid(), 'search_alias.added', 'search_alias',
                (SELECT a.id FROM public.search_aliases a WHERE a.term = v_term AND a.alias = v_alias),
                JSONB_BUILD_OBJECT('term', v_term, 'alias', v_alias, 'both_ways', p_both));
    END IF;
    RETURN v_added;
END;
$$;

CREATE FUNCTION public.admin_remove_search_alias(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_row public.search_aliases%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    DELETE FROM public.search_aliases WHERE id = p_id RETURNING * INTO v_row;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    PERFORM public.reindex_storefronts_containing(ARRAY[v_row.alias]);
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state)
    VALUES (auth.uid(), 'search_alias.removed', 'search_alias', v_row.id,
            JSONB_BUILD_OBJECT('term', v_row.term, 'alias', v_row.alias));
    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_add_search_alias(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_remove_search_alias(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_search_alias(TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_search_alias(UUID) TO authenticated;

-- Starter list: spelling variants of very common Indian shop-name words, and the category names in
-- Telugu / everyday English. [PROPOSED]: the Telugu words have NOT been reviewed by a native speaker;
-- an administrator can remove or correct any row in /admin/search. No shop, rating or fact is invented.
INSERT INTO public.search_aliases (term, alias)
SELECT a, b FROM (VALUES
    ('lakshmi','laxmi'), ('lakshmi','luxmi'), ('laxmi','luxmi'),
    ('sri','shree'), ('sri','shri'), ('shree','shri'),
    ('venkateswara','venkateshwara'), ('venkateswara','venkateswar'), ('venkateshwara','venkateswar'),
    ('saraswathi','saraswati'), ('ganesh','ganesha'), ('krishna','krushna'),
    ('kirana','కిరాణా'), ('kirana','grocery'), ('kirana','general store'),
    ('pharmacy','medical'), ('pharmacy','chemist'), ('pharmacy','మెడికల్'),
    ('hardware','హార్డ్‌వేర్'), ('electrical','electricals'), ('electrical','ఎలక్ట్రికల్'),
    ('salons','salon'), ('salons','beauty parlour'), ('salons','సెలూన్')
) AS v(a, b)
ON CONFLICT (term, alias) DO NOTHING;
-- The pairs above are one-directional by construction; add the reverse of each so either spelling matches.
INSERT INTO public.search_aliases (term, alias)
SELECT alias, term FROM public.search_aliases
ON CONFLICT (term, alias) DO NOTHING;

UPDATE public.storefronts SET search_text = search_text;

-- 2. Feature flags -----------------------------------------------------------------------------------
INSERT INTO public.feature_flags (key, description, is_enabled)
VALUES
    ('grocery', 'Grocery ordering module (future; no module code exists yet)', FALSE),
    ('shared_delivery', 'Shared delivery module (future; no module code exists yet)', FALSE)
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION public.admin_set_feature_flag(p_key TEXT, p_enabled BOOLEAN, p_localities UUID[] DEFAULT ARRAY[]::UUID[], p_reason TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_flag public.feature_flags%ROWTYPE;
    v_locs UUID[] := COALESCE((SELECT ARRAY_AGG(DISTINCT x) FROM UNNEST(COALESCE(p_localities, ARRAY[]::UUID[])) x), ARRAY[]::UUID[]);
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_enabled IS NULL THEN
        RAISE EXCEPTION 'enabled must be true or false' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_flag FROM public.feature_flags WHERE key = p_key FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown module flag' USING ERRCODE = 'no_data_found';
    END IF;
    IF CARDINALITY(v_locs) > 0 AND (SELECT COUNT(*) FROM public.localities WHERE id = ANY (v_locs)) <> CARDINALITY(v_locs) THEN
        RAISE EXCEPTION 'one of the selected areas does not exist' USING ERRCODE = 'check_violation';
    END IF;
    IF v_flag.is_enabled = p_enabled AND v_flag.enabled_localities = v_locs THEN
        RETURN 'unchanged';
    END IF;

    UPDATE public.feature_flags SET is_enabled = p_enabled, enabled_localities = v_locs WHERE id = v_flag.id;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state, reason)
    VALUES (auth.uid(), 'feature_flag.changed', 'feature_flag', v_flag.id,
            JSONB_BUILD_OBJECT('key', v_flag.key, 'is_enabled', v_flag.is_enabled, 'enabled_localities', v_flag.enabled_localities),
            JSONB_BUILD_OBJECT('key', v_flag.key, 'is_enabled', p_enabled, 'enabled_localities', v_locs),
            NULLIF(BTRIM(COALESCE(p_reason, '')), ''));
    RETURN 'changed';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_feature_flag(TEXT, BOOLEAN, UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_flag(TEXT, BOOLEAN, UUID[], TEXT) TO authenticated;

-- 3. Idempotent submit -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_merchant_application(p_application_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_app public.merchant_applications%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_app FROM public.merchant_applications WHERE id = p_application_id FOR UPDATE;
    -- Same error for "missing" and "not yours": do not reveal other users' records.
    IF NOT FOUND OR v_app.applicant_user_id <> v_uid THEN
        RAISE EXCEPTION 'application not found' USING ERRCODE = 'no_data_found';
    END IF;
    -- A repeat of a submit that already succeeded (double click, retry after a timeout) is a success, not an error.
    -- The row is locked above, so two simultaneous calls are serialised and only the first writes anything.
    IF v_app.status = 'submitted' THEN
        RETURN jsonb_build_object('application_id', v_app.id, 'status', 'submitted', 'already_submitted', true);
    END IF;
    IF v_app.status NOT IN ('draft', 'correction_requested') THEN
        RAISE EXCEPTION 'an application in status % cannot be submitted', v_app.status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF NOT v_app.declaration_accepted THEN
        RAISE EXCEPTION 'the declaration must be accepted before submitting' USING ERRCODE = 'check_violation';
    END IF;
    IF CARDINALITY(v_app.operating_models) = 0 THEN
        RAISE EXCEPTION 'select at least one operating model' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.merchant_applications SET status = 'submitted' WHERE id = v_app.id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
    VALUES (v_uid, 'application.submitted', 'merchant_application', v_app.id,
            jsonb_build_object('status', v_app.status), jsonb_build_object('status', 'submitted'));

    RETURN jsonb_build_object('application_id', v_app.id, 'status', 'submitted');
END;
$$;
