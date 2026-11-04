-- Behavioural tests for migration 007: product catalogue, stock labels, product
-- search and admin moderation of storefronts. Runs in a transaction that is rolled
-- back; raises (non-zero exit) if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;

-- Fixtures (superuser) ------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-00000000000a','a@example.test','{"full_name":"Merchant A","phone":"+919000000001"}'),
 ('00000000-0000-0000-0000-00000000000b','b@example.test','{"full_name":"Merchant B","phone":"+919000000002"}'),
 ('00000000-0000-0000-0000-0000000000e1','e@example.test','{"full_name":"Employee","phone":"+919000000005"}'),
 ('00000000-0000-0000-0000-0000000000ad','admin@example.test','{"full_name":"Admin","phone":"+919000000003"}'),
 ('00000000-0000-0000-0000-0000000000c1','c@example.test','{"full_name":"Customer","phone":"+919000000004"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000ad','admin');
INSERT INTO businesses (id, name, primary_owner_id) VALUES
 ('10000000-0000-0000-0000-00000000000a','Biz A','00000000-0000-0000-0000-00000000000a'),
 ('10000000-0000-0000-0000-00000000000b','Biz B','00000000-0000-0000-0000-00000000000b');
INSERT INTO business_members (business_id, user_id, role) VALUES
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','owner'),
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e1','employee'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','owner');
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT '20000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','Shop A','MAIN',
        (SELECT id FROM categories ORDER BY slug LIMIT 1),(SELECT id FROM localities ORDER BY slug LIMIT 1),'addr','+919100000001';
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT '20000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000b','Shop B','MAIN',
        (SELECT id FROM categories ORDER BY slug LIMIT 1),(SELECT id FROM localities ORDER BY slug OFFSET 1 LIMIT 1),'addr','+919100000002';
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT '20000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-00000000000b','Shop B Branch','BR1',
        (SELECT id FROM categories ORDER BY slug LIMIT 1),(SELECT id FROM localities ORDER BY slug LIMIT 1),'addr','+919100000003';
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT '20000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-00000000000a','Shop A Full','FULL',
        (SELECT id FROM categories ORDER BY slug LIMIT 1),(SELECT id FROM localities ORDER BY slug LIMIT 1),'addr','+919100000004';
INSERT INTO storefronts (id, shop_id, slug, is_published, visibility_status) VALUES
 ('30000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-00000000000a','cat-shop-a', true, 'visible'),
 ('30000000-0000-0000-0000-00000000000b','20000000-0000-0000-0000-00000000000b','cat-shop-b', true, 'visible'),
 ('30000000-0000-0000-0000-0000000000b2','20000000-0000-0000-0000-0000000000b2','cat-shop-h', true, 'hidden');

-- Items. Names are unique-ish so search assertions are not disturbed by seed data.
INSERT INTO storefront_products (id, shop_id, name, name_te, price, mrp, unit, stock_status, is_published) VALUES
 ('40000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-00000000000a','Sugarfixture Loose',  NULL, 45, 50, 'kg', 'in_stock', true),
 ('40000000-0000-0000-0000-0000000000a2','20000000-0000-0000-0000-00000000000a','Sugarfixture Private', NULL, 40, NULL, 'kg', 'in_stock', false),
 ('40000000-0000-0000-0000-0000000000a3','20000000-0000-0000-0000-00000000000a','Jaggery Fixture', 'బెల్లంఫిక్స్చర్', NULL, NULL, 'kg', 'call_to_confirm', true),
 ('40000000-0000-0000-0000-0000000000a4','20000000-0000-0000-0000-00000000000a','Basmati Rice', NULL, 120, NULL, 'kg', 'out_of_stock', true),
 ('40000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-00000000000b','Sugarfixture Packet', NULL, 30, NULL, 'pack', 'call_to_confirm', true),
 ('40000000-0000-0000-0000-0000000000b9','20000000-0000-0000-0000-0000000000b2','Sugarfixture Branch', NULL, 20, NULL, 'pack', 'in_stock', true);

