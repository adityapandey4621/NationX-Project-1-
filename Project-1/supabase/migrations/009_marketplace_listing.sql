-- ============================================================================
-- 009_marketplace_listing.sql — customer-facing marketplace redesign (ADR-009)
--
-- 1. storefronts.is_sample: marks development sample listings so they can never
--    pass as real businesses (the UI labels them; production never sets it).
-- 2. search_storefronts() returns what a marketplace card needs and nothing
--    invented: banner, storefront template (drives card layout), the shop's own
--    opening hours, the number of PUBLISHED items, and the sample flag.
--    There are deliberately NO ratings, reviews, delivery times or offers: the
--    data model has none, and the product rule is never to fabricate them.
-- 3. recent_public_products(): newest published items from published shops, for
--    the homepage "Recently listed items" strip (search_products needs a query).
-- 4. Index for the item-count lookup and the browse query.
-- ============================================================================

-- 1. Sample flag --------------------------------------------------------------------------
ALTER TABLE public.storefronts ADD COLUMN is_sample BOOLEAN NOT NULL DEFAULT FALSE;

-- Platform-controlled like the other moderation fields (re-states the guard from 007).
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
           OR NEW.template_name IS DISTINCT FROM OLD.template_name
           OR NEW.is_sample IS DISTINCT FROM OLD.is_sample THEN
            RAISE EXCEPTION 'platform-controlled storefront fields are admin-only'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 2. Richer search rows -------------------------------------------------------------------
-- The return type changes, so the function is replaced rather than altered.
DROP FUNCTION IF EXISTS public.search_storefronts(TEXT, UUID, UUID, TEXT, TEXT, INT, INT);

CREATE FUNCTION public.search_storefronts(
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
    operating_models TEXT[], created_at TIMESTAMPTZ, rank REAL, total_count BIGINT,
    banner_url TEXT, template_name TEXT, operating_hours JSONB, item_count INT, is_sample BOOLEAN
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
        SELECT ARRAY_AGG(t) INTO v_tokens FROM (
            SELECT REPLACE(REPLACE(REPLACE(w, '\', ''), '%', ''), '_', '') AS t
            FROM REGEXP_SPLIT_TO_TABLE(v_q, '\s+') AS w LIMIT 6
        ) x WHERE t <> '';
    END IF;
    v_first := v_tokens[1];
    v_phrase := ARRAY_TO_STRING(v_tokens, ' ');
    IF v_sort NOT IN ('relevance', 'newest', 'name') THEN v_sort := 'relevance'; END IF;
    IF v_tokens IS NULL AND v_sort = 'relevance' THEN v_sort := 'newest'; END IF;

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
               sf.banner_url AS sf_banner, sf.template_name AS sf_template, s.operating_hours AS s_hours,
               sf.is_sample AS sf_sample,
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
                (sf.search_text ILIKE '%' || v_first || '%' OR (v_fuzzy AND v_first <% sf.search_text))
                AND NOT EXISTS (
                    SELECT 1 FROM UNNEST(v_tokens) AS tok
                    WHERE NOT (sf.search_text ILIKE '%' || tok || '%' OR (v_fuzzy AND tok <% sf.search_text)))))
    ), page AS (
        SELECT * FROM base b
        ORDER BY
            CASE WHEN v_sort = 'relevance' THEN b.sf_rank END DESC NULLS LAST,
            CASE WHEN v_sort = 'name' THEN LOWER(b.s_name) END ASC NULLS LAST,
            b.sf_created DESC, b.sf_id
        LIMIT v_limit OFFSET v_offset
    )
    -- The item count is computed for the visible page only (at most 50 rows).
    SELECT p.sf_id, p.sf_slug, p.s_id, p.s_name, p.sf_headline, p.sf_snippet, p.sf_logo,
           p.c_name, p.c_slug, p.l_name, p.l_slug, p.s_models, p.sf_created, p.sf_rank, p.sf_total,
           p.sf_banner, p.sf_template, p.s_hours,
           (SELECT COUNT(*)::INT FROM public.storefront_products sp WHERE sp.shop_id = p.s_id AND sp.is_published),
           p.sf_sample
    FROM page p
    ORDER BY
        CASE WHEN v_sort = 'relevance' THEN p.sf_rank END DESC NULLS LAST,
        CASE WHEN v_sort = 'name' THEN LOWER(p.s_name) END ASC NULLS LAST,
        p.sf_created DESC, p.sf_id;
END;
$$;

-- Category counts also report the category's storefront template, so a category the UI has
-- no specific icon for still gets a sensible presentation (see src/lib/marketplace).
DROP FUNCTION IF EXISTS public.public_category_counts();
CREATE FUNCTION public.public_category_counts()
RETURNS TABLE (id UUID, name TEXT, slug TEXT, display_order INT, shop_count BIGINT, default_template TEXT)
LANGUAGE sql STABLE SET search_path = public
AS $$
    SELECT c.id, c.name, c.slug, c.display_order, COUNT(sf.id) AS shop_count, c.default_template
    FROM public.categories c
    LEFT JOIN public.shops s ON s.category_id = c.id AND s.is_active
    LEFT JOIN public.storefronts sf ON sf.shop_id = s.id AND sf.is_published AND sf.visibility_status = 'visible'
    WHERE c.is_active
    GROUP BY c.id
    ORDER BY c.display_order, c.name;
$$;

-- 3. Recently listed items ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_published_recent
    ON public.storefront_products (created_at DESC) WHERE is_published;

CREATE OR REPLACE FUNCTION public.recent_public_products(
    p_locality_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 8
)
RETURNS TABLE (
    product_id UUID, name TEXT, name_te TEXT, unit TEXT, price NUMERIC, mrp NUMERIC, image_url TEXT,
    effective_stock_status TEXT, shop_name TEXT, storefront_slug TEXT, locality_name TEXT, locality_slug TEXT,
    category_name TEXT, category_slug TEXT, template_name TEXT, is_sample BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT p.id, p.name, p.name_te, p.unit, p.price, p.mrp, p.image_url, pw.effective_stock_status,
           s.name, sf.slug, l.name, l.slug, c.name, c.slug, sf.template_name, sf.is_sample
    FROM public.storefront_products p
    JOIN public.products_with_stock pw ON pw.id = p.id
    JOIN public.storefronts sf ON sf.shop_id = p.shop_id AND sf.is_published AND sf.visibility_status = 'visible'
    JOIN public.shops s ON s.id = p.shop_id AND s.is_active
    JOIN public.categories c ON c.id = s.category_id
    JOIN public.localities l ON l.id = s.locality_id
    WHERE p.is_published
      AND (p_locality_id IS NULL OR s.locality_id = p_locality_id)
    ORDER BY (p.image_url IS NOT NULL) DESC, p.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 24);
$$;
GRANT EXECUTE ON FUNCTION public.recent_public_products(UUID, INT) TO anon, authenticated;
