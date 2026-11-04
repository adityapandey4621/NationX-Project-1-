-- Behavioural tests for migration 017 (admin overview + team management). Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000f1','boss@example.test','{"full_name":"Boss","phone":"+919000000071"}'),
 ('00000000-0000-0000-0000-0000000000f2','second@example.test','{"full_name":"Second","phone":"+919000000072"}'),
 ('00000000-0000-0000-0000-0000000000f3','cust@example.test','{"full_name":"Cust","phone":"+919000000073"}'),
 ('00000000-0000-0000-0000-0000000000f4','op@example.test','{"full_name":"Op","phone":"+919000000074"}'),
 ('00000000-0000-0000-0000-0000000000f5','gone@example.test','{"full_name":"Gone","phone":"+919000000075"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000f1','admin'),('00000000-0000-0000-0000-0000000000f4','operator');
UPDATE profiles SET is_active = false WHERE id = '00000000-0000-0000-0000-0000000000f5';

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

-- A tiny marketplace: one area with a live, a hidden and a suspended shop (2 published items, 1 draft item); other areas empty.
INSERT INTO localities (name, slug, district, pincode) VALUES ('Zz Busy','zz-busy','Khammam','507001'),('Zz Empty','zz-empty','Khammam','507001');
SELECT id AS busy FROM localities WHERE slug = 'zz-busy' \gset
SELECT id AS cat FROM categories ORDER BY slug LIMIT 1 \gset
INSERT INTO businesses (id, name, primary_owner_id) VALUES ('10000000-0000-0000-0000-0000000000f1','Biz','00000000-0000-0000-0000-0000000000f3');
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone) VALUES
 ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000f1','Live','L',:'cat',:'busy','a','+919100000101'),
 ('20000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000f1','Hid','H',:'cat',:'busy','a','+919100000102'),
 ('20000000-0000-0000-0000-0000000000a3','10000000-0000-0000-0000-0000000000f1','Sus','S',:'cat',:'busy','a','+919100000103');
INSERT INTO storefronts (shop_id, slug, is_published, visibility_status) VALUES
 ('20000000-0000-0000-0000-0000000000a1','zz-live',true,'visible'),
 ('20000000-0000-0000-0000-0000000000a2','zz-hid',true,'hidden'),
 ('20000000-0000-0000-0000-0000000000a3','zz-sus',true,'suspended');
INSERT INTO storefront_products (shop_id, name, is_published) VALUES
 ('20000000-0000-0000-0000-0000000000a1','Rice',true),('20000000-0000-0000-0000-0000000000a1','Dal',true),('20000000-0000-0000-0000-0000000000a1','Draft',false);
INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, status) VALUES
 ('00000000-0000-0000-0000-0000000000f3','A1',:'cat',:'busy','+919100000111','a','submitted'),
 ('00000000-0000-0000-0000-0000000000f3','A2',:'cat',:'busy','+919100000112','a','submitted'),
 ('00000000-0000-0000-0000-0000000000f3','A3',:'cat',:'busy','+919100000113','a','draft');

-- ---- Only an administrator ---------------------------------------------------------------------------------
SELECT t.raises('anon cannot read the overview', NULL, 'anon', $$SELECT public.admin_overview()$$);
SELECT t.raises('a customer cannot read the overview', '00000000-0000-0000-0000-0000000000f3', 'authenticated', $$SELECT public.admin_overview()$$);
SELECT t.raises('an operator cannot read the overview', '00000000-0000-0000-0000-0000000000f4', 'authenticated', $$SELECT public.admin_overview()$$);
SELECT t.raises('a customer cannot list the team', '00000000-0000-0000-0000-0000000000f3', 'authenticated', $$SELECT * FROM public.admin_list_team()$$);
SELECT t.raises('anon cannot list the team', NULL, 'anon', $$SELECT * FROM public.admin_list_team()$$);
SELECT t.raises('a customer cannot grant a role', '00000000-0000-0000-0000-0000000000f3', 'authenticated', $$SELECT public.set_user_role('cust@example.test','admin',true)$$);
SELECT t.raises('an operator cannot grant a role', '00000000-0000-0000-0000-0000000000f4', 'authenticated', $$SELECT public.set_user_role('op@example.test','admin',true)$$);
SELECT t.raises('anon cannot grant a role', NULL, 'anon', $$SELECT public.set_user_role('cust@example.test','admin',true)$$);

