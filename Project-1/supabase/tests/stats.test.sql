-- Behavioural tests for migration 012 (storefront stats). Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000c1','owner@example.test','{"full_name":"Owner","phone":"+919000000061"}'),
 ('00000000-0000-0000-0000-0000000000c2','other@example.test','{"full_name":"Other","phone":"+919000000062"}'),
 ('00000000-0000-0000-0000-0000000000c3','adm@example.test','{"full_name":"Adm","phone":"+919000000063"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c3','admin');
INSERT INTO businesses (id, name, primary_owner_id) VALUES ('10000000-0000-0000-0000-0000000000c1','Stat Biz','00000000-0000-0000-0000-0000000000c1');
INSERT INTO business_members (business_id, user_id, role) VALUES ('10000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c1','owner');
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT x.id::uuid,'10000000-0000-0000-0000-0000000000c1',x.name,x.code,(SELECT id FROM categories WHERE slug='kirana'),(SELECT id FROM localities ORDER BY slug LIMIT 1),'addr',x.phone
 FROM (VALUES ('20000000-0000-0000-0000-0000000000c1','Statfixture Live','L1','+919100000061'),
              ('20000000-0000-0000-0000-0000000000c2','Statfixture Sample','S1','+919100000062'),
              ('20000000-0000-0000-0000-0000000000c3','Statfixture Hidden','H1','+919100000063')) AS x(id,name,code,phone);
INSERT INTO storefronts (id, shop_id, slug, is_published, visibility_status, template_name, is_sample) VALUES
 ('30000000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-0000000000c1','statfixture-live', true, 'visible', 'grocery', false),
 ('30000000-0000-0000-0000-0000000000c2','20000000-0000-0000-0000-0000000000c2','statfixture-sample', true, 'visible', 'grocery', true),
 ('30000000-0000-0000-0000-0000000000c3','20000000-0000-0000-0000-0000000000c3','statfixture-hidden', true, 'hidden', 'grocery', false);

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

SET LOCAL ROLE anon;
SELECT public.record_storefront_event('statfixture-live', 'view') AS a1 \gset
SELECT public.record_storefront_event('statfixture-live', 'view') AS a2 \gset
SELECT public.record_storefront_event('statfixture-live', 'call') AS a3 \gset
SELECT public.record_storefront_event('statfixture-live', 'whatsapp') AS a4 \gset
SELECT public.record_storefront_event('statfixture-live', 'directions') AS a5 \gset
SELECT public.record_storefront_event('statfixture-sample', 'view') AS s1 \gset
SELECT public.record_storefront_event('statfixture-hidden', 'view') AS s2 \gset
SELECT public.record_storefront_event('no-such-shop', 'view') AS s3 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'anonymous visitors can record views and taps on a live storefront', :'a1'::boolean AND :'a2'::boolean AND :'a3'::boolean AND :'a4'::boolean AND :'a5'::boolean;
INSERT INTO t.results SELECT 'counts accumulate per action in one daily row',
  (SELECT views = 2 AND calls = 1 AND whatsapp = 1 AND directions = 1 FROM storefront_stats_daily WHERE storefront_id = '30000000-0000-0000-0000-0000000000c1')
  AND (SELECT count(*) = 1 FROM storefront_stats_daily WHERE storefront_id = '30000000-0000-0000-0000-0000000000c1');
INSERT INTO t.results SELECT 'the day is an Indian Standard Time day',
  (SELECT day = (now() AT TIME ZONE 'Asia/Kolkata')::date FROM storefront_stats_daily WHERE storefront_id = '30000000-0000-0000-0000-0000000000c1');
INSERT INTO t.results SELECT 'samples, hidden and unknown storefronts record nothing and say nothing about why',
  NOT :'s1'::boolean AND NOT :'s2'::boolean AND NOT :'s3'::boolean
  AND (SELECT count(*) = 0 FROM storefront_stats_daily WHERE storefront_id IN ('30000000-0000-0000-0000-0000000000c2','30000000-0000-0000-0000-0000000000c3'));
SELECT t.raises('an unknown action is refused', NULL, 'anon', $$SELECT public.record_storefront_event('statfixture-live', 'purchase')$$);
SELECT t.raises('anon cannot write the stats table directly', NULL, 'anon', $$UPDATE public.storefront_stats_daily SET views = 99999$$);
SELECT t.raises('an authenticated user cannot write the stats table directly', '00000000-0000-0000-0000-0000000000c1', 'authenticated', $$UPDATE public.storefront_stats_daily SET views = 99999$$);
SELECT t.raises('an owner cannot insert stats rows directly', '00000000-0000-0000-0000-0000000000c1', 'authenticated',
  $$INSERT INTO public.storefront_stats_daily (storefront_id, shop_id, day) VALUES ('30000000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-0000000000c1', current_date - 1)$$);
SELECT t.raises('anon cannot read stats', NULL, 'anon', $$SELECT * FROM public.storefront_stats_daily$$);

SELECT t.act('00000000-0000-0000-0000-0000000000c1', 'authenticated');
INSERT INTO t.results SELECT 'the shop owner can read their own shop''s counts', (SELECT sum(views) = 2 FROM public.storefront_stats_daily WHERE shop_id = '20000000-0000-0000-0000-0000000000c1');
RESET ROLE;
SELECT t.act('00000000-0000-0000-0000-0000000000c2', 'authenticated');
INSERT INTO t.results SELECT 'another merchant cannot read them', (SELECT count(*) = 0 FROM public.storefront_stats_daily);
RESET ROLE;
SELECT t.act('00000000-0000-0000-0000-0000000000c3', 'authenticated');
INSERT INTO t.results SELECT 'an admin can read them', (SELECT count(*) = 1 FROM public.storefront_stats_daily);
RESET ROLE;
INSERT INTO t.results SELECT 'the table holds no visitor identifiers (only counts per storefront and day)',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) = 'storefront_id,shop_id,day,views,calls,whatsapp,directions'
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'storefront_stats_daily');

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN RAISE EXCEPTION 'stats tests failed'; END IF; END $$;
ROLLBACK;