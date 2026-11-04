-- ============================================================================
-- 006_discovery_and_help_requests.sql — Customer discovery, search, Help Me Find It
--
-- 1. Denormalised, indexed search document per storefront (kept current by triggers).
-- 2. search_storefronts(): fuzzy, filtered, sorted, paginated search over PUBLISHED
--    storefronts only. SECURITY INVOKER: row-level security still applies.
-- 3. Category / locality counts for browsing.
-- 4. Help Me Find It: server-generated tracking IDs, throttling, ownership, staff
--    handling with audit - all through functions; no direct client writes.
-- ============================================================================

-- 1. Search document ---------------------------------------------------------------
ALTER TABLE public.storefronts
    ADD COLUMN search_text TEXT NOT NULL DEFAULT '',
    ADD COLUMN search_tsv TSVECTOR GENERATED ALWAYS AS (TO_TSVECTOR('simple', search_text)) STORED;

CREATE INDEX idx_storefronts_search_tsv ON public.storefronts USING gin (search_tsv);
CREATE INDEX idx_storefronts_search_trgm ON public.storefronts USING gin (search_text gin_trgm_ops);
CREATE INDEX idx_shops_category ON public.shops(category_id);
CREATE INDEX idx_storefronts_listing ON public.storefronts(created_at DESC) WHERE is_published AND visibility_status = 'visible';

