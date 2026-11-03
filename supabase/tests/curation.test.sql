-- Behavioural tests for migration 014 (homepage curation). Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000e1','adm@example.test','{"full_name":"Adm","phone":"+919000000041"}'),
 ('00000000-0000-0000-0000-0000000000e2','own@example.test','{"full_name":"Own","phone":"+919000000042"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000e1','admin');
INSERT INTO businesses (id, name, primary_owner_id) VALUES ('10000000-0000-0000-0000-0000000000e1','Cur Biz','00000000-0000-0000-0000-0000000000e2');
INSERT INTO business_members (business_id, user_id, role) VALUES ('10000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2','owner');
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT x.id::uuid,'10000000-0000-0000-0000-0000000000e1',x.name,x.code,(SELECT id FROM categories WHERE slug='kirana'),(SELECT id FROM localities ORDER BY slug LIMIT 1),'addr',x.phone
 FROM (VALUES ('20000000-0000-0000-0000-0000000000e1','Curfixture One','C1','+919100000041'),('20000000-0000-0000-0000-0000000000e2','Curfixture Two','C2','+919100000042')) AS x(id,name,code,phone);
INSERT INTO storefronts (id, shop_id, slug, is_published, visibility_status, template_name) VALUES
 ('30000000-0000-0000-0000-0000000000e1','20000000-0000-0000-0000-0000000000e1','curfixture-one', true, 'visible', 'grocery'),
 ('30000000-0000-0000-0000-0000000000e2','20000000-0000-0000-0000-0000000000e2','curfixture-two', true, 'visible', 'grocery');

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

SELECT t.raises('a merchant cannot create a banner', '00000000-0000-0000-0000-0000000000e2', 'authenticated', $$INSERT INTO homepage_banners (title) VALUES ('Spam banner')$$);
SELECT t.raises('anon cannot create a banner', NULL, 'anon', $$INSERT INTO homepage_banners (title) VALUES ('Spam banner')$$);
SELECT t.raises('a merchant cannot feature a shop', '00000000-0000-0000-0000-0000000000e2', 'authenticated', $$INSERT INTO featured_storefronts (storefront_id) VALUES ('30000000-0000-0000-0000-0000000000e2')$$);
SELECT t.raises('a javascript: banner link is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$INSERT INTO homepage_banners (title, link_url) VALUES ('Bad link', 'javascript:alert(1)')$$);
SELECT t.raises('a plain http banner link is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$INSERT INTO homepage_banners (title, link_url) VALUES ('Bad link', 'http://example.test')$$);
SELECT t.act('00000000-0000-0000-0000-0000000000e1', 'authenticated');
INSERT INTO homepage_banners (title, body, link_url, display_order) VALUES ('Welcome to NationX', 'Local shops near you', '/explore', 1), ('Hidden one', NULL, NULL, 2);
UPDATE homepage_banners SET is_active = false WHERE title = 'Hidden one';
INSERT INTO homepage_banners (title, starts_at) VALUES ('Starts tomorrow', NOW() + INTERVAL '1 day');
INSERT INTO homepage_banners (title, ends_at) VALUES ('Already over', NOW() - INTERVAL '1 day');
INSERT INTO featured_storefronts (storefront_id, position) VALUES ('30000000-0000-0000-0000-0000000000e2', 1), ('30000000-0000-0000-0000-0000000000e1', 2);
RESET ROLE;
SELECT t.raises('featuring the same shop twice in the same scope is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$INSERT INTO featured_storefronts (storefront_id) VALUES ('30000000-0000-0000-0000-0000000000e2')$$);
SET LOCAL ROLE anon;
INSERT INTO t.results SELECT 'the public sees only active banners inside their date window', (SELECT array_agg(title) = ARRAY['Welcome to NationX'] FROM homepage_banners);
INSERT INTO t.results SELECT 'the public can read the featured list', (SELECT count(*) = 2 FROM featured_storefronts);
INSERT INTO t.results SELECT 'search can be limited to a list of storefront ids',
  (SELECT count(*) = 1 AND bool_and(shop_name = 'Curfixture Two') FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 12, 0, NULL, NULL, ARRAY['30000000-0000-0000-0000-0000000000e2']::uuid[]));
INSERT INTO t.results SELECT 'without ids search is unchanged', (SELECT count(*) >= 2 FROM search_storefronts('Curfixture'));
RESET ROLE;
UPDATE storefronts SET visibility_status = 'hidden', visibility_reason = 'x' WHERE id = '30000000-0000-0000-0000-0000000000e2';
SET LOCAL ROLE anon;
INSERT INTO t.results SELECT 'a hidden shop disappears from the id-limited search even while featured',
  (SELECT count(*) = 0 FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 12, 0, NULL, NULL, ARRAY['30000000-0000-0000-0000-0000000000e2']::uuid[]));
RESET ROLE;

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN RAISE EXCEPTION 'curation tests failed'; END IF; END $$;
ROLLBACK;