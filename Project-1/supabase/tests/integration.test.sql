-- Behavioural tests for migration 011 (integration platform, ADR-010): service clients,
-- the transactional event outbox, and shop references. Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000b1','adm@example.test','{"full_name":"Adm","phone":"+919000000081"}'),
 ('00000000-0000-0000-0000-0000000000b2','own@example.test','{"full_name":"Own","phone":"+919000000082"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000b1','admin');
INSERT INTO businesses (id, name, primary_owner_id) VALUES ('10000000-0000-0000-0000-0000000000b1','Int Biz','00000000-0000-0000-0000-0000000000b2');
INSERT INTO business_members (business_id, user_id, role) VALUES ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2','owner');

CREATE FUNCTION t.act(uid TEXT, r TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(uid,''), true);
  EXECUTE format('SET LOCAL ROLE %I', r);
END $$;
GRANT EXECUTE ON FUNCTION t.act(TEXT,TEXT) TO anon, authenticated, service_role;
CREATE FUNCTION t.raises(name TEXT, uid TEXT, r TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN;
BEGIN
  BEGIN PERFORM t.act(uid, r); EXECUTE stmt; RESET ROLE; ok := false;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; ok := true; END;
  INSERT INTO t.results VALUES (name, ok);
END $$;
GRANT EXECUTE ON FUNCTION t.raises(TEXT,TEXT,TEXT,TEXT) TO anon, authenticated, service_role;

-- Service clients ------------------------------------------------------------------------
SELECT t.raises('a non-admin cannot create a service client', '00000000-0000-0000-0000-0000000000b2', 'authenticated',
  $$SELECT public.create_service_client('Grocery', 'nxsk_abcd1234', repeat('a', 64), ARRAY['events:read'])$$);
SELECT t.raises('anon cannot create a service client', NULL, 'anon',
  $$SELECT public.create_service_client('Grocery', 'nxsk_abcd1234', repeat('a', 64), ARRAY['events:read'])$$);
SELECT t.raises('an unknown scope is refused', '00000000-0000-0000-0000-0000000000b1', 'authenticated',
  $$SELECT public.create_service_client('Grocery', 'nxsk_abcd1234', repeat('a', 64), ARRAY['admin:everything'])$$);
SELECT t.raises('a malformed key hash is refused', '00000000-0000-0000-0000-0000000000b1', 'authenticated',
  $$SELECT public.create_service_client('Grocery', 'nxsk_abcd1234', 'not-a-hash', ARRAY['events:read'])$$);

SELECT t.act('00000000-0000-0000-0000-0000000000b1', 'authenticated');
SELECT public.create_service_client('Grocery (P2)', 'nxsk_abcd1234', repeat('a', 64), ARRAY['events:read', 'reference:read']) AS id \gset
RESET ROLE;
INSERT INTO t.results SELECT 'an admin can create a service client and it is audited',
  EXISTS (SELECT 1 FROM service_clients WHERE id = :'id' AND is_active)
  AND EXISTS (SELECT 1 FROM audit_logs WHERE action = 'service_client.created' AND entity_id = :'id');
INSERT INTO t.results SELECT 'the audit entry never contains the key hash',
  NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'service_client.created' AND new_state::text LIKE '%' || repeat('a', 64) || '%');

SELECT t.raises('the key hash column is not readable by an admin through the API role', '00000000-0000-0000-0000-0000000000b1', 'authenticated',
  $$SELECT key_hash FROM public.service_clients$$);
SELECT t.act('00000000-0000-0000-0000-0000000000b1', 'authenticated');
INSERT INTO t.results SELECT 'an admin can list clients (safe columns)', (SELECT count(*) = 1 FROM public.service_clients WHERE name = 'Grocery (P2)');
RESET ROLE;
SELECT t.act('00000000-0000-0000-0000-0000000000b2', 'authenticated');
INSERT INTO t.results SELECT 'a non-admin sees no clients', (SELECT count(*) = 0 FROM public.service_clients);
RESET ROLE;
SELECT t.raises('anon cannot read clients', NULL, 'anon', $$SELECT id FROM public.service_clients$$);

SELECT t.raises('an authenticated user cannot verify a key', '00000000-0000-0000-0000-0000000000b2', 'authenticated',
  $$SELECT * FROM public.verify_service_key(repeat('a', 64))$$);
SELECT t.raises('anon cannot verify a key', NULL, 'anon', $$SELECT * FROM public.verify_service_key(repeat('a', 64))$$);
SET LOCAL ROLE service_role;
INSERT INTO t.results SELECT 'the service role can verify a valid key and gets its scopes',
  (SELECT client_name = 'Grocery (P2)' AND scopes = ARRAY['events:read', 'reference:read'] FROM public.verify_service_key(repeat('a', 64)));
