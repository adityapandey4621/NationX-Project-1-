-- Behavioural tests for migration 021: shop notice (REQ-STR-03/05), help-request assignment (REQ-ADM-05),
-- homepage layout (REQ-HOM-07), review snapshot (REQ-ADM-01). Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000a1','boss@example.test','{"full_name":"Boss","phone":"+919000000101"}'),
 ('00000000-0000-0000-0000-0000000000a2','cust@example.test','{"full_name":"Cust","phone":"+919000000102"}'),
 ('00000000-0000-0000-0000-0000000000a3','op@example.test','{"full_name":"Op One","phone":"+919000000103"}'),
 ('00000000-0000-0000-0000-0000000000a4','owner@example.test','{"full_name":"Owner","phone":"+919000000104"}'),
 ('00000000-0000-0000-0000-0000000000a5','gone@example.test','{"full_name":"Gone Op","phone":"+919000000105"}'),
 ('00000000-0000-0000-0000-0000000000a6','stranger@example.test','{"full_name":"Stranger","phone":"+919000000106"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1','admin'),('00000000-0000-0000-0000-0000000000a3','operator'),('00000000-0000-0000-0000-0000000000a5','operator');
UPDATE profiles SET is_active = false WHERE id = '00000000-0000-0000-0000-0000000000a5';

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
CREATE FUNCTION t.allowed(name TEXT, uid TEXT, r TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN;
BEGIN
  BEGIN PERFORM t.act(uid, r); EXECUTE stmt; RESET ROLE; ok := true;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; ok := false; END;
  INSERT INTO t.results VALUES (name, ok);
END $$;
GRANT EXECUTE ON FUNCTION t.allowed(TEXT,TEXT,TEXT,TEXT) TO anon, authenticated, service_role;

SELECT id AS kirana FROM categories WHERE slug = 'kirana' \gset
SELECT id AS loc FROM localities WHERE slug = 'gandhi-chowk' \gset

-- ---- A. Shop notice --------------------------------------------------------------------------------------------
INSERT INTO businesses (id, name, primary_owner_id) VALUES ('10000000-0000-0000-0000-0000000000a1','Notice Biz','00000000-0000-0000-0000-0000000000a4');
INSERT INTO business_members (business_id, user_id, role) VALUES ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a4','owner');
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone) VALUES
 ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','Notice Stores','N',:'kirana',:'loc','1 Main Road','+919100000401');
INSERT INTO storefronts (shop_id, slug, is_published, visibility_status) VALUES ('20000000-0000-0000-0000-0000000000a1','zz-notice-stores',true,'visible');
INSERT INTO t.results SELECT 'a new storefront has no announcement or closure', (SELECT announcement IS NULL AND closure_note IS NULL AND closed_until IS NULL FROM storefronts WHERE slug = 'zz-notice-stores');

