-- Behavioural tests for migration 018: search aliases (AC-12), feature-flag toggle (AC-19). Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000e1','boss@example.test','{"full_name":"Boss","phone":"+919000000081"}'),
 ('00000000-0000-0000-0000-0000000000e2','cust@example.test','{"full_name":"Cust","phone":"+919000000082"}'),
 ('00000000-0000-0000-0000-0000000000e3','op@example.test','{"full_name":"Op","phone":"+919000000083"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000e1','admin'),('00000000-0000-0000-0000-0000000000e3','operator');

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

-- One published Kirana shop whose name uses the "Lakshmi" spelling.
INSERT INTO localities (name, slug, district, pincode) VALUES ('Zz Alias Area','zz-alias-area','Khammam','507001');
SELECT id AS loc FROM localities WHERE slug = 'zz-alias-area' \gset
SELECT id AS kirana FROM categories WHERE slug = 'kirana' \gset
INSERT INTO businesses (id, name, primary_owner_id) VALUES ('10000000-0000-0000-0000-0000000000e1','Biz','00000000-0000-0000-0000-0000000000e2');
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone) VALUES
 ('20000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000e1','Sri Lakshmi Stores','L',:'kirana',:'loc','1 Main Road','+919100000201');
INSERT INTO storefronts (shop_id, slug, is_published, visibility_status) VALUES ('20000000-0000-0000-0000-0000000000e1','zz-sri-lakshmi',true,'visible');

-- ---- The seeded starter list ----------------------------------------------------------------------------------
INSERT INTO t.results SELECT 'starter aliases are present in both directions',
  EXISTS (SELECT 1 FROM search_aliases WHERE term='lakshmi' AND alias='laxmi') AND EXISTS (SELECT 1 FROM search_aliases WHERE term='laxmi' AND alias='lakshmi');
INSERT INTO t.results SELECT 'no alias is stored with capitals, blanks or equal to its term',
  NOT EXISTS (SELECT 1 FROM search_aliases WHERE term <> LOWER(BTRIM(term)) OR alias <> LOWER(BTRIM(alias)) OR term = alias);

-- ---- Customers find the shop under the other spelling and in Telugu -----------------------------------------------
SELECT t.act(NULL, 'anon');
SELECT count(*) AS n_exact FROM search_storefronts('lakshmi') WHERE slug = 'zz-sri-lakshmi' \gset
SELECT count(*) AS n_laxmi FROM search_storefronts('laxmi') WHERE slug = 'zz-sri-lakshmi' \gset
SELECT count(*) AS n_shree FROM search_storefronts('shree') WHERE slug = 'zz-sri-lakshmi' \gset
SELECT count(*) AS n_te FROM search_storefronts('కిరాణా') WHERE slug = 'zz-sri-lakshmi' \gset
SELECT count(*) AS n_grocery FROM search_storefronts('grocery') WHERE slug = 'zz-sri-lakshmi' \gset
SELECT count(*) AS n_combo FROM search_storefronts('shree laxmi') WHERE slug = 'zz-sri-lakshmi' \gset
SELECT count(*) AS n_other FROM search_storefronts('pharmacy') WHERE slug = 'zz-sri-lakshmi' \gset
SELECT count(*) AS n_medical FROM search_storefronts('medical') WHERE slug = 'zz-sri-lakshmi' \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the real spelling still matches', :n_exact = 1;
INSERT INTO t.results SELECT 'the alternative spelling "laxmi" finds "Lakshmi"', :n_laxmi = 1;
INSERT INTO t.results SELECT '"shree" finds "Sri"', :n_shree = 1;
INSERT INTO t.results SELECT 'the Telugu word for kirana finds a Kirana shop', :n_te = 1;
INSERT INTO t.results SELECT '"grocery" finds a Kirana shop', :n_grocery = 1;
INSERT INTO t.results SELECT 'two variant words in one query both resolve (AND semantics kept)', :n_combo = 1;
INSERT INTO t.results SELECT 'aliases do not make unrelated categories match ("pharmacy" does not find a Kirana shop)', :n_other = 0;
INSERT INTO t.results SELECT '"medical" does not find a Kirana shop', :n_medical = 0;