INSERT INTO t.results SELECT 'a wrong key verifies to nothing', (SELECT count(*) = 0 FROM public.verify_service_key(repeat('b', 64)));
RESET ROLE;
INSERT INTO t.results SELECT 'verification stamps last_used_at', (SELECT last_used_at IS NOT NULL FROM service_clients WHERE id = :'id');

SELECT t.raises('a non-admin cannot revoke a client', '00000000-0000-0000-0000-0000000000b2', 'authenticated',
  $$SELECT public.revoke_service_client((SELECT id FROM public.service_clients LIMIT 1))$$);
SELECT t.act('00000000-0000-0000-0000-0000000000b1', 'authenticated');
SELECT public.revoke_service_client(:'id', 'rotated') AS first_revoke \gset
SELECT public.revoke_service_client(:'id') AS second_revoke \gset
RESET ROLE;
INSERT INTO t.results SELECT 'revoking works, is audited, and is idempotent', :'first_revoke'::boolean AND NOT :'second_revoke'::boolean
  AND EXISTS (SELECT 1 FROM audit_logs WHERE action = 'service_client.revoked' AND entity_id = :'id');
SET LOCAL ROLE service_role;
INSERT INTO t.results SELECT 'a revoked key no longer verifies', (SELECT count(*) = 0 FROM public.verify_service_key(repeat('a', 64)));
RESET ROLE;

-- Outbox: written in the same transaction as the change ---------------------------------------
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone, latitude, longitude)
 SELECT '20000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-0000000000b1','Intfixture Real','MAIN',
        (SELECT id FROM categories WHERE slug = 'kirana'),(SELECT id FROM localities ORDER BY slug LIMIT 1),'addr','+919100000081', 17.25, 80.15;
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT '20000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-0000000000b1','Intfixture Sample','BR1',
        (SELECT id FROM categories WHERE slug = 'salons'),(SELECT id FROM localities ORDER BY slug LIMIT 1),'addr','+919100000082';
INSERT INTO storefronts (id, shop_id, slug, is_published, visibility_status, template_name, is_sample) VALUES
 ('30000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-0000000000b1','intfixture-real', false, 'visible', 'grocery', false),
 ('30000000-0000-0000-0000-0000000000b2','20000000-0000-0000-0000-0000000000b2','intfixture-sample', true, 'visible', 'service_provider', true);

INSERT INTO t.results SELECT 'creating a storefront emits storefront.created with reference data',
  (SELECT payload->>'slug' = 'intfixture-real' AND payload->>'locality_slug' IS NOT NULL AND payload->>'category_slug' = 'kirana'
     FROM event_outbox WHERE event_type = 'storefront.created' AND entity_id = '30000000-0000-0000-0000-0000000000b1');
INSERT INTO t.results SELECT 'development sample storefronts never emit events',
  (SELECT count(*) = 0 FROM event_outbox WHERE entity_id = '30000000-0000-0000-0000-0000000000b2');

UPDATE storefronts SET is_published = true WHERE id = '30000000-0000-0000-0000-0000000000b1';
INSERT INTO t.results SELECT 'publishing emits storefront.published',
  (SELECT count(*) = 1 FROM event_outbox WHERE event_type = 'storefront.published' AND entity_id = '30000000-0000-0000-0000-0000000000b1');
UPDATE storefronts SET visibility_status = 'hidden', visibility_reason = 'test' WHERE id = '30000000-0000-0000-0000-0000000000b1';
INSERT INTO t.results SELECT 'hiding emits storefront.visibility_changed with the previous status',
  (SELECT payload->>'previous_visibility_status' = 'visible' AND payload->>'visibility_status' = 'hidden'
     FROM event_outbox WHERE event_type = 'storefront.visibility_changed' AND entity_id = '30000000-0000-0000-0000-0000000000b1');
UPDATE storefronts SET headline = 'new tagline' WHERE id = '30000000-0000-0000-0000-0000000000b1';
INSERT INTO t.results SELECT 'an unrelated edit emits nothing (no noise)',
  (SELECT count(*) = 3 FROM event_outbox WHERE entity_id = '30000000-0000-0000-0000-0000000000b1');
UPDATE shops SET latitude = 17.3 WHERE id = '20000000-0000-0000-0000-0000000000b1';
INSERT INTO t.results SELECT 'a location change emits shop.updated listing what changed',
  (SELECT payload->'changed' ? 'location' FROM event_outbox WHERE event_type = 'shop.updated' AND entity_id = '20000000-0000-0000-0000-0000000000b1');
