-- ============================================================================
-- 011_integration_platform.sql - seams for the Grocery (P2) and Shared Delivery (P3) products
--
-- Implements, for Foundation, the contracts proposed in
-- docs/INTEGRATION_GUIDE_FOR_PRODUCT_TEAMS.md (C1 references, C6 events). See ADR-010.
--
-- 1. service_clients: machine credentials for other NationX products. Only a SHA-256 hash
--    of the key is stored; the key is shown once at creation. Clients have scopes and can
--    be revoked. Verification is callable by the service role only, so a leaked hash
--    cannot be replayed through the public API.
-- 2. event_outbox: an append-only, transactional outbox written by triggers in the SAME
--    transaction as the change (so an event exists if and only if the change committed).
--    Consumers poll events_since(cursor); delivery is at-least-once and consumers must be
--    idempotent on event_id. Only non-sensitive reference data goes in a payload (ids,
--    slugs, status, names, locality/category), never contact details, and development
--    sample listings never emit events.
-- 3. integration_shops(): keyset-paginated shop references for other products.
-- ============================================================================

-- 1. Service clients ------------------------------------------------------------------------
CREATE TABLE public.service_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (CHAR_LENGTH(BTRIM(name)) BETWEEN 2 AND 80),
    key_prefix TEXT NOT NULL CHECK (key_prefix ~ '^nxsk_[A-Za-z0-9_-]{4,12}$'),
    key_hash TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
    scopes TEXT[] NOT NULL CHECK (CARDINALITY(scopes) BETWEEN 1 AND 8 AND scopes <@ ARRAY['events:read', 'reference:read']::TEXT[]),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

ALTER TABLE public.service_clients ENABLE ROW LEVEL SECURITY;
-- Admins can see which clients exist (never the key or its hash through the API: the
-- application selects explicit columns). Nobody writes directly; definer functions do.
CREATE POLICY service_clients_admin_read ON public.service_clients
    FOR SELECT TO authenticated USING (public.has_role('admin'));
REVOKE ALL ON public.service_clients FROM anon, authenticated;
GRANT SELECT (id, name, key_prefix, scopes, is_active, created_at, last_used_at, revoked_at) ON public.service_clients TO authenticated;

CREATE FUNCTION public.create_service_client(
    p_name TEXT, p_key_prefix TEXT, p_key_hash TEXT, p_scopes TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_id UUID;
BEGIN
    IF v_uid IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.service_clients (name, key_prefix, key_hash, scopes, created_by)
    VALUES (BTRIM(p_name), p_key_prefix, p_key_hash, p_scopes, v_uid)
    RETURNING id INTO v_id;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, new_state)
    VALUES (v_uid, 'service_client.created', 'service_client', v_id,
            JSONB_BUILD_OBJECT('name', BTRIM(p_name), 'key_prefix', p_key_prefix, 'scopes', p_scopes));
    RETURN v_id;
END;
$$;