-- Helpers ---------------------------------------------------------------------------
CREATE FUNCTION t.act(uid TEXT, r TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(uid,''), true);
  EXECUTE format('SET LOCAL ROLE %I', r);
END $$;
GRANT EXECUTE ON FUNCTION t.act(TEXT,TEXT) TO anon, authenticated, service_role;

CREATE FUNCTION t.blocked(name TEXT, uid TEXT, r TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n INT; ok BOOLEAN;
BEGIN
  BEGIN
    PERFORM t.act(uid, r); EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT; ok := (n = 0); RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; ok := true;
  END;
  INSERT INTO t.results VALUES (name, ok);
END $$;

CREATE FUNCTION t.raises(name TEXT, uid TEXT, r TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN;
BEGIN
  BEGIN
    PERFORM t.act(uid, r); EXECUTE stmt; RESET ROLE; ok := false;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; ok := true;
  END;
  INSERT INTO t.results VALUES (name, ok);
END $$;

CREATE FUNCTION t.allowed(name TEXT, uid TEXT, r TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n INT; ok BOOLEAN;
BEGIN
  BEGIN
    PERFORM t.act(uid, r); EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT; ok := (n >= 1); RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; ok := false;
  END;
  INSERT INTO t.results VALUES (name, ok);
END $$;

CREATE FUNCTION t.count_is(name TEXT, uid TEXT, r TEXT, stmt TEXT, expected INT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  PERFORM t.act(uid, r);
  EXECUTE 'SELECT count(*) FROM (' || stmt || ') x' INTO n;
  RESET ROLE;
  INSERT INTO t.results VALUES (name || ' (got ' || n || ')', n = expected);
END $$;

DO $$
DECLARE A TEXT := '00000000-0000-0000-0000-00000000000a'; B TEXT := '00000000-0000-0000-0000-00000000000b';
        E TEXT := '00000000-0000-0000-0000-0000000000e1'; AD TEXT := '00000000-0000-0000-0000-0000000000ad';
        C TEXT := '00000000-0000-0000-0000-0000000000c1';
        SA TEXT := '20000000-0000-0000-0000-00000000000a'; SB TEXT := '20000000-0000-0000-0000-00000000000b';
        FA TEXT := '30000000-0000-0000-0000-00000000000a'; FH TEXT := '30000000-0000-0000-0000-0000000000b2';
        n INT; ts TIMESTAMPTZ;
BEGIN
  -- Ownership & isolation -----------------------------------------------------------
  PERFORM t.allowed('owner adds an item to their own shop', A, 'authenticated',
    format($q$INSERT INTO storefront_products (shop_id, name) VALUES (%L, 'Owner Added Item')$q$, SA));
  PERFORM t.raises('owner cannot add an item to another merchant''s shop', A, 'authenticated',
    format($q$INSERT INTO storefront_products (shop_id, name) VALUES (%L, 'Intruder')$q$, SB));
  PERFORM t.blocked('owner cannot edit another merchant''s item', B, 'authenticated',
    $q$UPDATE storefront_products SET price = 1 WHERE id = '40000000-0000-0000-0000-0000000000a1'$q$);
  PERFORM t.blocked('owner cannot delete another merchant''s item', B, 'authenticated',
    $q$DELETE FROM storefront_products WHERE id = '40000000-0000-0000-0000-0000000000a1'$q$);
  PERFORM t.raises('an item cannot be moved to a shop the user does not manage', A, 'authenticated',
    format($q$UPDATE storefront_products SET shop_id = %L WHERE id = '40000000-0000-0000-0000-0000000000a1'$q$, SB));
  -- A manages both shop A and shop "FULL": RLS would allow it, the guard trigger must still refuse.
  PERFORM t.raises('an item cannot be moved between two shops of the same owner', A, 'authenticated',
    $q$UPDATE storefront_products SET shop_id = '20000000-0000-0000-0000-0000000000f1' WHERE id = '40000000-0000-0000-0000-0000000000a1'$q$);
  PERFORM t.count_is('employee reads all of the shop''s items (published or not)', E, 'authenticated',
    format($q$SELECT 1 FROM storefront_products WHERE shop_id = %L$q$, SA), 5);
  PERFORM t.raises('employee cannot add items', E, 'authenticated',
    format($q$INSERT INTO storefront_products (shop_id, name) VALUES (%L, 'Employee Item')$q$, SA));
  PERFORM t.blocked('employee cannot edit items', E, 'authenticated',
    $q$UPDATE storefront_products SET price = 1 WHERE id = '40000000-0000-0000-0000-0000000000a1'$q$);
  PERFORM t.blocked('employee cannot delete items', E, 'authenticated',
    $q$DELETE FROM storefront_products WHERE id = '40000000-0000-0000-0000-0000000000a1'$q$);
  -- own items (published or not) + other shops' PUBLISHED items; never another shop's unpublished/hidden ones
  PERFORM t.count_is('owner sees own items incl. unpublished, plus others'' published ones only', A, 'authenticated',
    $q$SELECT 1 FROM storefront_products WHERE name LIKE 'Sugarfixture%'$q$, 3);
  PERFORM t.count_is('owner of another shop cannot see this shop''s unpublished item', B, 'authenticated',
    $q$SELECT 1 FROM storefront_products WHERE name = 'Sugarfixture Private'$q$, 0);

  -- Public visibility ----------------------------------------------------------------
  PERFORM t.count_is('anon sees published items of live shops only', '', 'anon',
    $q$SELECT 1 FROM storefront_products WHERE name LIKE 'Sugarfixture%'$q$, 2);
  PERFORM t.count_is('customer sees the same (no unpublished, no hidden-shop items)', C, 'authenticated',
    $q$SELECT 1 FROM storefront_products WHERE name LIKE 'Sugarfixture%'$q$, 2);
  PERFORM t.count_is('products_with_stock view obeys RLS for anon (security_invoker)', '', 'anon',
    $q$SELECT 1 FROM products_with_stock WHERE name LIKE 'Sugarfixture%'$q$, 2);
  PERFORM t.count_is('admin sees every item', AD, 'authenticated',
    $q$SELECT 1 FROM storefront_products WHERE name LIKE 'Sugarfixture%'$q$, 4);
  PERFORM t.raises('anon cannot insert items', '', 'anon',
    format($q$INSERT INTO storefront_products (shop_id, name) VALUES (%L, 'Anon')$q$, SA));

  -- Validation constraints ---------------------------------------------------------------
  PERFORM t.raises('negative price rejected', A, 'authenticated', format($q$INSERT INTO storefront_products (shop_id, name, price) VALUES (%L,'x',-1)$q$, SA));
  PERFORM t.raises('absurd price rejected', A, 'authenticated', format($q$INSERT INTO storefront_products (shop_id, name, price) VALUES (%L,'x',99999999)$q$, SA));
  PERFORM t.raises('MRP below price rejected', A, 'authenticated', format($q$INSERT INTO storefront_products (shop_id, name, price, mrp) VALUES (%L,'x',10,5)$q$, SA));
  PERFORM t.raises('blank name rejected', A, 'authenticated', format($q$INSERT INTO storefront_products (shop_id, name) VALUES (%L,'   ')$q$, SA));
  PERFORM t.raises('over-long name rejected', A, 'authenticated', format($q$INSERT INTO storefront_products (shop_id, name) VALUES (%L, repeat('x', 161))$q$, SA));
  PERFORM t.raises('unknown stock status rejected', A, 'authenticated', format($q$INSERT INTO storefront_products (shop_id, name, stock_status) VALUES (%L,'x','plenty')$q$, SA));
  PERFORM t.allowed('price may be left unknown', A, 'authenticated', format($q$INSERT INTO storefront_products (shop_id, name) VALUES (%L,'No Price Item')$q$, SA));
  INSERT INTO t.results SELECT 'unknown price stays NULL (never invented)',
    (SELECT price IS NULL AND stock_status = 'call_to_confirm' AND stock_confirmed_at IS NULL FROM storefront_products WHERE name = 'No Price Item');

  -- Stock confirmation is stamped by the database -------------------------------------------
  PERFORM t.allowed('owner inserts an item claiming a forged old confirmation time', A, 'authenticated',
    format($q$INSERT INTO storefront_products (shop_id, name, stock_status, stock_confirmed_at) VALUES (%L,'Forged Stock','in_stock','2000-01-01')$q$, SA));
  INSERT INTO t.results SELECT 'forged confirmation time on insert is replaced by now()',
    (SELECT stock_confirmed_at = now() FROM storefront_products WHERE name = 'Forged Stock');
  INSERT INTO t.results SELECT 'insert as in_stock/out_of_stock stamps a confirmation time',
    (SELECT stock_confirmed_at IS NOT NULL FROM storefront_products WHERE id = '40000000-0000-0000-0000-0000000000a4');
  INSERT INTO t.results SELECT 'insert as call_to_confirm has no confirmation time',
    (SELECT stock_confirmed_at IS NULL FROM storefront_products WHERE id = '40000000-0000-0000-0000-0000000000a3');

  UPDATE storefront_products SET stock_confirmed_at = now() - interval '5 days' WHERE id = '40000000-0000-0000-0000-0000000000a1';  -- superuser backdating
  INSERT INTO t.results SELECT 'view reports stale in_stock as call_to_confirm (stock_status unchanged)',
    (SELECT stock_status = 'in_stock' AND effective_stock_status = 'call_to_confirm' FROM products_with_stock WHERE id = '40000000-0000-0000-0000-0000000000a1');
  PERFORM t.allowed('owner re-confirms stock by touching stock_confirmed_at with a forged old value', A, 'authenticated',
    $q$UPDATE storefront_products SET stock_confirmed_at = '2000-01-01' WHERE id = '40000000-0000-0000-0000-0000000000a1'$q$);
  INSERT INTO t.results SELECT 'client-supplied confirmation time is ignored; now() is stored',
    (SELECT stock_confirmed_at = now() AND effective_stock_status = 'in_stock' FROM products_with_stock WHERE id = '40000000-0000-0000-0000-0000000000a1');
  PERFORM t.allowed('owner changes status to out_of_stock', A, 'authenticated',
    $q$UPDATE storefront_products SET stock_status = 'out_of_stock' WHERE id = '40000000-0000-0000-0000-0000000000a1'$q$);
  INSERT INTO t.results SELECT 'status change stamps the confirmation time',
    (SELECT stock_confirmed_at = now() AND effective_stock_status = 'out_of_stock' FROM products_with_stock WHERE id = '40000000-0000-0000-0000-0000000000a1');
  PERFORM t.allowed('owner resets to call_to_confirm', A, 'authenticated',
    $q$UPDATE storefront_products SET stock_status = 'call_to_confirm' WHERE id = '40000000-0000-0000-0000-0000000000a1'$q$);
  INSERT INTO t.results SELECT 'call_to_confirm clears the confirmation time',
    (SELECT stock_confirmed_at IS NULL AND effective_stock_status = 'call_to_confirm' FROM products_with_stock WHERE id = '40000000-0000-0000-0000-0000000000a1');
  UPDATE storefront_products SET stock_status = 'in_stock' WHERE id = '40000000-0000-0000-0000-0000000000a1';  -- restore for later checks

  INSERT INTO t.results VALUES ('effective stock: fresh in_stock stays in_stock', product_effective_stock('in_stock', now()) = 'in_stock');
  INSERT INTO t.results VALUES ('effective stock: fresh out_of_stock stays out_of_stock', product_effective_stock('out_of_stock', now() - interval '1 day') = 'out_of_stock');
  INSERT INTO t.results VALUES ('effective stock: 4-day-old in_stock becomes call_to_confirm', product_effective_stock('in_stock', now() - interval '4 days') = 'call_to_confirm');
  INSERT INTO t.results VALUES ('effective stock: 4-day-old out_of_stock becomes call_to_confirm', product_effective_stock('out_of_stock', now() - interval '4 days') = 'call_to_confirm');
  INSERT INTO t.results VALUES ('effective stock: unconfirmed in_stock becomes call_to_confirm', product_effective_stock('in_stock', NULL) = 'call_to_confirm');
  INSERT INTO t.results VALUES ('effective stock: call_to_confirm stays call_to_confirm', product_effective_stock('call_to_confirm', now()) = 'call_to_confirm');

  -- Per-shop limit ------------------------------------------------------------------------------
  INSERT INTO storefront_products (shop_id, name)
    SELECT '20000000-0000-0000-0000-0000000000f1', 'Bulk ' || g FROM generate_series(1, 500) g;
  PERFORM t.raises('the 501st item in a shop is refused', A, 'authenticated',
    $q$INSERT INTO storefront_products (shop_id, name) VALUES ('20000000-0000-0000-0000-0000000000f1', 'One too many')$q$);
  PERFORM t.allowed('another shop is unaffected by that limit', A, 'authenticated',
    format($q$INSERT INTO storefront_products (shop_id, name) VALUES (%L, 'Still fine')$q$, SA));
  DELETE FROM storefront_products WHERE shop_id = '20000000-0000-0000-0000-0000000000f1';

  -- Search: shops find items, items are found directly ------------------------------------------------
  INSERT INTO t.results SELECT 'shop search finds a shop by an item it lists',
    EXISTS (SELECT 1 FROM search_storefronts('sugarfixture') WHERE slug = 'cat-shop-a')
    AND EXISTS (SELECT 1 FROM search_storefronts('sugarfixture') WHERE slug = 'cat-shop-b');
  INSERT INTO t.results SELECT 'shop search ignores unpublished items and hidden shops',
    NOT EXISTS (SELECT 1 FROM search_storefronts('Private') WHERE slug = 'cat-shop-a')
    AND NOT EXISTS (SELECT 1 FROM search_storefronts('sugarfixture') WHERE slug = 'cat-shop-h');
  INSERT INTO t.results SELECT 'shop search finds a shop by a Telugu item name',
    EXISTS (SELECT 1 FROM search_storefronts('బెల్లంఫిక్స్చర్') WHERE slug = 'cat-shop-a');
  PERFORM t.count_is('search_products: anon finds only published items of live shops', '', 'anon',
    $q$SELECT * FROM search_products('sugarfixture')$q$, 2);
  PERFORM t.count_is('search_products: unpublished item never returned', '', 'anon',
    $q$SELECT * FROM search_products('Private')$q$, 0);
  PERFORM t.count_is('search_products: owner of a hidden shop still does not get it in search', B, 'authenticated',
    $q$SELECT * FROM search_products('Branch') WHERE storefront_slug = 'cat-shop-h'$q$, 0);
  PERFORM t.count_is('search_products: admin does not get hidden-shop items in public search either', AD, 'authenticated',
    $q$SELECT * FROM search_products('sugarfixture') WHERE storefront_slug = 'cat-shop-h'$q$, 0);
  PERFORM t.count_is('search_products: Telugu item name', '', 'anon',
    $q$SELECT * FROM search_products('బెల్లంఫిక్స్చర్')$q$, 1);
  PERFORM t.count_is('search_products: blank query returns nothing (no browse-all)', '', 'anon', $q$SELECT * FROM search_products('   ')$q$, 0);
  PERFORM t.count_is('search_products: wildcard-only input is literal, not "match everything"', '', 'anon', $q$SELECT * FROM search_products('%')$q$, 0);
  PERFORM t.count_is('search_products: underscore-only input is literal', '', 'anon', $q$SELECT * FROM search_products('_')$q$, 0);
  PERFORM t.count_is('search_products: misspelling falls back to fuzzy match', '', 'anon', $q$SELECT * FROM search_products('basmat rice')$q$, 1);
  PERFORM t.count_is('search_products: locality filter', '', 'anon',
    format($q$SELECT * FROM search_products('sugarfixture', (SELECT locality_id FROM shops WHERE id = %L))$q$, SB), 1);
  INSERT INTO t.results SELECT 'search_products: price ascending, unknown prices last',
    (SELECT array_agg(price) FROM search_products('fixture', NULL, NULL, 'price_asc')) = ARRAY[30, 45, NULL]::numeric[];
  INSERT INTO t.results SELECT 'search_products: price descending, unknown prices still last',
    (SELECT array_agg(price) FROM search_products('fixture', NULL, NULL, 'price_desc')) = ARRAY[45, 30, NULL]::numeric[];
  INSERT INTO t.results SELECT 'search_products: unknown sort falls back to relevance, does not error',
    (SELECT count(*) FROM search_products('fixture', NULL, NULL, 'drop table')) = 3;
  INSERT INTO t.results SELECT 'search_products: fresh stock label is returned',
    (SELECT effective_stock_status FROM search_products('Basmati') LIMIT 1) = 'out_of_stock';
  UPDATE storefront_products SET stock_confirmed_at = now() - interval '5 days' WHERE id = '40000000-0000-0000-0000-0000000000a4';
  INSERT INTO t.results SELECT 'search_products: stale stock is reported as call_to_confirm, not the old claim',
    (SELECT effective_stock_status FROM search_products('Basmati') LIMIT 1) = 'call_to_confirm';

  -- Unpublishing / deleting an item removes it from search at once -----------------------------------
  UPDATE storefront_products SET is_published = false WHERE id = '40000000-0000-0000-0000-0000000000a3';
  INSERT INTO t.results SELECT 'unpublished item leaves shop search and item search',
    NOT EXISTS (SELECT 1 FROM search_storefronts('బెల్లంఫిక్స్చర్') WHERE slug = 'cat-shop-a')
    AND NOT EXISTS (SELECT 1 FROM search_products('బెల్లంఫిక్స్చర్'));
  DELETE FROM storefront_products WHERE id = '40000000-0000-0000-0000-0000000000a1';
  INSERT INTO t.results SELECT 'deleted item leaves item search',
    NOT EXISTS (SELECT 1 FROM search_products('Loose'));

  -- Admin moderation of storefronts ------------------------------------------------------------------
  PERFORM t.raises('owner cannot call set_storefront_visibility', A, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'suspended','no reason really')$q$, FA));
  PERFORM t.raises('employee cannot call set_storefront_visibility', E, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'suspended','no reason really')$q$, FA));
  PERFORM t.raises('customer cannot call set_storefront_visibility', C, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'suspended','no reason really')$q$, FA));
  PERFORM t.raises('anon cannot call set_storefront_visibility', '', 'anon', format($q$SELECT set_storefront_visibility(%L,'suspended','no reason really')$q$, FA));
  PERFORM t.raises('owner cannot hide their own page by direct update', A, 'authenticated', format($q$UPDATE storefronts SET visibility_status = 'hidden' WHERE id = %L$q$, FA));
  PERFORM t.raises('owner cannot write the moderation reason', A, 'authenticated', format($q$UPDATE storefronts SET visibility_reason = 'x' WHERE id = %L$q$, FA));
  PERFORM t.raises('owner cannot forge who changed visibility', A, 'authenticated', format($q$UPDATE storefronts SET visibility_changed_by = %L WHERE id = %L$q$, A, FA));
  PERFORM t.raises('hiding requires a reason', AD, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'hidden',NULL)$q$, FA));
  PERFORM t.raises('a 2-character reason is refused', AD, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'suspended','ab')$q$, FA));
  PERFORM t.raises('an unknown status is refused', AD, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'banned','some reason')$q$, FA));
  PERFORM t.raises('an over-long reason is refused', AD, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'hidden',repeat('x',501))$q$, FA));
  PERFORM t.raises('an unknown storefront is refused', AD, 'authenticated', $q$SELECT set_storefront_visibility('99999999-9999-4999-8999-999999999999','hidden','some reason')$q$);
  INSERT INTO t.results SELECT 'refused attempts changed nothing',
    (SELECT visibility_status = 'visible' AND visibility_reason IS NULL FROM storefronts WHERE id = FA::uuid)
    AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE action LIKE 'storefront.%');

  PERFORM t.allowed('admin suspends a storefront with a reason', AD, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'suspended','Fraud report 123')$q$, FA));
  PERFORM t.count_is('suspended storefront disappears for anon', '', 'anon', format($q$SELECT 1 FROM storefronts WHERE id = %L$q$, FA), 0);
  PERFORM t.count_is('suspended shop''s items disappear for anon', '', 'anon', $q$SELECT 1 FROM storefront_products WHERE name = 'Jaggery Fixture' OR name = 'Basmati Rice'$q$, 0);
  PERFORM t.count_is('suspended shop leaves shop search', '', 'anon', $q$SELECT 1 FROM search_storefronts('Basmati') WHERE slug = 'cat-shop-a'$q$, 0);
  PERFORM t.count_is('suspended shop leaves item search', '', 'anon', $q$SELECT 1 FROM search_products('Basmati')$q$, 0);
  PERFORM t.count_is('the owner still sees the suspension and the reason', A, 'authenticated',
    format($q$SELECT 1 FROM storefronts WHERE id = %L AND visibility_status = 'suspended' AND visibility_reason = 'Fraud report 123'$q$, FA), 1);
  PERFORM t.raises('the owner cannot lift a suspension themselves', A, 'authenticated', format($q$UPDATE storefronts SET visibility_status = 'visible' WHERE id = %L$q$, FA));
  INSERT INTO t.results SELECT 'suspension is audited with actor, reason and states',
    EXISTS (SELECT 1 FROM audit_logs WHERE action = 'storefront.suspended' AND entity_type = 'storefront' AND entity_id = FA::uuid
            AND actor_id = AD::uuid AND reason = 'Fraud report 123'
            AND previous_state->>'visibility_status' = 'visible' AND new_state->>'visibility_status' = 'suspended');

  PERFORM t.allowed('suspending again is idempotent', AD, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'suspended','Fraud report 123')$q$, FA));
  INSERT INTO t.results SELECT 'idempotent repeat adds no second audit row',
    (SELECT count(*) FROM audit_logs WHERE action = 'storefront.suspended' AND entity_id = FA::uuid) = 1;

  PERFORM t.allowed('admin moves it from suspended to hidden', AD, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'hidden','Awaiting documents')$q$, FA));
  INSERT INTO t.results SELECT 'hidden replaces the stored reason',
    (SELECT visibility_status = 'hidden' AND visibility_reason = 'Awaiting documents' AND visibility_changed_by = AD::uuid AND visibility_changed_at IS NOT NULL FROM storefronts WHERE id = FA::uuid);

  PERFORM t.allowed('admin reactivates without a reason', AD, 'authenticated', format($q$SELECT set_storefront_visibility(%L,'visible',NULL)$q$, FA));
  PERFORM t.count_is('reactivated storefront is public again', '', 'anon', format($q$SELECT 1 FROM storefronts WHERE id = %L$q$, FA), 1);
  PERFORM t.count_is('reactivated shop is searchable again', '', 'anon', $q$SELECT 1 FROM search_storefronts('Basmati') WHERE slug = 'cat-shop-a'$q$, 1);
  PERFORM t.count_is('reactivated shop''s items are searchable again', '', 'anon', $q$SELECT 1 FROM search_products('Basmati')$q$, 1);
  INSERT INTO t.results SELECT 'reactivation clears the stored reason (nothing leaks to the public row)',
    (SELECT visibility_status = 'visible' AND visibility_reason IS NULL FROM storefronts WHERE id = FA::uuid);
  INSERT INTO t.results SELECT 'every change was audited (suspended, hidden, visible)',
    (SELECT array_agg(action ORDER BY action) FROM audit_logs WHERE entity_id = FA::uuid AND action LIKE 'storefront.%')
      = ARRAY['storefront.hidden','storefront.suspended','storefront.visible'];
END $$;

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN
    RAISE EXCEPTION 'catalogue/moderation tests failed';
  END IF;
END $$;
ROLLBACK;
