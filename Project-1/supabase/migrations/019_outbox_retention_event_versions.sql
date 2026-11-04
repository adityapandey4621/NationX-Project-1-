-- 019: event outbox retention and versioned event payloads (ADR-014).
--
-- 1. schema_version: every event says which payload shape it carries, so a consumer (Grocery, Delivery, POS) can
--    refuse or branch on a shape it does not know. Existing rows are version 1. A breaking payload change must use
--    a new version number and be announced in docs/INTEGRATION_GUIDE_FOR_PRODUCT_TEAMS.md (additive changes keep it).
-- 2. Retention: the outbox is append-only, so a bare DELETE stays refused. The only way to remove rows is
--    purge_event_outbox(), which keeps at least 7 days, removes a contiguous prefix, records how far it purged
--    and writes one audit row. A consumer whose cursor is behind that point is told (`gap`) so it can re-sync
--    from /integration/shops instead of silently missing events.
-- Nothing here changes who can read or write the outbox.

-- 1. Version ---------------------------------------------------------------------------------
ALTER TABLE public.event_outbox
    ADD COLUMN schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (schema_version >= 1);

DROP FUNCTION public.emit_event(TEXT, TEXT, UUID, JSONB);
CREATE FUNCTION public.emit_event(
    p_type TEXT, p_entity_type TEXT, p_entity_id UUID, p_payload JSONB, p_version SMALLINT DEFAULT 1
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO public.event_outbox (event_type, entity_type, entity_id, payload, schema_version)
    VALUES (p_type, p_entity_type, p_entity_id, p_payload, p_version);
$$;
REVOKE EXECUTE ON FUNCTION public.emit_event(TEXT, TEXT, UUID, JSONB, SMALLINT) FROM PUBLIC, anon, authenticated;

-- The feed gains one column, so the function is recreated (a return type cannot be altered in place).
DROP FUNCTION public.events_since(BIGINT, INT);
CREATE FUNCTION public.events_since(p_after BIGINT DEFAULT 0, p_limit INT DEFAULT 100)
RETURNS TABLE (
    seq BIGINT, event_id UUID, event_type TEXT, schema_version SMALLINT, entity_type TEXT, entity_id UUID,
    payload JSONB, occurred_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT e.seq, e.event_id, e.event_type, e.schema_version, e.entity_type, e.entity_id, e.payload, e.created_at
    FROM public.event_outbox e
    WHERE e.seq > GREATEST(COALESCE(p_after, 0), 0)
      AND e.xid < PG_SNAPSHOT_XMIN(PG_CURRENT_SNAPSHOT())
    ORDER BY e.seq
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;
REVOKE EXECUTE ON FUNCTION public.events_since(BIGINT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.events_since(BIGINT, INT) TO service_role;

-- 2. Retention -------------------------------------------------------------------------------
-- One row: the highest sequence number ever purged (0 = nothing purged yet).
CREATE TABLE public.event_outbox_state (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    purged_through BIGINT NOT NULL DEFAULT 0 CHECK (purged_through >= 0)
);
INSERT INTO public.event_outbox_state DEFAULT VALUES;
ALTER TABLE public.event_outbox_state ENABLE ROW LEVEL SECURITY; -- no policies: invisible to anon/authenticated
REVOKE ALL ON public.event_outbox_state FROM anon, authenticated;

-- Deleting stays refused unless purge_event_outbox() (a definer function owned by the migration role) has raised
-- the flag in the same transaction. A request-facing role (anon, authenticated, service_role) is refused even if it
-- sets the flag itself; updating a row is never allowed.
CREATE OR REPLACE FUNCTION public.event_outbox_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND COALESCE(CURRENT_SETTING('nationx.outbox_purge', true), '') = 'on'
       AND CURRENT_USER NOT IN ('anon', 'authenticated', 'service_role') THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'event_outbox is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE FUNCTION public.purge_event_outbox(p_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_days INT := GREATEST(COALESCE(p_days, 30), 7); -- never less than a week, whatever the caller asks
    v_n INT;
    v_max BIGINT;
BEGIN
    -- Remove by age only (never "everything up to a sequence number"), so a recent event can never be caught up
    -- in a purge. `purged_through` then says "events at or below this may be gone" - the safe direction for a
    -- consumer deciding whether to re-sync.
    PERFORM SET_CONFIG('nationx.outbox_purge', 'on', true);
    WITH removed AS (
        DELETE FROM public.event_outbox WHERE created_at < NOW() - (v_days * INTERVAL '1 day') RETURNING seq
    )
    SELECT COUNT(*)::INT, MAX(seq) INTO v_n, v_max FROM removed;
    PERFORM SET_CONFIG('nationx.outbox_purge', 'off', true);

    IF v_n = 0 THEN RETURN 0; END IF;
    UPDATE public.event_outbox_state SET purged_through = GREATEST(purged_through, v_max);
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, new_state)
    VALUES (NULL, 'event_outbox.purged', 'event_outbox', '00000000-0000-0000-0000-000000000000',
            JSONB_BUILD_OBJECT('removed', v_n, 'through_seq', v_max, 'kept_days', v_days));
    RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_event_outbox(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_event_outbox(INT) TO service_role;

CREATE FUNCTION public.event_outbox_purged_through()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT purged_through FROM public.event_outbox_state; $$;
REVOKE EXECUTE ON FUNCTION public.event_outbox_purged_through() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_outbox_purged_through() TO service_role;