INSERT INTO t.results SELECT 'no event payload contains a phone number or other contact detail',
  NOT EXISTS (SELECT 1 FROM event_outbox WHERE payload::text ~ '(\+91|phone|whatsapp|email)');
INSERT INTO t.results SELECT 'every event has a unique id and increasing sequence',
  (SELECT count(DISTINCT event_id) = count(*) AND bool_and(seq > 0) FROM event_outbox);

SELECT t.raises('the outbox is append-only (update refused)', NULL, 'service_role', $$UPDATE public.event_outbox SET payload = '{}'$$);
SELECT t.raises('the outbox is append-only (delete refused)', NULL, 'service_role', $$DELETE FROM public.event_outbox$$);
SELECT t.raises('anon cannot read the outbox', NULL, 'anon', $$SELECT * FROM public.event_outbox$$);
SELECT t.raises('an authenticated user cannot read the outbox', '00000000-0000-0000-0000-0000000000b2', 'authenticated', $$SELECT * FROM public.event_outbox$$);
SELECT t.raises('an authenticated user cannot emit events', '00000000-0000-0000-0000-0000000000b2', 'authenticated',
  $$SELECT public.emit_event('storefront.published', 'storefront', gen_random_uuid(), '{}')$$);
SELECT t.raises('anon cannot call events_since', NULL, 'anon', $$SELECT * FROM public.events_since(0, 10)$$);

-- Consumers only see events whose transaction has finished. Everything above was written in this
-- still-open transaction, so it must be held back; an event from a finished transaction is released.
SET LOCAL ROLE service_role;
INSERT INTO t.results SELECT 'events from an unfinished transaction are held back from consumers',
  (SELECT count(*) = 0 FROM public.events_since(0, 500) WHERE entity_id IN ('30000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-0000000000b1'));
RESET ROLE;
INSERT INTO event_outbox (event_type, entity_type, entity_id, payload, xid)
  VALUES ('storefront.published', 'storefront', '30000000-0000-0000-0000-0000000000f1', '{"slug":"finished-txn"}', '1'::xid8),
         ('storefront.published', 'storefront', '30000000-0000-0000-0000-0000000000f2', '{"slug":"finished-txn-2"}', '1'::xid8);
SET LOCAL ROLE service_role;
INSERT INTO t.results SELECT 'events from finished transactions are released in sequence order',
  (SELECT string_agg(payload->>'slug', ',' ORDER BY seq) = 'finished-txn,finished-txn-2' FROM public.events_since(0, 500));
INSERT INTO t.results SELECT 'the cursor excludes events at or before it',
  (SELECT count(*) = 1 FROM public.events_since((SELECT min(seq) FROM public.event_outbox WHERE payload->>'slug' = 'finished-txn'), 500));
INSERT INTO t.results SELECT 'the page size is capped', (SELECT count(*) <= 500 FROM public.events_since(0, 100000));
RESET ROLE;

-- Versioned payloads and retention (migration 019) ----------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO t.results SELECT 'every event carries a schema version (existing events are version 1)',
  (SELECT count(*) > 0 AND bool_and(schema_version = 1) FROM public.events_since(0, 500));
RESET ROLE;
DO $$
BEGIN
  INSERT INTO event_outbox (event_type, entity_type, entity_id, payload, schema_version)
  VALUES ('storefront.published', 'storefront', gen_random_uuid(), '{}', 0);
  INSERT INTO t.results VALUES ('a schema version below 1 is refused by the table', false);
EXCEPTION WHEN check_violation THEN
  INSERT INTO t.results VALUES ('a schema version below 1 is refused by the table', true);
END $$;

INSERT INTO event_outbox (event_type, entity_type, entity_id, payload, xid, created_at) VALUES
  ('storefront.published', 'storefront', '30000000-0000-0000-0000-0000000000a1', '{"slug":"old-40d"}', '1'::xid8, NOW() - INTERVAL '40 days'),
  ('storefront.published', 'storefront', '30000000-0000-0000-0000-0000000000a2', '{"slug":"old-10d"}', '1'::xid8, NOW() - INTERVAL '10 days'),
  ('storefront.published', 'storefront', '30000000-0000-0000-0000-0000000000a3', '{"slug":"old-3d"}',  '1'::xid8, NOW() - INTERVAL '3 days');
