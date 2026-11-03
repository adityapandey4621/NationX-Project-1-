-- ============================================================================
-- 010_nearby_and_community.sql - opt-in "near me" distance + honest community stats
--
-- 1. search_storefronts() gains optional p_lat/p_lng. When given (the visitor chose
--    "Use my location"), each row carries distance_km (great-circle; NULL when the shop
--    has no coordinates) and sort 'nearest' becomes available. Coordinates are used for
--    this single call only; nothing is stored.
-- 2. community_stats(): real aggregate counts of live shops per area and how many
--    joined in the last 30 days. Sample/dev listings are excluded so a count can never
--    be inflated by fixtures.
-- ============================================================================

DROP FUNCTION IF EXISTS public.search_storefronts(TEXT, UUID, UUID, TEXT, TEXT, INT, INT);

CREATE FUNCTION public.search_storefronts(
    p_query TEXT DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_locality_id UUID DEFAULT NULL,
    p_model TEXT DEFAULT NULL,
    p_sort TEXT DEFAULT 'relevance',
    p_limit INT DEFAULT 12,
    p_offset INT DEFAULT 0,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL
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


-- 2. Community stats ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.community_stats()
RETURNS TABLE (locality_slug TEXT, locality_name TEXT, shop_count BIGINT, joined_30d BIGINT, last_joined_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT l.slug, l.name, COUNT(sf.id), COUNT(sf.id) FILTER (WHERE sf.created_at >= NOW() - INTERVAL '30 days'), MAX(sf.created_at)
    FROM public.localities l
    LEFT JOIN public.shops s ON s.locality_id = l.id AND s.is_active
    LEFT JOIN public.storefronts sf ON sf.shop_id = s.id AND sf.is_published AND sf.visibility_status = 'visible' AND NOT sf.is_sample
    WHERE l.is_active
    GROUP BY l.id
    ORDER BY l.name;
$$;
GRANT EXECUTE ON FUNCTION public.community_stats() TO anon, authenticated;