SELECT t.allowed('the owner sets an announcement', '00000000-0000-0000-0000-0000000000a4', 'authenticated', $$UPDATE storefronts SET announcement = 'Diwali sale: 10% off staples' WHERE slug = 'zz-notice-stores'$$);
SELECT t.allowed('the owner marks the shop temporarily closed with a note and a date', '00000000-0000-0000-0000-0000000000a4', 'authenticated', $$UPDATE storefronts SET closure_note = 'Closed for family function', closed_until = '2030-01-15' WHERE slug = 'zz-notice-stores'$$);
INSERT INTO t.results SELECT 'the notice fields were really stored', (SELECT announcement = 'Diwali sale: 10% off staples' AND closure_note = 'Closed for family function' AND closed_until = DATE '2030-01-15' FROM storefronts WHERE slug = 'zz-notice-stores');
SELECT t.act(NULL, 'anon');
SELECT count(*) AS n_anon_sees FROM storefronts WHERE slug = 'zz-notice-stores' AND closure_note IS NOT NULL AND announcement IS NOT NULL \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the public can read the notice of a published storefront', :n_anon_sees = 1;
SELECT t.raises('a closing date without a note is refused', '00000000-0000-0000-0000-0000000000a4', 'authenticated', $$UPDATE storefronts SET closure_note = NULL WHERE slug = 'zz-notice-stores'$$);
SELECT t.raises('an empty announcement is refused (clear it with NULL instead)', '00000000-0000-0000-0000-0000000000a4', 'authenticated', $$UPDATE storefronts SET announcement = '   ' WHERE slug = 'zz-notice-stores'$$);
SELECT t.raises('an announcement over 280 characters is refused', '00000000-0000-0000-0000-0000000000a4', 'authenticated', $$UPDATE storefronts SET announcement = repeat('x', 281) WHERE slug = 'zz-notice-stores'$$);
SELECT t.raises('a closure note over 200 characters is refused', '00000000-0000-0000-0000-0000000000a4', 'authenticated', $$UPDATE storefronts SET closure_note = repeat('x', 201) WHERE slug = 'zz-notice-stores'$$);
SELECT t.allowed('the owner reopens by clearing the note and the date together', '00000000-0000-0000-0000-0000000000a4', 'authenticated', $$UPDATE storefronts SET closure_note = NULL, closed_until = NULL WHERE slug = 'zz-notice-stores'$$);
INSERT INTO t.results SELECT 'reopening cleared both fields and kept the announcement', (SELECT closure_note IS NULL AND closed_until IS NULL AND announcement IS NOT NULL FROM storefronts WHERE slug = 'zz-notice-stores');
SELECT t.act('00000000-0000-0000-0000-0000000000a6', 'authenticated');
UPDATE storefronts SET announcement = 'Hijacked' WHERE slug = 'zz-notice-stores';
RESET ROLE;
INSERT INTO t.results SELECT 'someone who is not a member of the shop cannot change its notice', (SELECT announcement = 'Diwali sale: 10% off staples' FROM storefronts WHERE slug = 'zz-notice-stores');
SELECT t.raises('the owner still cannot change platform-controlled fields (slug)', '00000000-0000-0000-0000-0000000000a4', 'authenticated', $$UPDATE storefronts SET slug = 'zz-hijack' WHERE slug = 'zz-notice-stores'$$);

-- ---- B. Assigning help requests ----------------------------------------------------------------------------------
INSERT INTO help_me_find_it_requests (id, tracking_id, item_name, preferred_locality_id, contact_phone, contact_name) VALUES
 ('30000000-0000-0000-0000-0000000000a1','HMF-KHM-209901-0901','Test item',:'loc','+919100000501','Req One'),
 ('30000000-0000-0000-0000-0000000000a2','HMF-KHM-209901-0902','Cancelled item',:'loc','+919100000502','Req Two');
UPDATE help_me_find_it_requests SET status = 'cancelled' WHERE id = '30000000-0000-0000-0000-0000000000a2';
SELECT count(*) AS q_before FROM notification_queue \gset