-- ---- Only administrators manage them -------------------------------------------------------------------------
SELECT t.raises('anon cannot read the alias table', NULL, 'anon', $$SELECT * FROM search_aliases$$);
SELECT t.raises('a customer cannot add an alias', '00000000-0000-0000-0000-0000000000e2', 'authenticated', $$SELECT public.admin_add_search_alias('foo','bar')$$);
SELECT t.raises('an operator cannot add an alias', '00000000-0000-0000-0000-0000000000e3', 'authenticated', $$SELECT public.admin_add_search_alias('foo','bar')$$);
SELECT t.raises('anon cannot add an alias', NULL, 'anon', $$SELECT public.admin_add_search_alias('foo','bar')$$);
SELECT t.raises('anon cannot remove an alias', NULL, 'anon', $$SELECT public.admin_remove_search_alias('00000000-0000-0000-0000-000000000000')$$);
SELECT t.raises('a customer cannot remove an alias', '00000000-0000-0000-0000-0000000000e2', 'authenticated', $$SELECT public.admin_remove_search_alias('00000000-0000-0000-0000-000000000000')$$);
SELECT t.raises('a customer cannot write the table directly', '00000000-0000-0000-0000-0000000000e2', 'authenticated', $$INSERT INTO search_aliases (term, alias) VALUES ('hack','hack2')$$);
SELECT t.raises('an administrator cannot write the table directly either (audited functions only)', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$INSERT INTO search_aliases (term, alias) VALUES ('hack','hack2')$$);
SELECT t.act('00000000-0000-0000-0000-0000000000e2', 'authenticated');
SELECT count(*) AS n_cust_sees FROM search_aliases \gset
RESET ROLE;
SELECT t.act('00000000-0000-0000-0000-0000000000e1', 'authenticated');
SELECT count(*) AS n_admin_sees FROM search_aliases \gset
RESET ROLE;
INSERT INTO t.results SELECT 'a customer sees zero aliases (row-level security) while an administrator sees them', :n_cust_sees = 0 AND :n_admin_sees > 20;

