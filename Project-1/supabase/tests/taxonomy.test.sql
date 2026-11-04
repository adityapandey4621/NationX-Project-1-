-- Behavioural tests for migration 020: subcategories (REQ-ADM-03, REQ-APP-01, REQ-HOM-03) and admin-defined
-- category attributes. Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000f1','boss@example.test','{"full_name":"Boss","phone":"+919000000091"}'),
 ('00000000-0000-0000-0000-0000000000f2','cust@example.test','{"full_name":"Cust","phone":"+919000000092"}'),
 ('00000000-0000-0000-0000-0000000000f3','op@example.test','{"full_name":"Op","phone":"+919000000093"}'),
 ('00000000-0000-0000-0000-0000000000f4','app@example.test','{"full_name":"Applicant","phone":"+919000000094"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000f1','admin'),('00000000-0000-0000-0000-0000000000f3','operator');

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
SELECT id AS other_cat FROM categories WHERE slug <> 'kirana' ORDER BY slug LIMIT 1 \gset
SELECT id AS loc FROM localities WHERE slug = 'gandhi-chowk' \gset

-- ---- Subcategories: administrators only, audited ---------------------------------------------------------------
SELECT t.raises('a customer cannot create a subcategory', '00000000-0000-0000-0000-0000000000f2', 'authenticated', format($$SELECT public.admin_save_subcategory(NULL, %L, 'Rice', 'zz-rice', 1, true)$$, :'kirana'));
SELECT t.raises('an operator cannot create a subcategory', '00000000-0000-0000-0000-0000000000f3', 'authenticated', format($$SELECT public.admin_save_subcategory(NULL, %L, 'Rice', 'zz-rice', 1, true)$$, :'kirana'));
SELECT t.raises('anon cannot create a subcategory', NULL, 'anon', format($$SELECT public.admin_save_subcategory(NULL, %L, 'Rice', 'zz-rice', 1, true)$$, :'kirana'));
SELECT t.raises('a name of one character is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_subcategory(NULL, %L, 'R', 'zz-r', 1, true)$$, :'kirana'));
SELECT t.raises('a web address with an underscore is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_subcategory(NULL, %L, 'Rice', 'zz_rice', 1, true)$$, :'kirana'));
SELECT t.raises('a web address with a double hyphen is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_subcategory(NULL, %L, 'Rice', 'zz--rice', 1, true)$$, :'kirana'));
SELECT t.raises('a web address with spaces is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_subcategory(NULL, %L, 'Rice', 'zz rice', 1, true)$$, :'kirana'));
SELECT t.raises('an unknown category is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', $$SELECT public.admin_save_subcategory(NULL, gen_random_uuid(), 'Rice', 'zz-rice', 1, true)$$);
SELECT t.raises('an out-of-range order is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_subcategory(NULL, %L, 'Rice', 'zz-rice', 99999, true)$$, :'kirana'));
SELECT t.raises('a customer cannot write the table directly', '00000000-0000-0000-0000-0000000000f2', 'authenticated', format($$INSERT INTO subcategories (category_id, name, slug) VALUES (%L, 'X', 'zz-x')$$, :'kirana'));
INSERT INTO t.results SELECT 'none of the refused attempts left a subcategory behind', (SELECT count(*) = 0 FROM subcategories WHERE slug LIKE 'zz%');

SELECT t.act('00000000-0000-0000-0000-0000000000f1', 'authenticated');
SELECT public.admin_save_subcategory(NULL, :'kirana', '  Rice   and  Grains ', 'zz-rice-grains', 5, true) AS sub \gset
SELECT public.admin_save_subcategory(NULL, :'kirana', 'Old Spices', 'zz-old-spices', 6, false) AS sub_off \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the administrator creates a subcategory with a tidied name',
  (SELECT name = 'Rice and Grains' AND slug = 'zz-rice-grains' AND category_id = :'kirana' AND display_order = 5 AND is_active FROM subcategories WHERE id = :'sub');
INSERT INTO t.results SELECT 'creating it is audited', (SELECT count(*) = 1 FROM audit_logs WHERE action = 'subcategory.created' AND entity_id = :'sub');
SELECT t.raises('a second subcategory cannot reuse a web address', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_subcategory(NULL, %L, 'Another', 'zz-rice-grains', 1, true)$$, :'kirana'));

SELECT t.act(NULL, 'anon');
SELECT count(*) AS n_anon_active FROM subcategories WHERE id = :'sub' \gset
SELECT count(*) AS n_anon_off FROM subcategories WHERE id = :'sub_off' \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the public sees an active subcategory', :n_anon_active = 1;
INSERT INTO t.results SELECT 'the public does not see a switched-off subcategory', :n_anon_off = 0;

-- ---- Subcategories are searchable ------------------------------------------------------------------------------
INSERT INTO businesses (id, name, primary_owner_id) VALUES ('10000000-0000-0000-0000-0000000000f1','Tax Biz','00000000-0000-0000-0000-0000000000f4');
INSERT INTO shops (id, business_id, name, shop_code, category_id, subcategory_id, locality_id, address_line, phone) VALUES
 ('20000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-0000000000f1','Plain Name Stores','T',:'kirana',:'sub',:'loc','1 Main Road','+919100000301');
INSERT INTO storefronts (shop_id, slug, is_published, visibility_status) VALUES ('20000000-0000-0000-0000-0000000000f1','zz-plain-name',true,'visible');
SELECT t.act(NULL, 'anon');
SELECT count(*) AS n_by_sub FROM search_storefronts('grains') WHERE slug = 'zz-plain-name' \gset
RESET ROLE;
INSERT INTO t.results SELECT 'a shop is found by its subcategory name (the shop name does not contain it)', :n_by_sub = 1;

SELECT t.act('00000000-0000-0000-0000-0000000000f1', 'authenticated');
SELECT public.admin_save_subcategory(:'sub', NULL, 'Staples', 'ignored-slug', 5, true) AS _renamed \gset
RESET ROLE;
INSERT INTO t.results SELECT 'renaming keeps the category and the web address', (SELECT slug = 'zz-rice-grains' AND category_id = :'kirana' AND name = 'Staples' FROM subcategories WHERE id = :'sub');
INSERT INTO t.results SELECT 'renaming is audited with the previous state', (SELECT count(*) = 1 FROM audit_logs WHERE action = 'subcategory.updated' AND entity_id = :'sub' AND previous_state->>'name' = 'Rice and Grains');
SELECT t.act(NULL, 'anon');
SELECT count(*) AS n_new FROM search_storefronts('staples') WHERE slug = 'zz-plain-name' \gset
SELECT count(*) AS n_old FROM search_storefronts('grains') WHERE slug = 'zz-plain-name' \gset
RESET ROLE;
INSERT INTO t.results SELECT 'after a rename the shop is found by the new name', :n_new = 1;
INSERT INTO t.results SELECT 'after a rename the old name no longer finds it', :n_old = 0;

-- ---- The application must pick a subcategory of its own category -----------------------------------------------
SELECT t.act('00000000-0000-0000-0000-0000000000f1', 'authenticated');
SELECT public.admin_save_subcategory(NULL, :'other_cat', 'Elsewhere', 'zz-elsewhere', 1, true) AS sub_other \gset
RESET ROLE;
SELECT t.act('00000000-0000-0000-0000-0000000000f4', 'authenticated');
INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, subcategory_id, locality_id, contact_phone, address_line1)
VALUES ('00000000-0000-0000-0000-0000000000f4', 'Tax Applicant', :'kirana', :'sub', :'loc', '+919100000302', 'addr') RETURNING id AS app \gset
RESET ROLE;
INSERT INTO t.results SELECT 'an applicant can pick a subcategory of the chosen category', (SELECT subcategory_id = :'sub' FROM merchant_applications WHERE id = :'app');
SELECT t.raises('a subcategory of another category is refused', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET subcategory_id = %L WHERE id = %L$$, :'sub_other', :'app'));
SELECT t.raises('a switched-off subcategory cannot be newly chosen', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET subcategory_id = %L WHERE id = %L$$, :'sub_off', :'app'));
SELECT t.raises('changing the category while keeping a subcategory of the old one is refused', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_id = %L WHERE id = %L$$, :'other_cat', :'app'));
SELECT t.allowed('the subcategory can be cleared', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET subcategory_id = NULL WHERE id = %L$$, :'app'));