SELECT t.raises('an operator cannot assign a request', '00000000-0000-0000-0000-0000000000a3', 'authenticated', $$SELECT public.assign_help_request('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3')$$);
SELECT t.raises('a customer cannot assign a request', '00000000-0000-0000-0000-0000000000a2', 'authenticated', $$SELECT public.assign_help_request('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3')$$);
SELECT t.raises('anon cannot assign a request', NULL, 'anon', $$SELECT public.assign_help_request('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3')$$);
SELECT t.raises('a customer cannot list assignable operators', '00000000-0000-0000-0000-0000000000a2', 'authenticated', $$SELECT * FROM public.list_assignable_operators()$$);
SELECT t.raises('anon cannot list assignable operators', NULL, 'anon', $$SELECT * FROM public.list_assignable_operators()$$);
SELECT t.raises('a customer cannot be assigned a request', '00000000-0000-0000-0000-0000000000a1', 'authenticated', $$SELECT public.assign_help_request('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2')$$);
SELECT t.raises('a switched-off operator cannot be assigned a request', '00000000-0000-0000-0000-0000000000a1', 'authenticated', $$SELECT public.assign_help_request('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a5')$$);
SELECT t.raises('an unknown request is refused', '00000000-0000-0000-0000-0000000000a1', 'authenticated', $$SELECT public.assign_help_request(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3')$$);
SELECT t.raises('a cancelled request cannot be assigned', '00000000-0000-0000-0000-0000000000a1', 'authenticated', $$SELECT public.assign_help_request('30000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3')$$);

SELECT t.act('00000000-0000-0000-0000-0000000000a3', 'authenticated');
SELECT count(*) AS n_op_list FROM public.list_assignable_operators() \gset
RESET ROLE;
SELECT t.act('00000000-0000-0000-0000-0000000000a1', 'authenticated');
SELECT public.assign_help_request('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3') AS r1 \gset
SELECT public.assign_help_request('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3') AS r2 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the administrator assigns a request to an operator', :'r1' = 'assigned' AND (SELECT operator_id = '00000000-0000-0000-0000-0000000000a3' FROM help_me_find_it_requests WHERE id = '30000000-0000-0000-0000-0000000000a1');
INSERT INTO t.results SELECT 'assigning the same person again changes nothing and is not logged twice', :'r2' = 'unchanged' AND (SELECT count(*) = 1 FROM audit_logs WHERE action = 'help_request.assigned' AND entity_id = '30000000-0000-0000-0000-0000000000a1');
INSERT INTO t.results SELECT 'assigning does not change the status', (SELECT status = 'pending' FROM help_me_find_it_requests WHERE id = '30000000-0000-0000-0000-0000000000a1');
INSERT INTO t.results SELECT 'assigning queues no message to the customer', (SELECT count(*) = :q_before FROM notification_queue);
INSERT INTO t.results SELECT 'operators and administrators can both list the assignable people, and only active staff appear', :n_op_list = 2;
SELECT t.act('00000000-0000-0000-0000-0000000000a1', 'authenticated');
SELECT public.assign_help_request('30000000-0000-0000-0000-0000000000a1', NULL) AS r3 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the administrator can unassign, and it is logged with the previous operator', :'r3' = 'unassigned' AND (SELECT operator_id IS NULL FROM help_me_find_it_requests WHERE id = '30000000-0000-0000-0000-0000000000a1')
  AND (SELECT count(*) = 1 FROM audit_logs WHERE action = 'help_request.unassigned' AND previous_state->>'operator_id' = '00000000-0000-0000-0000-0000000000a3');

-- ---- C. Homepage layout ---------------------------------------------------------------------------------------------
SELECT t.act(NULL, 'anon');
SELECT count(*) AS n_sections, count(*) FILTER (WHERE is_visible) AS n_visible FROM homepage_sections \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the homepage starts with seven visible sections, readable by everyone', :n_sections = 7 AND :n_visible = 7;
SELECT t.raises('anon cannot write the layout table', NULL, 'anon', $$UPDATE homepage_sections SET is_visible = false$$);
SELECT t.raises('an administrator cannot write the layout table directly (audited function only)', '00000000-0000-0000-0000-0000000000a1', 'authenticated', $$UPDATE homepage_sections SET is_visible = false$$);
SELECT t.raises('a customer cannot change the layout', '00000000-0000-0000-0000-0000000000a2', 'authenticated', $$SELECT public.admin_set_homepage_section('items', false, 50)$$);
SELECT t.raises('an operator cannot change the layout', '00000000-0000-0000-0000-0000000000a3', 'authenticated', $$SELECT public.admin_set_homepage_section('items', false, 50)$$);
SELECT t.raises('anon cannot change the layout', NULL, 'anon', $$SELECT public.admin_set_homepage_section('items', false, 50)$$);
SELECT t.raises('an unknown section is refused', '00000000-0000-0000-0000-0000000000a1', 'authenticated', $$SELECT public.admin_set_homepage_section('hero', false, 5)$$);
SELECT t.raises('an order above 1000 is refused', '00000000-0000-0000-0000-0000000000a1', 'authenticated', $$SELECT public.admin_set_homepage_section('items', true, 1001)$$);
SELECT t.raises('a missing visibility is refused', '00000000-0000-0000-0000-0000000000a1', 'authenticated', $$SELECT public.admin_set_homepage_section('items', NULL, 50)$$);
SELECT t.act('00000000-0000-0000-0000-0000000000a1', 'authenticated');
SELECT public.admin_set_homepage_section('items', false, 55) AS c1 \gset
SELECT public.admin_set_homepage_section('items', false, 55) AS c2 \gset
SELECT public.admin_set_homepage_section('areas', true, 5) AS c3 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the administrator hides and moves sections', :'c1' = 'changed' AND :'c3' = 'changed'
  AND (SELECT NOT is_visible AND display_order = 55 FROM homepage_sections WHERE section_key = 'items')
  AND (SELECT is_visible AND display_order = 5 FROM homepage_sections WHERE section_key = 'areas');
INSERT INTO t.results SELECT 'a repeat with the same values is a no-op and writes no second audit row', :'c2' = 'unchanged'
  AND (SELECT count(*) = 1 FROM audit_logs WHERE action = 'homepage_section.changed' AND new_state->>'section' = 'items');
INSERT INTO t.results SELECT 'a layout change is audited with the previous state', (SELECT previous_state->>'display_order' = '50' AND previous_state->>'is_visible' = 'true' FROM audit_logs WHERE action = 'homepage_section.changed' AND new_state->>'section' = 'items');

-- ---- D. Review snapshot ---------------------------------------------------------------------------------------------
SELECT t.act('00000000-0000-0000-0000-0000000000a6', 'authenticated');
INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, business_description, review_snapshot)
VALUES ('00000000-0000-0000-0000-0000000000a6', 'Snapshot Shop', :'kirana', :'loc', '+919100000601', 'Old address', 'Old description', '{"forged": true}') RETURNING id AS app \gset
RESET ROLE;
INSERT INTO t.results SELECT 'an applicant cannot plant a snapshot when creating an application', (SELECT review_snapshot IS NULL FROM merchant_applications WHERE id = :'app');
SELECT t.allowed('the applicant accepts the declaration and sets the PIN', '00000000-0000-0000-0000-0000000000a6', 'authenticated', format($$UPDATE merchant_applications SET declaration_accepted = true, pincode = '507001' WHERE id = %L$$, :'app'));
SELECT t.allowed('the applicant submits', '00000000-0000-0000-0000-0000000000a6', 'authenticated', format($$SELECT public.submit_merchant_application(%L)$$, :'app'));
INSERT INTO t.results SELECT 'no snapshot exists before corrections are requested', (SELECT review_snapshot IS NULL FROM merchant_applications WHERE id = :'app');
SELECT t.allowed('the administrator requests corrections', '00000000-0000-0000-0000-0000000000a1', 'authenticated', format($$SELECT public.review_merchant_application(%L, 'request_corrections', 'Please give the full address')$$, :'app'));
INSERT INTO t.results SELECT 'requesting corrections keeps what the administrator saw',
  (SELECT review_snapshot->>'address_line1' = 'Old address' AND review_snapshot->>'business_description' = 'Old description' AND review_snapshot->>'business_name' = 'Snapshot Shop' FROM merchant_applications WHERE id = :'app');
INSERT INTO t.results SELECT 'the snapshot holds content only, no identifiers or review fields',
  (SELECT NOT (review_snapshot ?| ARRAY['id','applicant_user_id','status','reviewed_by','correction_notes','created_at','updated_at','review_snapshot']) FROM merchant_applications WHERE id = :'app');
SELECT t.raises('the applicant cannot rewrite the snapshot', '00000000-0000-0000-0000-0000000000a6', 'authenticated', format($$UPDATE merchant_applications SET review_snapshot = '{"address_line1":"forged"}' WHERE id = %L$$, :'app'));
SELECT t.allowed('the applicant corrects the address', '00000000-0000-0000-0000-0000000000a6', 'authenticated', format($$UPDATE merchant_applications SET address_line1 = 'Full new address, Khammam' WHERE id = %L$$, :'app'));
SELECT t.allowed('the applicant resubmits', '00000000-0000-0000-0000-0000000000a6', 'authenticated', format($$SELECT public.submit_merchant_application(%L)$$, :'app'));
INSERT INTO t.results SELECT 'after resubmission the snapshot still shows the old content next to the new content',
  (SELECT status = 'submitted' AND review_snapshot->>'address_line1' = 'Old address' AND address_line1 = 'Full new address, Khammam' FROM merchant_applications WHERE id = :'app');

SELECT result, name FROM (SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results) r ORDER BY name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN RAISE EXCEPTION 'notice/assignment/layout tests failed'; END IF; END $$;
ROLLBACK;