-- ---- Validation ----------------------------------------------------------------------------------------------
SELECT t.raises('a word and itself is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT public.admin_add_search_alias('Same ','same')$$);
SELECT t.raises('a one-letter word is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT public.admin_add_search_alias('a','bb')$$);
SELECT t.raises('an empty word is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT public.admin_add_search_alias('  ','bb')$$);
SELECT t.raises('a 61-character word is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', format($q$SELECT public.admin_add_search_alias(%L,'bb')$q$, repeat('x', 61)));

-- ---- Add: both ways, normalised, audited, reindexes existing shops ----------------------------------------------
SELECT t.act('00000000-0000-0000-0000-0000000000e1', 'authenticated');
SELECT public.admin_add_search_alias('  Stores ', 'DUKAAN') AS added \gset
SELECT public.admin_add_search_alias('stores', 'dukaan') AS added_again \gset
SELECT count(*) AS n_dukaan FROM search_storefronts('dukaan') WHERE slug = 'zz-sri-lakshmi' \gset
RESET ROLE;
INSERT INTO t.results SELECT 'adding a pair stores both directions and reports 2', :added = 2;
INSERT INTO t.results SELECT 'adding the same pair again changes nothing and reports 0', :added_again = 0;
INSERT INTO t.results SELECT 'the pair was stored lower-cased and trimmed', EXISTS (SELECT 1 FROM search_aliases WHERE term='stores' AND alias='dukaan');
INSERT INTO t.results SELECT 'an existing shop is re-indexed at once (found by the new word)', :n_dukaan = 1;
INSERT INTO t.results SELECT 'exactly one audit row for the effective add (none for the no-op)', (SELECT count(*) FROM audit_logs WHERE action = 'search_alias.added' AND new_state->>'term' = 'stores') = 1;

-- ---- Remove: stops matching, audited, safe to repeat ------------------------------------------------------------
SELECT id AS alias_id FROM search_aliases WHERE term = 'stores' AND alias = 'dukaan' \gset
SELECT t.act('00000000-0000-0000-0000-0000000000e1', 'authenticated');
SELECT public.admin_remove_search_alias(:'alias_id') AS removed \gset
SELECT public.admin_remove_search_alias(:'alias_id') AS removed_again \gset
SELECT count(*) AS n_dukaan2 FROM search_storefronts('dukaan') WHERE slug = 'zz-sri-lakshmi' \gset
RESET ROLE;
INSERT INTO t.results SELECT 'removing returns true, removing again returns false', :'removed' = 't' AND :'removed_again' = 'f';
INSERT INTO t.results SELECT 'the removed word no longer finds the shop', :n_dukaan2 = 0;
INSERT INTO t.results SELECT 'the reverse pair is untouched (one direction removed on purpose)', EXISTS (SELECT 1 FROM search_aliases WHERE term='dukaan' AND alias='stores');
INSERT INTO t.results SELECT 'the removal is audited', (SELECT count(*) FROM audit_logs WHERE action = 'search_alias.removed' AND entity_id = :'alias_id') = 1;

-- ---- A new shop picks up aliases when it is created (not only at alias-edit time) --------------------------------
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone) VALUES
 ('20000000-0000-0000-0000-0000000000e2','10000000-0000-0000-0000-0000000000e1','Maha Laxmi Traders','M',:'kirana',:'loc','2 Main Road','+919100000202');
INSERT INTO storefronts (shop_id, slug, is_published, visibility_status) VALUES ('20000000-0000-0000-0000-0000000000e2','zz-maha-laxmi',true,'visible');
SELECT t.act(NULL, 'anon');
SELECT count(*) AS n_new FROM search_storefronts('lakshmi') WHERE slug = 'zz-maha-laxmi' \gset
RESET ROLE;
INSERT INTO t.results SELECT 'a shop created later is found under the other spelling too', :n_new = 1;

-- ---- Feature flags ---------------------------------------------------------------------------------------------
INSERT INTO t.results SELECT 'the two documented module flags exist and ship disabled',
  (SELECT count(*) FROM feature_flags WHERE key IN ('grocery','shared_delivery') AND NOT is_enabled AND enabled_localities = '{}') = 2;
SELECT t.raises('anon cannot toggle a flag', NULL, 'anon', $$SELECT public.admin_set_feature_flag('grocery', true)$$);
SELECT t.raises('a customer cannot toggle a flag', '00000000-0000-0000-0000-0000000000e2', 'authenticated', $$SELECT public.admin_set_feature_flag('grocery', true)$$);
SELECT t.raises('an operator cannot toggle a flag', '00000000-0000-0000-0000-0000000000e3', 'authenticated', $$SELECT public.admin_set_feature_flag('grocery', true)$$);
-- Row-level security hides the rows from a customer, so a direct UPDATE does not raise; it changes zero rows.
SELECT t.act('00000000-0000-0000-0000-0000000000e2', 'authenticated');
WITH u AS (UPDATE feature_flags SET is_enabled = true RETURNING 1) SELECT count(*) AS n_cust_upd FROM u \gset
RESET ROLE;
INSERT INTO t.results SELECT 'a customer cannot update a flag directly (0 rows changed, flags still off)',
  :n_cust_upd = 0 AND NOT EXISTS (SELECT 1 FROM feature_flags WHERE is_enabled);
SELECT t.raises('an unknown flag is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT public.admin_set_feature_flag('no_such_module', true)$$);
SELECT t.raises('an unknown area is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT public.admin_set_feature_flag('grocery', true, ARRAY['00000000-0000-0000-0000-00000000dead']::uuid[])$$);
SELECT t.raises('NULL for enabled is refused', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT public.admin_set_feature_flag('grocery', NULL)$$);

SELECT t.act('00000000-0000-0000-0000-0000000000e1', 'authenticated');
SELECT public.admin_set_feature_flag('grocery', true, ARRAY[:'loc']::uuid[], 'pilot in one area') AS f1 \gset
SELECT public.admin_set_feature_flag('grocery', true, ARRAY[:'loc', :'loc']::uuid[]) AS f2 \gset
RESET ROLE;
INSERT INTO t.results SELECT 'an administrator can enable a flag for one area', :'f1' = 'changed' AND (SELECT is_enabled AND enabled_localities = ARRAY[:'loc']::uuid[] FROM feature_flags WHERE key = 'grocery');
INSERT INTO t.results SELECT 'repeating the same setting (even with a duplicated area) is "unchanged"', :'f2' = 'unchanged';
INSERT INTO t.results SELECT 'one audit row with before and after and the reason',
  (SELECT count(*) FROM audit_logs WHERE action = 'feature_flag.changed' AND new_state->>'key' = 'grocery' AND reason = 'pilot in one area'
      AND (previous_state->>'is_enabled')::boolean = false AND (new_state->>'is_enabled')::boolean = true) = 1;
INSERT INTO t.results SELECT 'the other flag was not touched', (SELECT NOT is_enabled FROM feature_flags WHERE key = 'shared_delivery');
SELECT t.act(NULL, 'anon');
SELECT count(*) AS n_flags FROM feature_flags \gset
RESET ROLE;
INSERT INTO t.results SELECT 'flags remain publicly readable (the homepage needs them)', :n_flags >= 2;

SELECT result, name FROM (SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results) r ORDER BY name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass OR pass IS NULL) THEN RAISE EXCEPTION 'search alias tests failed'; END IF; END $$;
ROLLBACK;
