-- ============================================================================
-- 014_homepage_curation.sql - admin-managed homepage (REQ-HOM-07, REQ-ADM-04)
--
-- Banners and featured shops are chosen by an administrator and take effect without a redeploy.
-- Nothing is invented: with no rows the homepage simply shows neither. A featured shop only appears
-- while it is still live (published, visible, active), so hiding a shop also un-features it.
-- Also lets search_storefronts() be limited to a list of storefront ids (used to fetch featured shops).
-- ============================================================================

CREATE TABLE public.homepage_banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (CHAR_LENGTH(BTRIM(title)) BETWEEN 2 AND 80),
    body TEXT CHECK (body IS NULL OR CHAR_LENGTH(body) <= 200),
    link_url TEXT CHECK (link_url IS NULL OR (link_url ~ '^/[A-Za-z0-9/_?=&.-]*$' OR link_url ~ '^https://[^\s]+$')),
    locality_id UUID REFERENCES public.localities(id) ON DELETE CASCADE,
    display_order INT NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 1000),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE public.featured_storefronts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storefront_id UUID NOT NULL REFERENCES public.storefronts(id) ON DELETE CASCADE,
    locality_id UUID REFERENCES public.localities(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_featured_storefront_scope ON public.featured_storefronts (storefront_id, COALESCE(locality_id, '00000000-0000-0000-0000-000000000000'::UUID));

ALTER TABLE public.homepage_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_storefronts ENABLE ROW LEVEL SECURITY;
CREATE POLICY banners_public_read ON public.homepage_banners FOR SELECT TO anon, authenticated
    USING (is_active AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at > NOW()));
CREATE POLICY banners_admin_all ON public.homepage_banners FOR ALL TO authenticated
    USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
CREATE POLICY featured_public_read ON public.featured_storefronts FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY featured_admin_all ON public.featured_storefronts FOR ALL TO authenticated
    USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
REVOKE ALL ON public.homepage_banners, public.featured_storefronts FROM anon, authenticated;
GRANT SELECT ON public.homepage_banners, public.featured_storefronts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.homepage_banners, public.featured_storefronts TO authenticated;

DROP FUNCTION IF EXISTS public.search_storefronts(TEXT, UUID, UUID, TEXT, TEXT, INT, INT, DOUBLE PRECISION, DOUBLE PRECISION);
CREATE FUNCTION public.search_storefronts(
    p_query TEXT DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_locality_id UUID DEFAULT NULL,
    p_model TEXT DEFAULT NULL,
    p_sort TEXT DEFAULT 'relevance',
    p_limit INT DEFAULT 12,
    p_offset INT DEFAULT 0,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
    storefront_id UUID, slug TEXT, shop_id UUID, shop_name TEXT, headline TEXT, snippet TEXT, logo_url TEXT,
    category_name TEXT, category_slug TEXT, locality_name TEXT, locality_slug TEXT,
    operating_models TEXT[], created_at TIMESTAMPTZ, rank REAL, total_count BIGINT,
    banner_url TEXT, template_name TEXT, operating_hours JSONB, item_count INT, is_sample BOOLEAN,
    distance_km DOUBLE PRECISION
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
    v_geo BOOLEAN := COALESCE(p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180, FALSE);
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
    IF v_sort NOT IN ('relevance', 'newest', 'name', 'nearest') THEN v_sort := 'relevance'; END IF;
    IF v_sort = 'nearest' AND NOT v_geo THEN v_sort := 'relevance'; END IF;
    IF v_tokens IS NULL AND v_sort = 'relevance' THEN v_sort := 'newest'; END IF;

    IF v_tokens IS NOT NULL THEN
        v_fuzzy := NOT EXISTS (
            SELECT 1
            FROM public.storefronts sf
            JOIN public.shops s ON s.id = sf.shop_id
            WHERE sf.is_published AND sf.visibility_status = 'visible' AND s.is_active
              AND (p_category_id IS NULL OR s.category_id = p_category_id)
              AND (p_locality_id IS NULL OR s.locality_id = p_locality_id)
              AND (p_ids IS NULL OR sf.id = ANY (p_ids))
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
               CASE WHEN v_geo AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL THEN
                    6371 * 2 * ASIN(SQRT(LEAST(1.0,
                        POWER(SIN(RADIANS(s.latitude::DOUBLE PRECISION - p_lat) / 2), 2)
                        + COS(RADIANS(p_lat)) * COS(RADIANS(s.latitude::DOUBLE PRECISION))
                          * POWER(SIN(RADIANS(s.longitude::DOUBLE PRECISION - p_lng) / 2), 2)))) END AS sf_dist,
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
          AND (p_ids IS NULL OR sf.id = ANY (p_ids))
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
            CASE WHEN v_sort = 'nearest' THEN b.sf_dist END ASC NULLS LAST,
            b.sf_created DESC, b.sf_id
        LIMIT v_limit OFFSET v_offset
    )
    -- The item count is computed for the visible page only (at most 50 rows).
    SELECT p.sf_id, p.sf_slug, p.s_id, p.s_name, p.sf_headline, p.sf_snippet, p.sf_logo,
           p.c_name, p.c_slug, p.l_name, p.l_slug, p.s_models, p.sf_created, p.sf_rank, p.sf_total,
           p.sf_banner, p.sf_template, p.s_hours,
           (SELECT COUNT(*)::INT FROM public.storefront_products sp WHERE sp.shop_id = p.s_id AND sp.is_published),
           p.sf_sample, p.sf_dist
    FROM page p
    ORDER BY
        CASE WHEN v_sort = 'relevance' THEN p.sf_rank END DESC NULLS LAST,
        CASE WHEN v_sort = 'name' THEN LOWER(p.s_name) END ASC NULLS LAST,
        CASE WHEN v_sort = 'nearest' THEN p.sf_dist END ASC NULLS LAST,
        p.sf_created DESC, p.sf_id;
END;
$$;