SELECT t.raises('an authenticated user cannot purge the outbox', '00000000-0000-0000-0000-0000000000b2', 'authenticated', $$SELECT public.purge_event_outbox(30)$$);
SELECT t.raises('anon cannot purge the outbox', NULL, 'anon', $$SELECT public.purge_event_outbox(30)$$);
SELECT t.raises('an authenticated user cannot read the purge marker', '00000000-0000-0000-0000-0000000000b2', 'authenticated', $$SELECT public.event_outbox_purged_through()$$);
SELECT t.raises('a request role cannot get round the guard by setting the flag itself', NULL, 'service_role',
  $$SELECT set_config('nationx.outbox_purge', 'on', true); DELETE FROM public.event_outbox$$);
INSERT INTO t.results SELECT 'nothing has been purged yet', (SELECT count(*) = 3 FROM event_outbox WHERE payload->>'slug' LIKE 'old-%');

SET LOCAL ROLE service_role;
SELECT public.purge_event_outbox(30) AS purged_30 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'purging at 30 days removes only the 40-day-old event', :purged_30 = 1
  AND NOT EXISTS (SELECT 1 FROM event_outbox WHERE payload->>'slug' = 'old-40d')
  AND (SELECT count(*) = 2 FROM event_outbox WHERE payload->>'slug' IN ('old-10d','old-3d'));
INSERT INTO t.results SELECT 'recent events are untouched by a purge', (SELECT count(*) > 0 FROM event_outbox WHERE payload->>'slug' = 'finished-txn');
INSERT INTO t.results SELECT 'the purge is audited with the count', (SELECT count(*) = 1 FROM audit_logs WHERE action = 'event_outbox.purged' AND (new_state->>'removed')::int = 1);
SET LOCAL ROLE service_role;
INSERT INTO t.results SELECT 'the purge marker records how far events were removed', (SELECT public.event_outbox_purged_through() > 0);
SELECT public.purge_event_outbox(1) AS purged_floor \gset
RESET ROLE;
INSERT INTO t.results SELECT 'a request to keep less than 7 days is raised to 7 (the 10-day event goes, the 3-day event stays)', :purged_floor = 1
  AND NOT EXISTS (SELECT 1 FROM event_outbox WHERE payload->>'slug' = 'old-10d')
  AND EXISTS (SELECT 1 FROM event_outbox WHERE payload->>'slug' = 'old-3d');
SET LOCAL ROLE service_role;
SELECT public.purge_event_outbox(30) AS purged_again \gset
RESET ROLE;
INSERT INTO t.results SELECT 'purging again with nothing old is a no-op that writes no audit row', :purged_again = 0
  AND (SELECT count(*) = 2 FROM audit_logs WHERE action = 'event_outbox.purged');
SELECT t.raises('direct deletes are still refused after a purge', NULL, 'service_role', $$DELETE FROM public.event_outbox$$);

-- Shop references ------------------------------------------------------------------------
UPDATE storefronts SET visibility_status = 'visible', visibility_reason = NULL WHERE id = '30000000-0000-0000-0000-0000000000b1';
SELECT t.raises('anon cannot read shop references', NULL, 'anon', $$SELECT * FROM public.integration_shops()$$);
SELECT t.raises('an authenticated user cannot read shop references', '00000000-0000-0000-0000-0000000000b2', 'authenticated', $$SELECT * FROM public.integration_shops()$$);
SET LOCAL ROLE service_role;
INSERT INTO t.results SELECT 'shop references include live shops with location and category',
  (SELECT latitude IS NOT NULL AND category_slug = 'kirana' AND slug = 'intfixture-real' AND NOT ordering_enabled
     FROM public.integration_shops(NULL, 200) WHERE name = 'Intfixture Real');
INSERT INTO t.results SELECT 'development sample shops are never included',
  (SELECT count(*) = 0 FROM public.integration_shops(NULL, 200) WHERE name = 'Intfixture Sample');
INSERT INTO t.results SELECT 'a single shop can be fetched by id',
  (SELECT count(*) = 1 FROM public.integration_shops(NULL, 1, NULL, '20000000-0000-0000-0000-0000000000b1'));
INSERT INTO t.results SELECT 'keyset pagination returns the next page strictly after the cursor',
  (SELECT count(*) = 0 FROM public.integration_shops('ffffffff-ffff-ffff-ffff-ffffffffffff', 50));
RESET ROLE;
UPDATE storefronts SET visibility_status = 'hidden', visibility_reason = 'x' WHERE id = '30000000-0000-0000-0000-0000000000b1';
SET LOCAL ROLE service_role;
INSERT INTO t.results SELECT 'a hidden storefront disappears from shop references',
  (SELECT count(*) = 0 FROM public.integration_shops(NULL, 200) WHERE name = 'Intfixture Real');
RESET ROLE;

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN RAISE EXCEPTION 'integration platform tests failed'; END IF; END $$;
ROLLBACK;