-- ---- Category attributes: administrators only ------------------------------------------------------------------
SELECT t.raises('a customer cannot define a question', '00000000-0000-0000-0000-0000000000f2', 'authenticated', format($$SELECT public.admin_save_category_attribute(NULL, %L, 'brands', 'Brands', NULL, 'text', NULL, false, 1, true)$$, :'kirana'));
SELECT t.raises('an operator cannot define a question', '00000000-0000-0000-0000-0000000000f3', 'authenticated', format($$SELECT public.admin_save_category_attribute(NULL, %L, 'brands', 'Brands', NULL, 'text', NULL, false, 1, true)$$, :'kirana'));
SELECT t.raises('anon cannot define a question', NULL, 'anon', format($$SELECT public.admin_save_category_attribute(NULL, %L, 'brands', 'Brands', NULL, 'text', NULL, false, 1, true)$$, :'kirana'));
SELECT t.raises('the table cannot be written directly by an administrator', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$INSERT INTO category_attributes (category_id, key, label, field_type) VALUES (%L, 'x1', 'Direct', 'text')$$, :'kirana'));
SELECT t.raises('a key with a space is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_category_attribute(NULL, %L, 'brand name', 'Brands', NULL, 'text', NULL, false, 1, true)$$, :'kirana'));
SELECT t.raises('a key starting with a digit is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_category_attribute(NULL, %L, '1brand', 'Brands', NULL, 'text', NULL, false, 1, true)$$, :'kirana'));
SELECT t.raises('a key that is a single character is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_category_attribute(NULL, %L, 'b', 'Brands', NULL, 'text', NULL, false, 1, true)$$, :'kirana'));
INSERT INTO t.results SELECT 'none of the refused attempts left a question behind', (SELECT count(*) = 0 FROM category_attributes WHERE category_id = :'kirana');
SELECT t.raises('an unknown answer type is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_category_attribute(NULL, %L, 'brands', 'Brands', NULL, 'file', NULL, false, 1, true)$$, :'kirana'));
SELECT t.raises('a list question needs at least two choices', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_category_attribute(NULL, %L, 'size', 'Size', NULL, 'choice', ARRAY['Only one'], false, 1, true)$$, :'kirana'));
SELECT t.raises('a question of one character is refused', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_category_attribute(NULL, %L, 'brands', 'B', NULL, 'text', NULL, false, 1, true)$$, :'kirana'));

SELECT t.act('00000000-0000-0000-0000-0000000000f1', 'authenticated');
SELECT public.admin_save_category_attribute(NULL, :'kirana', 'brands_stocked', 'Brands you stock', 'Main brands', 'text', NULL, false, 1, true) AS a_text \gset
SELECT public.admin_save_category_attribute(NULL, :'kirana', 'floor_area', 'Shop area (sq ft)', NULL, 'number', NULL, false, 2, true) AS a_num \gset
SELECT public.admin_save_category_attribute(NULL, :'kirana', 'shop_size', 'Shop size', NULL, 'choice', ARRAY['Small','Medium','Large'], true, 3, true) AS a_choice \gset
SELECT public.admin_save_category_attribute(NULL, :'kirana', 'sells_loose', 'Sells loose items', NULL, 'yes_no', NULL, false, 4, true) AS a_yn \gset
SELECT public.admin_save_category_attribute(NULL, :'kirana', 'retired_q', 'Old question', NULL, 'text', NULL, false, 9, false) AS a_off \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the administrator defines questions of every type', (SELECT count(*) = 5 FROM category_attributes WHERE category_id = :'kirana');
INSERT INTO t.results SELECT 'defining a question is audited', (SELECT count(*) = 5 FROM audit_logs WHERE action = 'category_attribute.created');
INSERT INTO t.results SELECT 'a non-list question stores no choices, a list question stores them in order',
  (SELECT CARDINALITY(options) = 0 FROM category_attributes WHERE id = :'a_text') AND (SELECT options = ARRAY['Small','Medium','Large'] FROM category_attributes WHERE id = :'a_choice');
SELECT t.raises('a key cannot be reused within a category', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$SELECT public.admin_save_category_attribute(NULL, %L, 'brands_stocked', 'Duplicate', NULL, 'text', NULL, false, 1, true)$$, :'kirana'));

SELECT t.act(NULL, 'anon');
SELECT count(*) AS n_attr_anon FROM category_attributes WHERE category_id = :'kirana' \gset
RESET ROLE;
SELECT t.act('00000000-0000-0000-0000-0000000000f1', 'authenticated');
SELECT count(*) AS n_attr_admin FROM category_attributes WHERE category_id = :'kirana' \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the public sees only the active questions', :n_attr_anon = 4;
INSERT INTO t.results SELECT 'the administrator also sees the switched-off one', :n_attr_admin = 5;

SELECT t.act('00000000-0000-0000-0000-0000000000f1', 'authenticated');
SELECT public.admin_save_category_attribute(:'a_choice', NULL, 'ignored_key', 'Shop size (floor)', 'Pick one', 'text', ARRAY['Tiny','Huge','Giant'], true, 3, true) AS _upd \gset
RESET ROLE;
INSERT INTO t.results SELECT 'editing a question keeps its key and answer type but updates label and choices',
  (SELECT key = 'shop_size' AND field_type = 'choice' AND label = 'Shop size (floor)' AND options = ARRAY['Tiny','Huge','Giant'] FROM category_attributes WHERE id = :'a_choice');
INSERT INTO t.results SELECT 'editing a question is audited with its previous state', (SELECT count(*) = 1 FROM audit_logs WHERE action = 'category_attribute.updated' AND entity_id = :'a_choice' AND previous_state->>'label' = 'Shop size');
DO $$
DECLARE i INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
  SET LOCAL ROLE authenticated;
  FOR i IN 1..16 LOOP
    PERFORM public.admin_save_category_attribute(NULL, (SELECT id FROM categories WHERE slug = 'kirana'), 'bulk_q_' || i, 'Bulk question ' || i, NULL, 'text', NULL, false, 10 + i, true);
  END LOOP;
  BEGIN
    PERFORM public.admin_save_category_attribute(NULL, (SELECT id FROM categories WHERE slug = 'kirana'), 'one_too_many', 'One too many', NULL, 'text', NULL, false, 99, true);
    RESET ROLE;
    INSERT INTO t.results VALUES ('a category is capped at 20 active questions', false);
  EXCEPTION WHEN check_violation THEN
    RESET ROLE;
    INSERT INTO t.results VALUES ('a category is capped at 20 active questions', true);
  END;
END $$;

-- ---- Answers are validated by the database ---------------------------------------------------------------------
SELECT t.allowed('valid answers of every type are accepted', '00000000-0000-0000-0000-0000000000f4', 'authenticated',
  format($$UPDATE merchant_applications SET category_specific_data = '{"brands_stocked":"Aashirvaad, Fortune","floor_area":420,"shop_size":"Huge","sells_loose":true}' WHERE id = %L$$, :'app'));
SELECT t.raises('an unknown question key is refused', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_specific_data = '{"not_a_question":"x"}' WHERE id = %L$$, :'app'));
SELECT t.raises('an answer to a switched-off question is refused', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_specific_data = '{"retired_q":"x"}' WHERE id = %L$$, :'app'));
SELECT t.raises('a number question refuses text', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_specific_data = '{"floor_area":"big"}' WHERE id = %L$$, :'app'));
SELECT t.raises('a text question refuses a number', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_specific_data = '{"brands_stocked":5}' WHERE id = %L$$, :'app'));
SELECT t.raises('a list question refuses a value that is not a choice', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_specific_data = '{"shop_size":"Enormous"}' WHERE id = %L$$, :'app'));
SELECT t.raises('a yes/no question refuses text', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_specific_data = '{"sells_loose":"yes"}' WHERE id = %L$$, :'app'));
SELECT t.raises('an answer over 200 characters is refused', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_specific_data = jsonb_build_object('brands_stocked', repeat('x', 201)) WHERE id = %L$$, :'app'));
SELECT t.raises('answers that are not an object are refused', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_specific_data = '["a"]' WHERE id = %L$$, :'app'));
SELECT t.raises('answers from another category do not carry over when the category changes', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE merchant_applications SET category_id = %L WHERE id = %L$$, :'other_cat', :'app'));

