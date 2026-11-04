-- Behavioural tests for migration 009 (marketplace listing, ADR-009): richer search rows,
-- the development sample flag, category template in counts and recent_public_products().
-- Rolled back; raises (non-zero exit) if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-00000000009a','m@example.test','{"full_name":"Merchant","phone":"+919000000091"}');
INSERT INTO businesses (id, name, primary_owner_id) VALUES ('10000000-0000-0000-0000-00000000009a','Mkt Biz','00000000-0000-0000-0000-00000000009a');
INSERT INTO business_members (business_id, user_id, role) VALUES ('10000000-0000-0000-0000-00000000009a','00000000-0000-0000-0000-00000000009a','owner');
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone, operating_hours)
 SELECT '20000000-0000-0000-0000-00000000009a','10000000-0000-0000-0000-00000000009a','Mktfixture Real','MAIN',
        (SELECT id FROM categories WHERE slug = 'kirana'),(SELECT id FROM localities ORDER BY slug LIMIT 1),'addr','+919100000091',
        '{"opens":"08:30","closes":"21:00","closed_days":["tuesday"]}';
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT '20000000-0000-0000-0000-00000000009b','10000000-0000-0000-0000-00000000009a','Mktfixture Sample','BR1',
        (SELECT id FROM categories WHERE slug = 'salons'),(SELECT id FROM localities ORDER BY slug LIMIT 1),'addr','+919100000092';
INSERT INTO storefronts (id, shop_id, slug, is_published, visibility_status, template_name, banner_url, is_sample) VALUES
 ('30000000-0000-0000-0000-00000000009a','20000000-0000-0000-0000-00000000009a','mktfixture-real', true, 'visible', 'grocery', 'https://example.test/b.jpg', false),
 ('30000000-0000-0000-0000-00000000009b','20000000-0000-0000-0000-00000000009b','mktfixture-sample', true, 'visible', 'service_provider', NULL, true);
INSERT INTO storefront_products (shop_id, name, price, stock_status, is_published) VALUES
 ('20000000-0000-0000-0000-00000000009a','Mktfixture Rice', 80, 'in_stock', true),
 ('20000000-0000-0000-0000-00000000009a','Mktfixture Dal', NULL, 'call_to_confirm', true),
 ('20000000-0000-0000-0000-00000000009a','Mktfixture Hidden Item', 5, 'in_stock', false);

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

-- Search rows -----------------------------------------------------------------------------
SET LOCAL ROLE anon;
INSERT INTO t.results SELECT 'search row carries banner, template, hours and the real/sample flag',
  (SELECT banner_url = 'https://example.test/b.jpg' AND template_name = 'grocery' AND NOT is_sample
          AND operating_hours->>'opens' = '08:30' FROM search_storefronts('Mktfixture Real'));
INSERT INTO t.results SELECT 'a sample listing is flagged is_sample',
  (SELECT is_sample AND template_name = 'service_provider' FROM search_storefronts('Mktfixture Sample'));
INSERT INTO t.results SELECT 'item_count counts only published items',
  (SELECT item_count = 2 FROM search_storefronts('Mktfixture Real'));
INSERT INTO t.results SELECT 'a shop with no items reports item_count 0',
  (SELECT item_count = 0 FROM search_storefronts('Mktfixture Sample'));
INSERT INTO t.results SELECT 'search still paginates and totals',
  (SELECT total_count >= 2 FROM search_storefronts('Mktfixture', NULL, NULL, NULL, 'name', 1, 0));
INSERT INTO t.results SELECT 'sorting by name still works with the new columns',
  (SELECT (array_agg(shop_name ORDER BY ord))[1] = 'Mktfixture Real'
     FROM (SELECT shop_name, row_number() OVER () AS ord FROM search_storefronts('Mktfixture', NULL, NULL, NULL, 'name', 10, 0)) s);

-- Category counts expose the template -----------------------------------------------------
INSERT INTO t.results SELECT 'category counts include default_template',
  (SELECT default_template = 'grocery' FROM public_category_counts() WHERE slug = 'kirana');

-- Recent items ----------------------------------------------------------------------------
INSERT INTO t.results SELECT 'recent items list published items only',
  (SELECT count(*) = 2 FROM recent_public_products(NULL, 24) WHERE name LIKE 'Mktfixture%');
INSERT INTO t.results SELECT 'recent items carry the effective stock label and the sample flag',
  (SELECT bool_and(effective_stock_status IN ('in_stock','call_to_confirm','out_of_stock')) AND bool_and(NOT is_sample)
     FROM recent_public_products(NULL, 24) WHERE name LIKE 'Mktfixture%');
INSERT INTO t.results SELECT 'recent items can be scoped to a locality that has none',
  (SELECT count(*) = 0 FROM recent_public_products((SELECT id FROM localities ORDER BY slug DESC LIMIT 1), 24) WHERE name LIKE 'Mktfixture%');
RESET ROLE;

-- Hidden storefronts disappear from the new surfaces too ------------------------------------
UPDATE storefronts SET visibility_status = 'hidden' WHERE slug = 'mktfixture-real';
SET LOCAL ROLE anon;
INSERT INTO t.results SELECT 'a hidden storefront is absent from search', (SELECT count(*) = 0 FROM search_storefronts('Mktfixture Real'));
INSERT INTO t.results SELECT 'a hidden storefront has no items in recent items', (SELECT count(*) = 0 FROM recent_public_products(NULL, 24) WHERE name LIKE 'Mktfixture%');
RESET ROLE;
UPDATE storefronts SET visibility_status = 'visible' WHERE slug = 'mktfixture-real';

-- The sample flag is platform-controlled ---------------------------------------------------------
SELECT t.raises('an owner cannot clear is_sample on their own storefront', '00000000-0000-0000-0000-00000000009a', 'authenticated',
  $$UPDATE storefronts SET is_sample = false WHERE slug = 'mktfixture-sample'$$);
SELECT t.raises('an owner cannot mark a real storefront as sample', '00000000-0000-0000-0000-00000000009a', 'authenticated',
  $$UPDATE storefronts SET is_sample = true WHERE slug = 'mktfixture-real'$$);
INSERT INTO t.results SELECT 'migration-approved storefronts default to is_sample = false',
  (SELECT column_default = 'false' FROM information_schema.columns WHERE table_name = 'storefronts' AND column_name = 'is_sample');

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN RAISE EXCEPTION 'marketplace tests failed'; END IF; END $$;
ROLLBACK;
