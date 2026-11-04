-- ============================================================================
-- 007_catalogue_and_moderation.sql — Product showcase, stock labels, product
-- search and admin moderation of storefronts.
--
-- Scope (docs/adr/ADR-007): the Foundation product showcase (REQ-STR-03, AC-11,
-- AC-14) and administrator oversight (REQ-ADM-02, AC-09). There are NO orders,
-- payments or delivery here - the specification defers them (DEC-005).
--
-- 1. storefront_products: publication flag, validated prices, stock confirmation
--    time, per-shop limit, immutable shop.
-- 2. products_with_stock: view adding the *effective* stock label. Stale or
--    unconfirmed stock is reported as `call_to_confirm` (REQ-SRC-04, NFR-06).
-- 3. Product names feed the storefront search document (shop search finds
--    shops that list an item) and search_products() finds the items themselves.
-- 4. set_storefront_visibility(): admin-only, reason required, audited.
-- ============================================================================

-- 1. Products -------------------------------------------------------------------
ALTER TABLE public.storefront_products
    ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN stock_confirmed_at TIMESTAMPTZ;

ALTER TABLE public.storefront_products
    ADD CONSTRAINT chk_product_name_len CHECK (CHAR_LENGTH(BTRIM(name)) BETWEEN 1 AND 160),
    ADD CONSTRAINT chk_product_name_te_len CHECK (name_te IS NULL OR CHAR_LENGTH(name_te) <= 160),
    ADD CONSTRAINT chk_product_description_len CHECK (description IS NULL OR CHAR_LENGTH(description) <= 1000),
    ADD CONSTRAINT chk_product_unit_len CHECK (unit IS NULL OR CHAR_LENGTH(unit) <= 30),
    ADD CONSTRAINT chk_product_price CHECK (price IS NULL OR (price >= 0 AND price <= 10000000)),
    ADD CONSTRAINT chk_product_mrp CHECK (mrp IS NULL OR (mrp >= 0 AND mrp <= 10000000)),
    ADD CONSTRAINT chk_product_mrp_ge_price CHECK (mrp IS NULL OR price IS NULL OR mrp >= price),
    ADD CONSTRAINT chk_product_order CHECK (display_order BETWEEN 0 AND 100000);

CREATE INDEX idx_products_shop ON public.storefront_products(shop_id, display_order, created_at);

-- Stock confirmation time is stamped by the database, never trusted from the client:
--   * insert / stock_status change  -> now() (NULL while the status is call_to_confirm)
--   * a client update that merely touches stock_confirmed_at = "I re-checked the
--     shelf"; the supplied value is ignored and replaced with now().
CREATE OR REPLACE FUNCTION public.product_stamp_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.stock_confirmed_at := CASE WHEN NEW.stock_status = 'call_to_confirm' THEN NULL ELSE NOW() END;
    ELSIF NEW.stock_status IS DISTINCT FROM OLD.stock_status THEN
        NEW.stock_confirmed_at := CASE WHEN NEW.stock_status = 'call_to_confirm' THEN NULL ELSE NOW() END;
    ELSIF NEW.stock_confirmed_at IS DISTINCT FROM OLD.stock_confirmed_at THEN
        IF current_user IN ('anon', 'authenticated') THEN
            NEW.stock_confirmed_at := CASE WHEN NEW.stock_status = 'call_to_confirm' THEN NULL ELSE NOW() END;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_stamp_stock
    BEFORE INSERT OR UPDATE ON public.storefront_products
    FOR EACH ROW EXECUTE FUNCTION public.product_stamp_stock();

-- A product belongs to one shop for life; a shop lists at most 500 items.
CREATE OR REPLACE FUNCTION public.product_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
            RAISE EXCEPTION 'a product cannot be moved to another shop' USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSE
        -- Serialise concurrent inserts for one shop so the limit cannot be raced past.
        PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXT('products:' || NEW.shop_id::TEXT));
        IF (SELECT COUNT(*) FROM public.storefront_products WHERE shop_id = NEW.shop_id) >= 500 THEN
            RAISE EXCEPTION 'a shop can list up to 500 items' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_guard
    BEFORE INSERT OR UPDATE ON public.storefront_products
    FOR EACH ROW EXECUTE FUNCTION public.product_guard();