CREATE FUNCTION public.revoke_service_client(p_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_changed INT;
BEGIN
    IF v_uid IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE public.service_clients SET is_active = FALSE, revoked_at = NOW()
    WHERE id = p_id AND is_active;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed = 0 THEN
        IF NOT EXISTS (SELECT 1 FROM public.service_clients WHERE id = p_id) THEN
            RAISE EXCEPTION 'service client not found' USING ERRCODE = 'no_data_found';
        END IF;
        RETURN FALSE; -- already revoked: idempotent
    END IF;
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, reason)
    VALUES (v_uid, 'service_client.revoked', 'service_client', p_id, NULLIF(LEFT(BTRIM(COALESCE(p_reason, '')), 500), ''));
    RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_service_client(TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_service_client(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_service_client(TEXT, TEXT, TEXT, TEXT[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_service_client(UUID, TEXT) FROM anon;

-- Called by the server with the service-role key only. Returns the client when the key hash
-- matches an active client; stamps last_used_at at most once a minute (avoids a write per call).
CREATE FUNCTION public.verify_service_key(p_key_hash TEXT)
RETURNS TABLE (client_id UUID, client_name TEXT, scopes TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c public.service_clients%ROWTYPE;
BEGIN
    SELECT * INTO c FROM public.service_clients WHERE key_hash = p_key_hash AND is_active;
    IF NOT FOUND THEN RETURN; END IF;
    IF c.last_used_at IS NULL OR c.last_used_at < NOW() - INTERVAL '1 minute' THEN
        UPDATE public.service_clients SET last_used_at = NOW() WHERE id = c.id;
    END IF;
    RETURN QUERY SELECT c.id, c.name, c.scopes;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verify_service_key(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_service_key(TEXT) TO service_role;

-- 2. Event outbox ---------------------------------------------------------------------------
CREATE TABLE public.event_outbox (
    seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$'),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    payload JSONB NOT NULL,
    -- The writing transaction. A consumer may only read rows whose transaction has finished
    -- (xid < the oldest in-flight xid), otherwise a slow transaction could commit "behind"
    -- the consumer's cursor and the event would be skipped forever.
    xid XID8 NOT NULL DEFAULT PG_CURRENT_XACT_ID(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_event_outbox_created ON public.event_outbox (created_at);

ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY; -- no policies: invisible to anon/authenticated
REVOKE ALL ON public.event_outbox FROM anon, authenticated;

-- Append-only, even for privileged sessions that are not superusers of the migration.
CREATE FUNCTION public.event_outbox_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'event_outbox is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER trg_event_outbox_immutable BEFORE UPDATE OR DELETE ON public.event_outbox
    FOR EACH ROW EXECUTE FUNCTION public.event_outbox_immutable();

CREATE FUNCTION public.emit_event(p_type TEXT, p_entity_type TEXT, p_entity_id UUID, p_payload JSONB)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO public.event_outbox (event_type, entity_type, entity_id, payload)
    VALUES (p_type, p_entity_type, p_entity_id, p_payload);
$$;
REVOKE EXECUTE ON FUNCTION public.emit_event(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- Storefront lifecycle: created, published/unpublished, visibility changed.
CREATE FUNCTION public.trg_storefront_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_shop RECORD;
    v_payload JSONB;
BEGIN
    IF NEW.is_sample THEN RETURN NEW; END IF; -- development samples never reach other products
    SELECT s.name, s.business_id, s.locality_id, s.category_id, l.slug AS locality_slug, c.slug AS category_slug
      INTO v_shop
    FROM public.shops s
    JOIN public.localities l ON l.id = s.locality_id
    JOIN public.categories c ON c.id = s.category_id
    WHERE s.id = NEW.shop_id;
    v_payload := JSONB_BUILD_OBJECT(
        'storefront_id', NEW.id, 'shop_id', NEW.shop_id, 'business_id', v_shop.business_id, 'slug', NEW.slug,
        'shop_name', v_shop.name, 'locality_id', v_shop.locality_id, 'locality_slug', v_shop.locality_slug,
        'category_id', v_shop.category_id, 'category_slug', v_shop.category_slug,
        'template_name', NEW.template_name, 'is_published', NEW.is_published, 'visibility_status', NEW.visibility_status,
        'ordering_enabled', NEW.ordering_enabled);
    IF TG_OP = 'INSERT' THEN
        PERFORM public.emit_event('storefront.created', 'storefront', NEW.id, v_payload);
    ELSE
        IF NEW.is_published IS DISTINCT FROM OLD.is_published THEN
            PERFORM public.emit_event(CASE WHEN NEW.is_published THEN 'storefront.published' ELSE 'storefront.unpublished' END,
                                      'storefront', NEW.id, v_payload);
        END IF;
        IF NEW.visibility_status IS DISTINCT FROM OLD.visibility_status THEN
            PERFORM public.emit_event('storefront.visibility_changed', 'storefront', NEW.id,
                                      v_payload || JSONB_BUILD_OBJECT('previous_visibility_status', OLD.visibility_status));
        END IF;
        IF NEW.ordering_enabled IS DISTINCT FROM OLD.ordering_enabled THEN
            PERFORM public.emit_event('storefront.ordering_changed', 'storefront', NEW.id, v_payload);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_storefront_events AFTER INSERT OR UPDATE ON public.storefronts
    FOR EACH ROW EXECUTE FUNCTION public.trg_storefront_events();

-- Shop reference data that other products depend on (location, category, activity).
CREATE FUNCTION public.trg_shop_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_changed TEXT[] := ARRAY[]::TEXT[];
BEGIN
    IF NEW.name IS DISTINCT FROM OLD.name THEN v_changed := ARRAY_APPEND(v_changed, 'name'); END IF;
    IF NEW.locality_id IS DISTINCT FROM OLD.locality_id THEN v_changed := ARRAY_APPEND(v_changed, 'locality'); END IF;
    IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN v_changed := ARRAY_APPEND(v_changed, 'category'); END IF;
    IF NEW.address_line IS DISTINCT FROM OLD.address_line OR NEW.pincode IS DISTINCT FROM OLD.pincode
       OR NEW.latitude IS DISTINCT FROM OLD.latitude OR NEW.longitude IS DISTINCT FROM OLD.longitude THEN
        v_changed := ARRAY_APPEND(v_changed, 'location');
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN v_changed := ARRAY_APPEND(v_changed, 'is_active'); END IF;
    IF NEW.operating_models IS DISTINCT FROM OLD.operating_models THEN v_changed := ARRAY_APPEND(v_changed, 'operating_models'); END IF;
    IF CARDINALITY(v_changed) > 0
       AND EXISTS (SELECT 1 FROM public.storefronts sf WHERE sf.shop_id = NEW.id AND NOT sf.is_sample) THEN
        PERFORM public.emit_event('shop.updated', 'shop', NEW.id,
            JSONB_BUILD_OBJECT('shop_id', NEW.id, 'business_id', NEW.business_id, 'changed', v_changed, 'is_active', NEW.is_active));
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_shop_events AFTER UPDATE ON public.shops
    FOR EACH ROW EXECUTE FUNCTION public.trg_shop_events();

-- Consumer read: events whose transaction has finished, in sequence order.
CREATE FUNCTION public.events_since(p_after BIGINT DEFAULT 0, p_limit INT DEFAULT 100)
RETURNS TABLE (seq BIGINT, event_id UUID, event_type TEXT, entity_type TEXT, entity_id UUID, payload JSONB, occurred_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT e.seq, e.event_id, e.event_type, e.entity_type, e.entity_id, e.payload, e.created_at
    FROM public.event_outbox e
    WHERE e.seq > GREATEST(COALESCE(p_after, 0), 0)
      AND e.xid < PG_SNAPSHOT_XMIN(PG_CURRENT_SNAPSHOT())
    ORDER BY e.seq
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;
REVOKE EXECUTE ON FUNCTION public.events_since(BIGINT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.events_since(BIGINT, INT) TO service_role;

-- 3. Shop references ------------------------------------------------------------------------
-- Live (published, visible, active, non-sample) shops; keyset pagination on shop id.
CREATE FUNCTION public.integration_shops(
    p_after UUID DEFAULT NULL, p_limit INT DEFAULT 100, p_locality_slug TEXT DEFAULT NULL, p_shop_id UUID DEFAULT NULL
)
RETURNS TABLE (
    shop_id UUID, business_id UUID, storefront_id UUID, slug TEXT, name TEXT,
    category_id UUID, category_slug TEXT, category_name TEXT, locality_id UUID, locality_slug TEXT, locality_name TEXT,
    address_line TEXT, pincode TEXT, latitude NUMERIC, longitude NUMERIC, phone TEXT, whatsapp TEXT,
    operating_models TEXT[], operating_hours JSONB, ordering_enabled BOOLEAN, template_name TEXT, updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT s.id, s.business_id, sf.id, sf.slug, s.name, c.id, c.slug, c.name, l.id, l.slug, l.name,
           s.address_line, s.pincode, s.latitude, s.longitude, s.phone, s.whatsapp,
           s.operating_models, s.operating_hours, sf.ordering_enabled, sf.template_name, GREATEST(s.updated_at, sf.updated_at)
    FROM public.shops s
    JOIN public.storefronts sf ON sf.shop_id = s.id
    JOIN public.categories c ON c.id = s.category_id
    JOIN public.localities l ON l.id = s.locality_id
    WHERE s.is_active AND sf.is_published AND sf.visibility_status = 'visible' AND NOT sf.is_sample
      AND (p_after IS NULL OR s.id > p_after)
      AND (p_locality_slug IS NULL OR l.slug = p_locality_slug)
      AND (p_shop_id IS NULL OR s.id = p_shop_id)
    ORDER BY s.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
$$;
REVOKE EXECUTE ON FUNCTION public.integration_shops(UUID, INT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_shops(UUID, INT, TEXT, UUID) TO service_role;