-- Shop-level part of the document: name, category, locality, address, landmark, PIN code.
CREATE OR REPLACE FUNCTION public.shop_search_text(p_shop_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT CONCAT_WS(' ', s.name, c.name, l.name, s.address_line, s.landmark, s.pincode)
    FROM public.shops s
    JOIN public.categories c ON c.id = s.category_id
    JOIN public.localities l ON l.id = s.locality_id
    WHERE s.id = p_shop_id;
$$;
REVOKE ALL ON FUNCTION public.shop_search_text(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.storefront_refresh_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    NEW.search_text := CONCAT_WS(' ', public.shop_search_text(NEW.shop_id), NEW.headline, NEW.description);
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_refresh_search_text() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_storefronts_search_text
    BEFORE INSERT OR UPDATE ON public.storefronts
    FOR EACH ROW EXECUTE FUNCTION public.storefront_refresh_search_text();

-- When a shop / category / locality changes, re-run the storefront trigger.
CREATE OR REPLACE FUNCTION public.touch_storefronts_for_shop()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    UPDATE public.storefronts SET search_text = search_text WHERE shop_id = NEW.id;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_storefronts_for_taxonomy()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF TG_TABLE_NAME = 'categories' THEN
        UPDATE public.storefronts sf SET search_text = sf.search_text
        FROM public.shops s WHERE s.id = sf.shop_id AND s.category_id = NEW.id;
    ELSE
        UPDATE public.storefronts sf SET search_text = sf.search_text
        FROM public.shops s WHERE s.id = sf.shop_id AND s.locality_id = NEW.id;
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_storefronts_for_shop() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_storefronts_for_taxonomy() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_shops_refresh_search
    AFTER UPDATE OF name, category_id, locality_id, address_line, landmark, pincode ON public.shops
    FOR EACH ROW EXECUTE FUNCTION public.touch_storefronts_for_shop();
CREATE TRIGGER trg_categories_refresh_search
    AFTER UPDATE OF name ON public.categories
    FOR EACH ROW EXECUTE FUNCTION public.touch_storefronts_for_taxonomy();
CREATE TRIGGER trg_localities_refresh_search
    AFTER UPDATE OF name ON public.localities
    FOR EACH ROW EXECUTE FUNCTION public.touch_storefronts_for_taxonomy();

-- Backfill any existing storefronts.
UPDATE public.storefronts SET search_text = search_text;

-- 2. Search ----------------------------------------------------------------------------
-- Matching: every word the customer typed must match somewhere in the document,
-- either as a substring (works for any script, incl. Telugu) or fuzzily via
-- trigram word-similarity (tolerates spelling mistakes: "kirna" -> "kirana").
-- Only published, visible, active shops are returned, regardless of caller.
CREATE OR REPLACE FUNCTION public.search_storefronts(
    p_query TEXT DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_locality_id UUID DEFAULT NULL,
    p_model TEXT DEFAULT NULL,
    p_sort TEXT DEFAULT 'relevance',
    p_limit INT DEFAULT 12,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    storefront_id UUID, slug TEXT, shop_id UUID, shop_name TEXT, headline TEXT, snippet TEXT, logo_url TEXT,
    category_name TEXT, category_slug TEXT, locality_name TEXT, locality_slug TEXT,
    operating_models TEXT[], created_at TIMESTAMPTZ, rank REAL, total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
    v_q TEXT := NULLIF(BTRIM(REGEXP_REPLACE(COALESCE(p_query, ''), '[[:cntrl:]]', ' ', 'g')), '');
    v_tokens TEXT[];
    v_first TEXT;
    v_phrase TEXT;
    v_fuzzy BOOLEAN := FALSE;
    v_sort TEXT := COALESCE(p_sort, 'relevance');
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
    v_offset INT := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 10000);
BEGIN
    IF v_q IS NOT NULL THEN
        v_q := LEFT(v_q, 80);
        -- At most 6 words; strip LIKE wildcards and backslashes so input is literal text.
        SELECT ARRAY_AGG(t) INTO v_tokens FROM (
            SELECT REPLACE(REPLACE(REPLACE(w, '\', ''), '%', ''), '_', '') AS t
            FROM REGEXP_SPLIT_TO_TABLE(v_q, '\s+') AS w LIMIT 6
        ) x WHERE t <> '';
    END IF;
    v_first := v_tokens[1];
    v_phrase := ARRAY_TO_STRING(v_tokens, ' ');
    IF v_sort NOT IN ('relevance', 'newest', 'name') THEN v_sort := 'relevance'; END IF;
    IF v_tokens IS NULL AND v_sort = 'relevance' THEN v_sort := 'newest'; END IF;

    -- Two-step matching keeps the common path fast: look for exact (substring) matches
    -- first and only fall back to fuzzy trigram matching - which is far more expensive -
    -- when nothing matches exactly, e.g. a spelling mistake. The mode is decided once, so
    -- every page of one query is consistent.
    IF v_tokens IS NOT NULL THEN
        v_fuzzy := NOT EXISTS (
            SELECT 1
            FROM public.storefronts sf
            JOIN public.shops s ON s.id = sf.shop_id
            WHERE sf.is_published AND sf.visibility_status = 'visible' AND s.is_active
              AND (p_category_id IS NULL OR s.category_id = p_category_id)
              AND (p_locality_id IS NULL OR s.locality_id = p_locality_id)
              AND (p_model IS NULL OR p_model = ANY (s.operating_models))
              AND NOT EXISTS (SELECT 1 FROM UNNEST(v_tokens) AS tok WHERE sf.search_text NOT ILIKE '%' || tok || '%')
        );
    END IF;

    RETURN QUERY
    WITH base AS (
        SELECT sf.id AS sf_id, sf.slug AS sf_slug, s.id AS s_id, s.name AS s_name, sf.headline AS sf_headline,
               LEFT(COALESCE(sf.description, ''), 160) AS sf_snippet, sf.logo_url AS sf_logo,
               c.name AS c_name, c.slug AS c_slug, l.name AS l_name, l.slug AS l_slug,
               s.operating_models AS s_models, sf.created_at AS sf_created,
               -- Cheap rank: whole phrase in the shop name > name starts with the first word >
               -- text-search rank. Fuzzy matches additionally use name similarity.
               CASE WHEN v_tokens IS NULL THEN 0::REAL
                    ELSE ((CASE WHEN s.name ILIKE '%' || v_phrase || '%' THEN 2 ELSE 0 END)
                          + (CASE WHEN s.name ILIKE v_first || '%' THEN 1 ELSE 0 END)
                          + TS_RANK(sf.search_tsv, PLAINTO_TSQUERY('simple', v_q))
                          + (CASE WHEN v_fuzzy THEN GREATEST(WORD_SIMILARITY(v_q, s.name), 0) ELSE 0 END))::REAL END AS sf_rank,
               COUNT(*) OVER () AS sf_total
        FROM public.storefronts sf
        JOIN public.shops s ON s.id = sf.shop_id
        JOIN public.categories c ON c.id = s.category_id
        JOIN public.localities l ON l.id = s.locality_id
        WHERE sf.is_published AND sf.visibility_status = 'visible' AND s.is_active
          AND (p_category_id IS NULL OR s.category_id = p_category_id)
          AND (p_locality_id IS NULL OR s.locality_id = p_locality_id)
          AND (p_model IS NULL OR p_model = ANY (s.operating_models))
          AND (v_tokens IS NULL OR (
                -- first word: index-assisted pre-filter; then every word must match
                (sf.search_text ILIKE '%' || v_first || '%' OR (v_fuzzy AND v_first <% sf.search_text))
                AND NOT EXISTS (
                    SELECT 1 FROM UNNEST(v_tokens) AS tok
                    WHERE NOT (sf.search_text ILIKE '%' || tok || '%' OR (v_fuzzy AND tok <% sf.search_text)))))
    )
    SELECT b.sf_id, b.sf_slug, b.s_id, b.s_name, b.sf_headline, b.sf_snippet, b.sf_logo,
           b.c_name, b.c_slug, b.l_name, b.l_slug, b.s_models, b.sf_created, b.sf_rank, b.sf_total
    FROM base b
    ORDER BY
        CASE WHEN v_sort = 'relevance' THEN b.sf_rank END DESC NULLS LAST,
        CASE WHEN v_sort = 'name' THEN LOWER(b.s_name) END ASC NULLS LAST,
        b.sf_created DESC, b.sf_id
    LIMIT v_limit OFFSET v_offset;
END;
$$;

-- 3. Browse counts (published storefronts only) ----------------------------------------------
CREATE OR REPLACE FUNCTION public.public_category_counts()
RETURNS TABLE (id UUID, name TEXT, slug TEXT, display_order INT, shop_count BIGINT)
LANGUAGE sql STABLE SET search_path = public
AS $$
    SELECT c.id, c.name, c.slug, c.display_order, COUNT(sf.id) AS shop_count
    FROM public.categories c
    LEFT JOIN public.shops s ON s.category_id = c.id AND s.is_active
    LEFT JOIN public.storefronts sf ON sf.shop_id = s.id AND sf.is_published AND sf.visibility_status = 'visible'
    WHERE c.is_active
    GROUP BY c.id
    ORDER BY c.display_order, c.name;
$$;

CREATE OR REPLACE FUNCTION public.public_locality_counts()
RETURNS TABLE (id UUID, name TEXT, slug TEXT, district TEXT, shop_count BIGINT)
LANGUAGE sql STABLE SET search_path = public
AS $$
    SELECT l.id, l.name, l.slug, l.district, COUNT(sf.id) AS shop_count
    FROM public.localities l
    LEFT JOIN public.shops s ON s.locality_id = l.id AND s.is_active
    LEFT JOIN public.storefronts sf ON sf.shop_id = s.id AND sf.is_published AND sf.visibility_status = 'visible'
    WHERE l.is_active
    GROUP BY l.id
    ORDER BY l.name;
$$;

-- 4. Help Me Find It -------------------------------------------------------------------------
ALTER TABLE public.help_me_find_it_requests
    ADD COLUMN category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    ADD COLUMN contact_email TEXT,
    ADD COLUMN consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT hmf_item_name_len CHECK (CHAR_LENGTH(item_name) BETWEEN 2 AND 200),
    ADD CONSTRAINT hmf_item_description_len CHECK (item_description IS NULL OR CHAR_LENGTH(item_description) <= 1000),
    ADD CONSTRAINT hmf_contact_name_len CHECK (CHAR_LENGTH(contact_name) BETWEEN 1 AND 120),
    ADD CONSTRAINT hmf_phone_format CHECK (contact_phone ~ '^\+91[6-9][0-9]{9}$');

CREATE INDEX idx_hmf_customer ON public.help_me_find_it_requests(customer_user_id, created_at DESC);
CREATE INDEX idx_hmf_status ON public.help_me_find_it_requests(status, created_at);
CREATE INDEX idx_hmf_phone_recent ON public.help_me_find_it_requests(contact_phone, created_at DESC);

-- Per-month sequence for tracking IDs (function-only access).
CREATE TABLE public.hmf_counters (
    period TEXT PRIMARY KEY,
    last_value INT NOT NULL
);
ALTER TABLE public.hmf_counters ENABLE ROW LEVEL SECURITY;

-- All writes go through the functions below (they validate, throttle, number and audit).
DROP POLICY hmf_insert_public ON public.help_me_find_it_requests;
DROP POLICY hmf_update_staff ON public.help_me_find_it_requests;

CREATE OR REPLACE FUNCTION public.submit_help_request(
    p_item_name TEXT,
    p_item_description TEXT,
    p_locality_id UUID,
    p_category_id UUID,
    p_contact_name TEXT,
    p_contact_phone TEXT,
    p_contact_email TEXT,
    p_consent BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_locality public.localities%ROWTYPE;
    v_period TEXT := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM');
    v_seq INT;
    v_tracking TEXT;
    v_name TEXT := BTRIM(COALESCE(p_item_name, ''));
BEGIN
    IF NOT COALESCE(p_consent, FALSE) THEN
        RAISE EXCEPTION 'consent to be contacted is required' USING ERRCODE = 'check_violation';
    END IF;
    IF CHAR_LENGTH(v_name) NOT BETWEEN 2 AND 200 THEN
        RAISE EXCEPTION 'describe what you are looking for (2-200 characters)' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(CHAR_LENGTH(p_item_description), 0) > 1000 THEN
        RAISE EXCEPTION 'description is too long (max 1000 characters)' USING ERRCODE = 'check_violation';
    END IF;
    IF CHAR_LENGTH(BTRIM(COALESCE(p_contact_name, ''))) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'name is required' USING ERRCODE = 'check_violation';
    END IF;
    IF p_contact_phone IS NULL OR p_contact_phone !~ '^\+91[6-9][0-9]{9}$' THEN
        RAISE EXCEPTION 'enter a valid Indian mobile number' USING ERRCODE = 'check_violation';
    END IF;
    IF p_contact_email IS NOT NULL AND (CHAR_LENGTH(p_contact_email) > 254 OR p_contact_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
        RAISE EXCEPTION 'enter a valid email address' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_locality FROM public.localities WHERE id = p_locality_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'choose a valid locality' USING ERRCODE = 'check_violation';
    END IF;
    IF p_category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categories WHERE id = p_category_id AND is_active) THEN
        RAISE EXCEPTION 'choose a valid category' USING ERRCODE = 'check_violation';
    END IF;

    -- Abuse protection: 5 requests / phone / hour, 10 requests / signed-in user / day.
    IF (SELECT COUNT(*) FROM public.help_me_find_it_requests
        WHERE contact_phone = p_contact_phone AND created_at > NOW() - INTERVAL '1 hour') >= 5 THEN
        RAISE EXCEPTION 'too many requests from this number; please try again later' USING ERRCODE = 'program_limit_exceeded';
    END IF;
    IF v_uid IS NOT NULL AND (SELECT COUNT(*) FROM public.help_me_find_it_requests
        WHERE customer_user_id = v_uid AND created_at > NOW() - INTERVAL '1 day') >= 10 THEN
        RAISE EXCEPTION 'daily request limit reached; please try again tomorrow' USING ERRCODE = 'program_limit_exceeded';
    END IF;

    INSERT INTO public.hmf_counters (period, last_value) VALUES (v_period, 1)
    ON CONFLICT (period) DO UPDATE SET last_value = public.hmf_counters.last_value + 1
    RETURNING last_value INTO v_seq;
    -- Region code = first three consonants of the district (Khammam -> KHM, Hyderabad -> HYD).
    v_tracking := 'HMF-'
                  || RPAD(LEFT(REGEXP_REPLACE(UPPER(v_locality.district), '[^BCDFGHJKLMNPQRSTVWXYZ]', '', 'g'), 3), 3, 'X')
                  || '-' || v_period || '-' || LPAD(v_seq::TEXT, 4, '0');

    INSERT INTO public.help_me_find_it_requests (
        tracking_id, customer_user_id, item_name, item_description, preferred_locality_id, category_id,
        contact_name, contact_phone, contact_email, consent_given)
    VALUES (v_tracking, v_uid, v_name, NULLIF(BTRIM(COALESCE(p_item_description, '')), ''), p_locality_id, p_category_id,
            BTRIM(p_contact_name), p_contact_phone, NULLIF(BTRIM(COALESCE(p_contact_email, '')), ''), TRUE);

    RETURN JSONB_BUILD_OBJECT('tracking_id', v_tracking, 'status', 'pending');
END;
$$;

-- Status lookup for people without an account: needs BOTH tracking id and phone.
CREATE OR REPLACE FUNCTION public.track_help_request(p_tracking_id TEXT, p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r public.help_me_find_it_requests%ROWTYPE;
    v_slug TEXT;
BEGIN
    SELECT * INTO r FROM public.help_me_find_it_requests
    WHERE tracking_id = UPPER(BTRIM(COALESCE(p_tracking_id, ''))) AND contact_phone = BTRIM(COALESCE(p_phone, ''));
    -- One uniform error whether the id or the phone was wrong.
    IF NOT FOUND THEN
        RAISE EXCEPTION 'request not found' USING ERRCODE = 'no_data_found';
    END IF;
    IF r.matched_shop_id IS NOT NULL THEN
        SELECT sf.slug INTO v_slug FROM public.storefronts sf
        WHERE sf.shop_id = r.matched_shop_id AND public.is_shop_publicly_visible(r.matched_shop_id);
    END IF;
    RETURN JSONB_BUILD_OBJECT(
        'tracking_id', r.tracking_id, 'status', r.status, 'item_name', r.item_name,
        'created_at', r.created_at, 'updated_at', r.updated_at, 'resolution_notes', r.resolution_notes,
        'matched_shop_slug', v_slug);
END;
$$;

-- A signed-in customer may withdraw their own open request.
CREATE OR REPLACE FUNCTION public.cancel_help_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    r public.help_me_find_it_requests%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO r FROM public.help_me_find_it_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND OR r.customer_user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'request not found' USING ERRCODE = 'no_data_found';
    END IF;
    IF r.status NOT IN ('pending', 'under_review') THEN
        RAISE EXCEPTION 'a request in status % cannot be cancelled', r.status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    UPDATE public.help_me_find_it_requests SET status = 'cancelled', resolved_at = NOW() WHERE id = r.id;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
    VALUES (v_uid, 'help_request.cancelled', 'help_me_find_it_request', r.id,
            JSONB_BUILD_OBJECT('status', r.status), JSONB_BUILD_OBJECT('status', 'cancelled'));
    RETURN JSONB_BUILD_OBJECT('request_id', r.id, 'status', 'cancelled');
END;
$$;

-- Staff (admin / operator) handling. No automatic matching: a person decides.
--   pending|under_review -> under_review | matched | unresolved | cancelled
--   matched|unresolved   -> under_review (reopen)
-- 'matched' requires a real, published storefront (REQ-HMF-04: never promise availability
-- without a confirmed merchant source); 'unresolved' requires a note.
CREATE OR REPLACE FUNCTION public.update_help_request(
    p_request_id UUID,
    p_status TEXT,
    p_notes TEXT DEFAULT NULL,
    p_matched_shop_slug TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    r public.help_me_find_it_requests%ROWTYPE;
    v_shop UUID;
    v_notes TEXT := NULLIF(BTRIM(COALESCE(p_notes, '')), '');
BEGIN
    IF v_uid IS NULL OR NOT (public.has_role('admin') OR public.has_role('operator')) THEN
        RAISE EXCEPTION 'operator or administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_status NOT IN ('under_review', 'matched', 'unresolved', 'cancelled') THEN
        RAISE EXCEPTION 'unknown status %', p_status USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO r FROM public.help_me_find_it_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'request not found' USING ERRCODE = 'no_data_found';
    END IF;
    IF r.status = 'cancelled'
       OR (r.status IN ('matched', 'unresolved') AND p_status <> 'under_review') THEN
        RAISE EXCEPTION 'cannot change a % request to %', r.status, p_status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    IF p_status = 'matched' THEN
        SELECT sf.shop_id INTO v_shop FROM public.storefronts sf
        WHERE sf.slug = BTRIM(COALESCE(p_matched_shop_slug, '')) AND public.is_shop_publicly_visible(sf.shop_id);
        IF v_shop IS NULL THEN
            RAISE EXCEPTION 'a matched request needs the slug of a published shop' USING ERRCODE = 'check_violation';
        END IF;
    ELSIF p_status = 'unresolved' AND v_notes IS NULL THEN
        RAISE EXCEPTION 'add a note explaining why this could not be resolved' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.help_me_find_it_requests
    SET status = p_status,
        operator_id = v_uid,
        matched_shop_id = CASE WHEN p_status = 'matched' THEN v_shop WHEN p_status = 'under_review' THEN NULL ELSE matched_shop_id END,
        resolution_notes = COALESCE(v_notes, CASE WHEN p_status = 'under_review' THEN resolution_notes END),
        resolved_at = CASE WHEN p_status IN ('matched', 'unresolved', 'cancelled') THEN NOW() ELSE NULL END
    WHERE id = r.id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state, reason)
    VALUES (v_uid, 'help_request.' || p_status, 'help_me_find_it_request', r.id,
            JSONB_BUILD_OBJECT('status', r.status),
            JSONB_BUILD_OBJECT('status', p_status, 'matched_shop_id', v_shop), v_notes);

    RETURN JSONB_BUILD_OBJECT('request_id', r.id, 'status', p_status);
END;
$$;

-- Execution rights --------------------------------------------------------------------------
-- Submitting and tracking work without an account; everything else needs a session.
REVOKE ALL ON FUNCTION public.submit_help_request(TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.track_help_request(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_help_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_help_request(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_help_request(TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_help_request(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_help_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_help_request(UUID, TEXT, TEXT, TEXT) TO authenticated;
