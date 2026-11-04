-- Behavioural tests for migration 013 (area waitlist). Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000d1','adm@example.test','{"full_name":"Adm","phone":"+919000000051"}'),
 ('00000000-0000-0000-0000-0000000000d2','op@example.test','{"full_name":"Op","phone":"+919000000052"}'),
 ('00000000-0000-0000-0000-0000000000d3','cust@example.test','{"full_name":"Cust","phone":"+919000000053"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000d1','admin'),('00000000-0000-0000-0000-0000000000d2','operator');

CREATE FUNCTION t.act(uid TEXT, r TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', coalesce(uid,''), true); EXECUTE format('SET LOCAL ROLE %I', r); END $$;
GRANT EXECUTE ON FUNCTION t.act(TEXT,TEXT) TO anon, authenticated, service_role;
CREATE FUNCTION t.raises(name TEXT, uid TEXT, r TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN;
BEGIN
  BEGIN PERFORM t.act(uid, r); EXECUTE stmt; RESET ROLE; ok := false;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; ok := true; END;
  INSERT INTO t.results VALUES (name, ok);
END $$;
GRANT EXECUTE ON FUNCTION t.raises(TEXT,TEXT,TEXT,TEXT) TO anon, authenticated, service_role;

INSERT INTO localities (name, slug, district, pincode) VALUES ('Zz Wl A','zz-wl-a','Khammam','507001'),('Zz Wl B','zz-wl-b','Khammam','507001'),('Zz Wl C','zz-wl-c','Khammam','507001'),('Zz Wl D','zz-wl-d','Khammam','507001'),('Zz Wl E','zz-wl-e','Khammam','507001'),('Zz Wl F','zz-wl-f','Khammam','507001');
SELECT id AS loc FROM localities WHERE slug = 'zz-wl-a' \gset
SELECT id AS cat FROM categories WHERE slug = 'kirana' \gset

SET LOCAL ROLE anon;
SELECT public.join_area_waitlist(:'loc', :'cat', '+919811111111', ' Ravi ', true) AS j1 \gset
SELECT public.join_area_waitlist(:'loc', NULL, '+919811111111', 'Ravi', true) AS j2 \gset
SELECT public.join_area_waitlist(:'loc', NULL, '+919822222222', NULL, true) AS j3 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'an anonymous visitor can join with consent', :'j1' = 'joined';
INSERT INTO t.results SELECT 'joining twice is idempotent and does not duplicate', :'j2' = 'already_waiting' AND (SELECT count(*) = 1 FROM area_waitlist WHERE contact_phone = '+919811111111');
INSERT INTO t.results SELECT 'the name is trimmed and optional', (SELECT contact_name = 'Ravi' FROM area_waitlist WHERE contact_phone = '+919811111111') AND (SELECT contact_name IS NULL FROM area_waitlist WHERE contact_phone = '+919822222222');
INSERT INTO t.results SELECT 'consent is recorded with a timestamp', (SELECT bool_and(consent_given AND consented_at IS NOT NULL) FROM area_waitlist);

SELECT t.raises('joining without consent is refused', NULL, 'anon', format($$SELECT public.join_area_waitlist(%L, NULL, '+919833333333', 'x', false)$$, :'loc'));
SELECT t.raises('a NULL consent is refused', NULL, 'anon', format($$SELECT public.join_area_waitlist(%L, NULL, '+919833333333', 'x', NULL)$$, :'loc'));
SELECT t.raises('a malformed phone is refused', NULL, 'anon', format($$SELECT public.join_area_waitlist(%L, NULL, '12345', 'x', true)$$, :'loc'));
SELECT t.raises('a non-Indian-mobile phone is refused', NULL, 'anon', format($$SELECT public.join_area_waitlist(%L, NULL, '+911234567890', 'x', true)$$, :'loc'));
SELECT t.raises('an unknown area is refused', NULL, 'anon', $$SELECT public.join_area_waitlist(gen_random_uuid(), NULL, '+919844444444', 'x', true)$$);
SELECT t.raises('an unknown category is refused', NULL, 'anon', format($$SELECT public.join_area_waitlist(%L, gen_random_uuid(), '+919844444444', 'x', true)$$, :'loc'));
SELECT t.raises('an over-long name is refused', NULL, 'anon', format($$SELECT public.join_area_waitlist(%L, NULL, '+919844444444', repeat('x', 121), true)$$, :'loc'));

-- One number can be on at most 5 area lists (the lock-then-count pattern).
INSERT INTO area_waitlist (locality_id, contact_phone, consent_given)
  SELECT id, '+919855555555', true FROM localities WHERE slug IN ('zz-wl-b','zz-wl-c','zz-wl-d','zz-wl-e');
INSERT INTO t.results SELECT 'a number may be on up to 5 lists', (SELECT count(*) = 4 FROM area_waitlist WHERE contact_phone = '+919855555555');
SET LOCAL ROLE anon;
SELECT public.join_area_waitlist(:'loc', NULL, '+919855555555', NULL, true) AS j5 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the 5th list is allowed', :'j5' = 'joined';
SELECT t.raises('a 6th list for the same number is refused', NULL, 'anon', format($$SELECT public.join_area_waitlist(%L, NULL, '+919855555555', NULL, true)$$, (SELECT id FROM localities WHERE slug = 'zz-wl-f')));

-- Reading: staff only; the public sees aggregate counts only.
SELECT t.raises('anon cannot read the waitlist', NULL, 'anon', $$SELECT * FROM public.area_waitlist$$);
SELECT t.act('00000000-0000-0000-0000-0000000000d3', 'authenticated');
INSERT INTO t.results SELECT 'a customer sees no waitlist rows (row-level security)', (SELECT count(*) = 0 FROM public.area_waitlist);
RESET ROLE;
SELECT t.raises('anon cannot write the table directly', NULL, 'anon', format($$INSERT INTO public.area_waitlist (locality_id, contact_phone, consent_given) VALUES (%L, '+919866666666', true)$$, :'loc'));
SELECT t.raises('a customer cannot write the table directly', '00000000-0000-0000-0000-0000000000d3', 'authenticated', format($$INSERT INTO public.area_waitlist (locality_id, contact_phone, consent_given) VALUES (%L, '+919866666666', true)$$, :'loc'));
SELECT t.act('00000000-0000-0000-0000-0000000000d1', 'authenticated');
INSERT INTO t.results SELECT 'an admin can read the waitlist', (SELECT count(*) >= 3 FROM public.area_waitlist);
RESET ROLE;
SELECT t.act('00000000-0000-0000-0000-0000000000d2', 'authenticated');
INSERT INTO t.results SELECT 'an operator can read the waitlist', (SELECT count(*) >= 3 FROM public.area_waitlist);
RESET ROLE;
SET LOCAL ROLE anon;
INSERT INTO t.results SELECT 'public demand counts are aggregate, per area, and exclude contacted people',
  (SELECT waiting >= 2 FROM public.waitlist_demand() WHERE locality_slug = (SELECT slug FROM localities WHERE id = :'loc'));
RESET ROLE;

-- Staff status changes.
SELECT id AS wid FROM area_waitlist WHERE contact_phone = '+919811111111' \gset
SELECT t.raises('a customer cannot mark someone contacted', '00000000-0000-0000-0000-0000000000d3', 'authenticated', format($$SELECT public.set_waitlist_status(%L, 'contacted')$$, :'wid'));
SELECT t.raises('anon cannot mark someone contacted', NULL, 'anon', format($$SELECT public.set_waitlist_status(%L, 'contacted')$$, :'wid'));
SELECT t.act('00000000-0000-0000-0000-0000000000d2', 'authenticated');
SELECT public.set_waitlist_status(:'wid', 'contacted') AS s1 \gset
SELECT public.set_waitlist_status(:'wid', 'contacted') AS s2 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'an operator marks contacted once; repeating is a no-op and is audited once',
  :'s1'::boolean AND NOT :'s2'::boolean AND (SELECT count(*) = 1 FROM audit_logs WHERE action = 'waitlist.contacted' AND entity_id = :'wid')
  AND (SELECT contacted_at IS NOT NULL FROM area_waitlist WHERE id = :'wid');
SELECT count(*) AS expected_waiting FROM area_waitlist WHERE locality_id = :'loc' AND status = 'waiting' \gset
SET LOCAL ROLE anon;
INSERT INTO t.results SELECT 'contacted people no longer count as waiting',
  (SELECT waiting = :expected_waiting FROM public.waitlist_demand() WHERE locality_slug = (SELECT slug FROM localities WHERE id = :'loc'));
RESET ROLE;

-- Withdrawing consent deletes the row, phone included.
SET LOCAL ROLE anon;
SELECT public.leave_area_waitlist(:'loc', '+919811111111') AS l1 \gset
SELECT public.leave_area_waitlist(:'loc', '+919811111111') AS l2 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'leaving deletes the entry and the phone number; leaving again reports nothing to remove',
  :'l1'::boolean AND NOT :'l2'::boolean AND (SELECT count(*) = 0 FROM area_waitlist WHERE contact_phone = '+919811111111');
SELECT t.raises('leaving with a malformed phone is refused', NULL, 'anon', format($$SELECT public.leave_area_waitlist(%L, 'nope')$$, :'loc'));

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN RAISE EXCEPTION 'waitlist tests failed'; END IF; END $$;
ROLLBACK;