-- ============================================================================
-- 012_storefront_stats.sql - privacy-safe page and tap counts for merchants
--
-- Daily counters per storefront: page views and taps on Call / WhatsApp / Directions.
-- No visitor identifier, IP address, user agent or location is recorded: only a count per
-- (storefront, day). Days are Indian Standard Time days. Only live (published, visible,
-- non-sample) storefronts count, and an unknown or hidden slug is a silent no-op so the
-- endpoint cannot be used to probe which slugs exist.
-- These are engagement counts, not sales. They can be inflated by a determined person
-- (the endpoint is public and rate limited), so the UI says what they are.
-- ============================================================================

CREATE TABLE public.storefront_stats_daily (
    storefront_id UUID NOT NULL REFERENCES public.storefronts(id) ON DELETE CASCADE,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    views INT NOT NULL DEFAULT 0 CHECK (views >= 0),
    calls INT NOT NULL DEFAULT 0 CHECK (calls >= 0),
    whatsapp INT NOT NULL DEFAULT 0 CHECK (whatsapp >= 0),
    directions INT NOT NULL DEFAULT 0 CHECK (directions >= 0),
    PRIMARY KEY (storefront_id, day)
);
CREATE INDEX idx_storefront_stats_shop_day ON public.storefront_stats_daily (shop_id, day DESC);

ALTER TABLE public.storefront_stats_daily ENABLE ROW LEVEL SECURITY;
-- A shop's own team (and admins) read its counts; nobody writes except the definer function below.
CREATE POLICY storefront_stats_member_read ON public.storefront_stats_daily
    FOR SELECT TO authenticated USING (public.is_shop_member(shop_id) OR public.has_role('admin'));
REVOKE ALL ON public.storefront_stats_daily FROM anon, authenticated;
GRANT SELECT ON public.storefront_stats_daily TO authenticated;

CREATE FUNCTION public.record_storefront_event(p_slug TEXT, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sf RECORD;
    v_day DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
BEGIN
    IF p_action NOT IN ('view', 'call', 'whatsapp', 'directions') THEN
        RAISE EXCEPTION 'unknown action' USING ERRCODE = 'check_violation';
    END IF;
    IF p_slug IS NULL OR CHAR_LENGTH(p_slug) > 80 THEN RETURN FALSE; END IF;

    SELECT sf.id, sf.shop_id INTO v_sf
    FROM public.storefronts sf
    JOIN public.shops s ON s.id = sf.shop_id AND s.is_active
    WHERE sf.slug = p_slug AND sf.is_published AND sf.visibility_status = 'visible' AND NOT sf.is_sample;
    IF NOT FOUND THEN RETURN FALSE; END IF;

    INSERT INTO public.storefront_stats_daily AS d (storefront_id, shop_id, day, views, calls, whatsapp, directions)
    VALUES (v_sf.id, v_sf.shop_id, v_day,
            (p_action = 'view')::INT, (p_action = 'call')::INT, (p_action = 'whatsapp')::INT, (p_action = 'directions')::INT)
    ON CONFLICT (storefront_id, day) DO UPDATE SET
        views = d.views + (p_action = 'view')::INT,
        calls = d.calls + (p_action = 'call')::INT,
        whatsapp = d.whatsapp + (p_action = 'whatsapp')::INT,
        directions = d.directions + (p_action = 'directions')::INT;
    RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_storefront_event(TEXT, TEXT) TO anon, authenticated;