-- Policies: public sees only published items of publicly visible shops; employees
-- may read everything of their shop (writes stay owner/manager, see 004).
DROP POLICY products_public_read ON public.storefront_products;
CREATE POLICY products_public_read ON public.storefront_products
    FOR SELECT TO anon, authenticated
    USING (is_published = TRUE AND public.is_shop_publicly_visible(shop_id));
CREATE POLICY products_select_member ON public.storefront_products
    FOR SELECT TO authenticated USING (public.is_shop_member(shop_id));

-- 2. Effective stock label ----------------------------------------------------------
-- [PROPOSED] A stock statement older than 3 days is treated as unconfirmed.
-- Change the interval here only; every consumer reads the view / function.
CREATE OR REPLACE FUNCTION public.product_effective_stock(p_status TEXT, p_confirmed_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT CASE
        WHEN p_status IN ('in_stock', 'out_of_stock')
             AND p_confirmed_at IS NOT NULL
             AND p_confirmed_at > NOW() - INTERVAL '3 days'
        THEN p_status
        ELSE 'call_to_confirm'
    END;
$$;
GRANT EXECUTE ON FUNCTION public.product_effective_stock(TEXT, TIMESTAMPTZ) TO anon, authenticated;

-- security_invoker: the caller's RLS on storefront_products applies to the view.
CREATE VIEW public.products_with_stock WITH (security_invoker = TRUE) AS
    SELECT p.*, public.product_effective_stock(p.stock_status, p.stock_confirmed_at) AS effective_stock_status
    FROM public.storefront_products p;
GRANT SELECT ON public.products_with_stock TO anon, authenticated;

-- 3. Search integration -------------------------------------------------------------
-- Names (English + Telugu) of a shop's published items, appended to the storefront
-- search document so a search for "sugar" finds shops that list sugar.
CREATE OR REPLACE FUNCTION public.shop_products_search_text(p_shop_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT COALESCE(STRING_AGG(CONCAT_WS(' ', x.name, x.name_te), ' '), '')
    FROM (
        SELECT p.name, p.name_te
        FROM public.storefront_products p
        WHERE p.shop_id = p_shop_id AND p.is_published
        ORDER BY p.display_order, p.created_at
        LIMIT 100
    ) x;
$$;
REVOKE ALL ON FUNCTION public.shop_products_search_text(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.storefront_refresh_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    NEW.search_text := CONCAT_WS(' ', public.shop_search_text(NEW.shop_id), NEW.headline, NEW.description,
                                 NULLIF(public.shop_products_search_text(NEW.shop_id), ''));
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_refresh_search_text() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_storefronts_for_product()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    UPDATE public.storefronts SET search_text = search_text WHERE shop_id = COALESCE(NEW.shop_id, OLD.shop_id);
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_storefronts_for_product() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_products_refresh_search
    AFTER INSERT OR DELETE OR UPDATE OF name, name_te, is_published ON public.storefront_products
    FOR EACH ROW EXECUTE FUNCTION public.touch_storefronts_for_product();

UPDATE public.storefronts SET search_text = search_text;

-- Item search. Same rules as search_storefronts: every word must match; exact
-- (substring) first, fuzzy trigram only if nothing matches exactly. Only items
-- that are published, in a published+visible+active shop are returned, whoever calls.
CREATE OR REPLACE FUNCTION public.search_products(
    p_query TEXT,
    p_locality_id UUID DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_sort TEXT DEFAULT 'relevance',
    p_limit INT DEFAULT 12,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    product_id UUID, name TEXT, name_te TEXT, unit TEXT, price NUMERIC, mrp NUMERIC, image_url TEXT,
    effective_stock_status TEXT, shop_name TEXT, storefront_slug TEXT, locality_name TEXT, locality_slug TEXT,
    category_name TEXT, rank REAL, total_count BIGINT
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
    IF v_q IS NULL THEN RETURN; END IF;   -- items are found by name; no browse-all
    v_q := LEFT(v_q, 80);
    SELECT ARRAY_AGG(t) INTO v_tokens FROM (
        SELECT REPLACE(REPLACE(REPLACE(w, '\', ''), '%', ''), '_', '') AS t
        FROM REGEXP_SPLIT_TO_TABLE(v_q, '\s+') AS w LIMIT 6
    ) x WHERE t <> '';
    IF v_tokens IS NULL THEN RETURN; END IF;
    v_first := v_tokens[1];
    v_phrase := ARRAY_TO_STRING(v_tokens, ' ');
    IF v_sort NOT IN ('relevance', 'price_asc', 'price_desc') THEN v_sort := 'relevance'; END IF;

    v_fuzzy := NOT EXISTS (
        SELECT 1
        FROM public.storefront_products p
        JOIN public.storefronts sf ON sf.shop_id = p.shop_id AND sf.is_published AND sf.visibility_status = 'visible'
        JOIN public.shops s ON s.id = p.shop_id AND s.is_active
        WHERE p.is_published
          AND (p_locality_id IS NULL OR s.locality_id = p_locality_id)
          AND (p_category_id IS NULL OR s.category_id = p_category_id)
          AND NOT EXISTS (SELECT 1 FROM UNNEST(v_tokens) AS tok
                          WHERE p.name NOT ILIKE '%' || tok || '%' AND COALESCE(p.name_te, '') NOT ILIKE '%' || tok || '%')
    );

    RETURN QUERY
    WITH base AS (
        SELECT p.id AS p_id, p.name AS p_name, p.name_te AS p_name_te, p.unit AS p_unit, p.price AS p_price, p.mrp AS p_mrp,
               p.image_url AS p_image, public.product_effective_stock(p.stock_status, p.stock_confirmed_at) AS p_stock,
               s.name AS s_name, sf.slug AS sf_slug, l.name AS l_name, l.slug AS l_slug, c.name AS c_name,
               ((CASE WHEN p.name ILIKE v_phrase || '%' THEN 3 WHEN p.name ILIKE '%' || v_phrase || '%' THEN 2 ELSE 0 END)
                + (CASE WHEN public.product_effective_stock(p.stock_status, p.stock_confirmed_at) = 'in_stock' THEN 1 ELSE 0 END)
                + (CASE WHEN v_fuzzy THEN GREATEST(WORD_SIMILARITY(v_q, p.name), 0) ELSE 0 END))::REAL AS p_rank,
               COUNT(*) OVER () AS p_total
        FROM public.storefront_products p
        JOIN public.storefronts sf ON sf.shop_id = p.shop_id AND sf.is_published AND sf.visibility_status = 'visible'
        JOIN public.shops s ON s.id = p.shop_id AND s.is_active
        JOIN public.categories c ON c.id = s.category_id
        JOIN public.localities l ON l.id = s.locality_id
        WHERE p.is_published
          AND (p_locality_id IS NULL OR s.locality_id = p_locality_id)
          AND (p_category_id IS NULL OR s.category_id = p_category_id)
          AND NOT EXISTS (
                SELECT 1 FROM UNNEST(v_tokens) AS tok
                WHERE NOT (p.name ILIKE '%' || tok || '%' OR COALESCE(p.name_te, '') ILIKE '%' || tok || '%'
                           OR (v_fuzzy AND tok <% p.name)))
    )
    SELECT b.p_id, b.p_name, b.p_name_te, b.p_unit, b.p_price, b.p_mrp, b.p_image, b.p_stock,
           b.s_name, b.sf_slug, b.l_name, b.l_slug, b.c_name, b.p_rank, b.p_total
    FROM base b
    ORDER BY
        CASE WHEN v_sort = 'relevance' THEN b.p_rank END DESC NULLS LAST,
        CASE WHEN v_sort = 'price_asc' THEN b.p_price END ASC NULLS LAST,
        CASE WHEN v_sort = 'price_desc' THEN b.p_price END DESC NULLS LAST,
        LOWER(b.p_name), b.p_id
    LIMIT v_limit OFFSET v_offset;
END;
$$;
GRANT EXECUTE ON FUNCTION public.search_products(TEXT, UUID, UUID, TEXT, INT, INT) TO anon, authenticated;

-- 4. Admin moderation of storefronts -------------------------------------------------------
ALTER TABLE public.storefronts
    ADD COLUMN visibility_reason TEXT,
    ADD COLUMN visibility_changed_at TIMESTAMPTZ,
    ADD COLUMN visibility_changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD CONSTRAINT chk_visibility_reason_len CHECK (visibility_reason IS NULL OR CHAR_LENGTH(visibility_reason) <= 500);

-- Moderation columns are platform-controlled like the rest (adds to migration 002).
CREATE OR REPLACE FUNCTION public.guard_storefront_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('admin') THEN
        IF NEW.shop_id IS DISTINCT FROM OLD.shop_id
           OR NEW.slug IS DISTINCT FROM OLD.slug
           OR NEW.is_published IS DISTINCT FROM OLD.is_published
           OR NEW.visibility_status IS DISTINCT FROM OLD.visibility_status
           OR NEW.visibility_reason IS DISTINCT FROM OLD.visibility_reason
           OR NEW.visibility_changed_at IS DISTINCT FROM OLD.visibility_changed_at
           OR NEW.visibility_changed_by IS DISTINCT FROM OLD.visibility_changed_by
           OR NEW.ordering_enabled IS DISTINCT FROM OLD.ordering_enabled
           OR NEW.template_name IS DISTINCT FROM OLD.template_name THEN
            RAISE EXCEPTION 'platform-controlled storefront fields are admin-only'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Suspend / hide / reactivate. Idempotent per target state; reason mandatory when
-- taking a storefront offline (it is shown to the merchant and kept in the audit log).
CREATE OR REPLACE FUNCTION public.set_storefront_visibility(
    p_storefront_id UUID,
    p_status TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
    sf public.storefronts%ROWTYPE;
BEGIN
    IF v_uid IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_status NOT IN ('visible', 'hidden', 'suspended') THEN
        RAISE EXCEPTION 'unknown visibility status' USING ERRCODE = 'check_violation';
    END IF;
    IF p_status <> 'visible' AND (v_reason IS NULL OR CHAR_LENGTH(v_reason) < 3) THEN
        RAISE EXCEPTION 'a reason is required when hiding or suspending a storefront' USING ERRCODE = 'check_violation';
    END IF;
    IF v_reason IS NOT NULL AND CHAR_LENGTH(v_reason) > 500 THEN
        RAISE EXCEPTION 'the reason is too long (maximum 500 characters)' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO sf FROM public.storefronts WHERE id = p_storefront_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'storefront not found' USING ERRCODE = 'no_data_found';
    END IF;

    IF sf.visibility_status = p_status THEN
        RETURN JSONB_BUILD_OBJECT('storefront_id', sf.id, 'status', sf.visibility_status, 'changed', FALSE);
    END IF;

    UPDATE public.storefronts
    SET visibility_status = p_status,
        visibility_reason = CASE WHEN p_status = 'visible' THEN NULL ELSE v_reason END,
        visibility_changed_at = NOW(),
        visibility_changed_by = v_uid
    WHERE id = sf.id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state, reason)
    VALUES (v_uid, 'storefront.' || p_status, 'storefront', sf.id,
            JSONB_BUILD_OBJECT('visibility_status', sf.visibility_status),
            JSONB_BUILD_OBJECT('visibility_status', p_status, 'slug', sf.slug), v_reason);

    RETURN JSONB_BUILD_OBJECT('storefront_id', sf.id, 'status', p_status, 'changed', TRUE);
END;
$$;
REVOKE ALL ON FUNCTION public.set_storefront_visibility(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_storefront_visibility(UUID, TEXT, TEXT) TO authenticated;