-- A draft may be incomplete; a submission may not omit a mandatory question.
SELECT t.allowed('a draft without the mandatory answer can be saved', '00000000-0000-0000-0000-0000000000f4', 'authenticated',
  format($$UPDATE merchant_applications SET category_specific_data = '{"brands_stocked":"Fortune"}', declaration_accepted = true, pincode = '507001' WHERE id = %L$$, :'app'));
SELECT t.raises('submitting without the mandatory answer is refused', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$SELECT public.submit_merchant_application(%L)$$, :'app'));
SELECT t.allowed('after answering it, the application can be submitted', '00000000-0000-0000-0000-0000000000f4', 'authenticated',
  format($$UPDATE merchant_applications SET category_specific_data = '{"brands_stocked":"Fortune","shop_size":"Tiny"}' WHERE id = %L$$, :'app'));
SELECT t.allowed('submission succeeds with every mandatory answer', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$SELECT public.submit_merchant_application(%L)$$, :'app'));
INSERT INTO t.results SELECT 'the application is now submitted', (SELECT status = 'submitted' FROM merchant_applications WHERE id = :'app');

-- ---- Approval carries the answers to the shop ------------------------------------------------------------------
SELECT t.act('00000000-0000-0000-0000-0000000000f1', 'authenticated');
SELECT (public.approve_merchant_application(:'app', 'ok'))->>'shop_id' AS new_shop \gset
RESET ROLE;
INSERT INTO t.results SELECT 'approval copies the answers onto the shop', (SELECT category_details = '{"brands_stocked":"Fortune","shop_size":"Tiny"}'::jsonb FROM shops WHERE id = :'new_shop');
INSERT INTO t.results SELECT 'the approved shop keeps the chosen subcategory empty when none was chosen', (SELECT subcategory_id IS NULL FROM shops WHERE id = :'new_shop');
SELECT t.raises('the shop owner cannot edit the category details afterwards', '00000000-0000-0000-0000-0000000000f4', 'authenticated', format($$UPDATE shops SET category_details = '{"shop_size":"Huge"}' WHERE id = %L$$, :'new_shop'));
SELECT t.allowed('an administrator can correct the category details', '00000000-0000-0000-0000-0000000000f1', 'authenticated', format($$UPDATE shops SET category_details = '{"shop_size":"Huge"}' WHERE id = %L$$, :'new_shop'));
INSERT INTO t.results SELECT 'the administrator''s correction really changed the stored details', (SELECT category_details = '{"shop_size":"Huge"}'::jsonb FROM shops WHERE id = :'new_shop');

SELECT result, name FROM (SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results) r ORDER BY name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN RAISE EXCEPTION 'taxonomy tests failed'; END IF; END $$;
ROLLBACK;