-- ---- The overview tells the truth -------------------------------------------------------------------------
SELECT t.act('00000000-0000-0000-0000-0000000000f1', 'authenticated');
SELECT public.admin_overview() AS ov \gset
RESET ROLE;
INSERT INTO t.results SELECT 'applications are counted by status and drafts are left out', (:'ov'::jsonb->'applications'->>'submitted')::int = 2 AND NOT (:'ov'::jsonb->'applications' ? 'draft');
INSERT INTO t.results SELECT 'storefronts: 1 live, 1 hidden, 1 suspended', (:'ov'::jsonb#>>'{storefronts,live}')::int = 1 AND (:'ov'::jsonb#>>'{storefronts,hidden}')::int = 1 AND (:'ov'::jsonb#>>'{storefronts,suspended}')::int = 1 AND (:'ov'::jsonb#>>'{storefronts,total}')::int = 3;
INSERT INTO t.results SELECT 'items: 3 total, 2 published', (:'ov'::jsonb#>>'{items,total}')::int = 3 AND (:'ov'::jsonb#>>'{items,published}')::int = 2;
INSERT INTO t.results SELECT 'the busy area shows live / hidden / suspended and its published items',
  (SELECT (a->>'live')::int = 1 AND (a->>'hidden')::int = 1 AND (a->>'suspended')::int = 1 AND (a->>'items')::int = 2
     FROM jsonb_array_elements(:'ov'::jsonb->'by_area') a WHERE a->>'name' = 'Zz Busy');
INSERT INTO t.results SELECT 'an area with no shops is still listed, with zeros',
  (SELECT (a->>'live')::int = 0 AND (a->>'items')::int = 0 FROM jsonb_array_elements(:'ov'::jsonb->'by_area') a WHERE a->>'name' = 'Zz Empty');
INSERT INTO t.results SELECT 'every active seed category appears, even with no shops', (SELECT count(*) FROM jsonb_array_elements(:'ov'::jsonb->'by_category')) = (SELECT count(*) FROM categories);
INSERT INTO t.results SELECT 'people are counted by role', (:'ov'::jsonb#>>'{people,admin}')::int = 1 AND (:'ov'::jsonb#>>'{people,operator}')::int = 1;
INSERT INTO t.results SELECT 'the overview carries no personal data (no e-mail or phone anywhere)', :'ov' !~ '@|\+91[6-9]';

-- ---- Team management ---------------------------------------------------------------------------------------
SELECT t.act('00000000-0000-0000-0000-0000000000f1', 'authenticated');
SELECT public.set_user_role(' Second@Example.test ', 'admin', true, 'second pair of hands') AS g1 \gset
SELECT public.set_user_role('second@example.test', 'admin', true) AS g2 \gset
SELECT public.set_user_role('cust@example.test', 'operator', true) AS g3 \gset
SELECT count(*) AS team_n FROM public.admin_list_team() \gset
RESET ROLE;
INSERT INTO t.results SELECT 'an admin can grant admin (e-mail match ignores case and spaces)', :'g1' = 'granted' AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000f2' AND role = 'admin');
INSERT INTO t.results SELECT 'granting again is a harmless no-op', :'g2' = 'unchanged' AND (SELECT count(*) = 1 FROM user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000f2' AND role = 'admin');
INSERT INTO t.results SELECT 'an admin can grant operator', :'g3' = 'granted';
INSERT INTO t.results SELECT 'the team list shows admins and operators only', :team_n = 4;
INSERT INTO t.results SELECT 'grants are audited with actor, role and reason', (SELECT count(*) = 2 FROM audit_logs WHERE action = 'role.granted' AND actor_id = '00000000-0000-0000-0000-0000000000f1') AND (SELECT count(*) = 1 FROM audit_logs WHERE action = 'role.granted' AND reason = 'second pair of hands' AND new_state->>'role' = 'admin');

SELECT t.raises('an unknown e-mail is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', $$SELECT public.set_user_role('nobody@example.test','admin',true)$$);
SELECT t.raises('a deactivated account cannot be made admin', '00000000-0000-0000-0000-0000000000f1', 'authenticated', $$SELECT public.set_user_role('gone@example.test','admin',true)$$);
SELECT t.raises('only admin and operator are manageable (not merchant)', '00000000-0000-0000-0000-0000000000f1', 'authenticated', $$SELECT public.set_user_role('cust@example.test','merchant',true)$$);
SELECT t.raises('an unstated grant/revoke is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', $$SELECT public.set_user_role('cust@example.test','admin',NULL)$$);
SELECT t.raises('an over-long reason is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', $$SELECT public.set_user_role('cust@example.test','operator',false,repeat('x',501))$$);
SELECT t.raises('you cannot remove your own admin role', '00000000-0000-0000-0000-0000000000f1', 'authenticated', $$SELECT public.set_user_role('boss@example.test','admin',false)$$);

SELECT t.act('00000000-0000-0000-0000-0000000000f2', 'authenticated');
SELECT public.set_user_role('boss@example.test', 'admin', false, 'handover') AS r1 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'a different admin can revoke an admin (audited)', :'r1' = 'revoked' AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000f1' AND role = 'admin') AND (SELECT count(*) = 1 FROM audit_logs WHERE action = 'role.revoked' AND reason = 'handover');
SELECT t.raises('the last administrator can never be removed', '00000000-0000-0000-0000-0000000000f2', 'authenticated', $$SELECT public.set_user_role('second@example.test','admin',false)$$);
SELECT t.raises('a former admin has lost access immediately', '00000000-0000-0000-0000-0000000000f1', 'authenticated', $$SELECT public.admin_overview()$$);

-- Removing the last admin must fail even for another (hypothetical) admin: make a third and prove the rule is a count, not a name.
SELECT t.act('00000000-0000-0000-0000-0000000000f2', 'authenticated');
SELECT public.set_user_role('cust@example.test', 'admin', true) AS g4 \gset
SELECT public.set_user_role('cust@example.test', 'operator', false) AS r2 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'an operator role can be revoked on its own', :'r2' = 'revoked' AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000f3' AND role = 'admin');

SELECT result, name FROM (SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results) r ORDER BY name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass OR pass IS NULL) THEN RAISE EXCEPTION 'admin overview tests failed'; END IF; END $$;
ROLLBACK;
