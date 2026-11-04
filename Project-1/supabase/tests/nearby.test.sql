-- Behavioural tests for migration 010: opt-in distance in search_storefronts() and community_stats().
-- Rolled back; raises (non-zero exit) if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000a1','near@example.test','{"full_name":"Near","phone":"+919000000071"}');
INSERT INTO businesses (id, name, primary_owner_id) VALUES ('10000000-0000-0000-0000-0000000000a1','Near Biz','00000000-0000-0000-0000-0000000000a1');
INSERT INTO business_members (business_id, user_id, role) VALUES ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','owner');

-- A at the query point, B about 5 km north, C has no coordinates.
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone, latitude, longitude)
 SELECT x.id::uuid, '10000000-0000-0000-0000-0000000000a1', x.name, x.code,
        (SELECT id FROM categories WHERE slug = 'kirana'), (SELECT id FROM localities ORDER BY slug LIMIT 1), 'addr', x.phone, x.lat, x.lng
 FROM (VALUES
   ('20000000-0000-0000-0000-0000000000a1','Nearfixture A','A1','+919100000071', 17.2473::numeric, 80.1514::numeric),
   ('20000000-0000-0000-0000-0000000000a2','Nearfixture B','B1','+919100000072', 17.2923::numeric, 80.1514::numeric),
   ('20000000-0000-0000-0000-0000000000a3','Nearfixture C','C1','+919100000073', NULL::numeric, NULL::numeric)
 ) AS x(id, name, code, phone, lat, lng);
INSERT INTO storefronts (id, shop_id, slug, is_published, visibility_status, template_name) VALUES
 ('30000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-0000000000a1','nearfixture-a', true, 'visible', 'grocery'),
 ('30000000-0000-0000-0000-0000000000a2','20000000-0000-0000-0000-0000000000a2','nearfixture-b', true, 'visible', 'grocery'),
 ('30000000-0000-0000-0000-0000000000a3','20000000-0000-0000-0000-0000000000a3','nearfixture-c', true, 'visible', 'grocery');

SET LOCAL ROLE anon;
-- Without coordinates nothing changes: distance is NULL.
INSERT INTO t.results SELECT 'without coordinates distance_km is NULL',
  (SELECT bool_and(distance_km IS NULL) FROM search_storefronts('Nearfixture'));
-- With coordinates: A ~0 km, B ~5 km, C unknown.
INSERT INTO t.results SELECT 'distance to a shop at the same point is ~0 km',
  (SELECT distance_km < 0.05 FROM search_storefronts('Nearfixture', NULL, NULL, NULL, 'relevance', 12, 0, 17.2473, 80.1514) WHERE shop_name = 'Nearfixture A');
INSERT INTO t.results SELECT 'distance to a shop 0.045 degrees north is about 5 km',
  (SELECT distance_km BETWEEN 4.8 AND 5.2 FROM search_storefronts('Nearfixture', NULL, NULL, NULL, 'relevance', 12, 0, 17.2473, 80.1514) WHERE shop_name = 'Nearfixture B');
INSERT INTO t.results SELECT 'a shop without coordinates has NULL distance, never a guess',
  (SELECT distance_km IS NULL FROM search_storefronts('Nearfixture', NULL, NULL, NULL, 'relevance', 12, 0, 17.2473, 80.1514) WHERE shop_name = 'Nearfixture C');
INSERT INTO t.results SELECT 'sort nearest from point A puts A before B before C',
  (SELECT string_agg(right(shop_name, 1), '' ORDER BY ord) = 'ABC'
     FROM (SELECT shop_name, row_number() OVER () AS ord FROM search_storefronts('Nearfixture', NULL, NULL, NULL, 'nearest', 12, 0, 17.2473, 80.1514)) s);
INSERT INTO t.results SELECT 'sort nearest without coordinates falls back safely (no error, rows returned)',
  (SELECT count(*) = 3 FROM search_storefronts('Nearfixture', NULL, NULL, NULL, 'nearest', 12, 0));
INSERT INTO t.results SELECT 'out-of-range coordinates are ignored, not trusted',
  (SELECT bool_and(distance_km IS NULL) FROM search_storefronts('Nearfixture', NULL, NULL, NULL, 'relevance', 12, 0, 123.0, 500.0));

-- Community stats ---------------------------------------------------------------------------
INSERT INTO t.results SELECT 'community_stats counts live non-sample shops per area',
  (SELECT sum(shop_count) >= 3 FROM community_stats());
INSERT INTO t.results SELECT 'recently created shops count as joined in the last 30 days',
  (SELECT sum(joined_30d) >= 3 FROM community_stats());
RESET ROLE;

UPDATE storefronts SET is_sample = true WHERE slug = 'nearfixture-a';
UPDATE storefronts SET visibility_status = 'hidden' WHERE slug = 'nearfixture-b';
SET LOCAL ROLE anon;
INSERT INTO t.results SELECT 'sample and hidden storefronts are excluded from community stats',
  (SELECT sum(shop_count) FROM community_stats()) = (SELECT count(*) FROM storefronts sf JOIN shops s ON s.id = sf.shop_id
     WHERE sf.is_published AND sf.visibility_status = 'visible' AND NOT sf.is_sample AND s.is_active);
INSERT INTO t.results SELECT 'community_stats lists areas even with zero shops',
  (SELECT count(*) = (SELECT count(*) FROM localities WHERE is_active) FROM community_stats());
RESET ROLE;

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN RAISE EXCEPTION 'nearby tests failed'; END IF; END $$;
ROLLBACK;
