-- Structural security invariants (migration 008 and earlier). These guard against a future migration
-- silently adding a table without RLS, a SECURITY DEFINER function without a pinned search_path, or
-- a privilege that lets anon write. Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE results (name TEXT, pass BOOLEAN);

INSERT INTO results SELECT 'every public table has row-level security enabled',
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity);

INSERT INTO results SELECT 'every SECURITY DEFINER function pins search_path (no search-path hijack)',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosecdef AND (p.proconfig IS NULL OR p.proconfig::text NOT LIKE '%search_path%'));

INSERT INTO results SELECT 'anon has no INSERT/UPDATE/DELETE/TRUNCATE on any public table or view',
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE grantee = 'anon' AND table_schema = 'public' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE'));

INSERT INTO results SELECT 'authenticated has no TRUNCATE (not subject to RLS) on any public table',
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE grantee = 'authenticated' AND table_schema = 'public' AND privilege_type = 'TRUNCATE');

INSERT INTO results SELECT 'clients cannot write through the products view',
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE grantee IN ('anon','authenticated') AND table_name = 'products_with_stock' AND privilege_type IN ('INSERT','UPDATE','DELETE'));

-- Default privileges: a table created by a future migration must not hand anon write access.
CREATE TABLE public.zz_future_table (id INT);
INSERT INTO results SELECT 'a newly created table gives anon no write access (default privileges)',
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_name = 'zz_future_table' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE'));
INSERT INTO results SELECT 'a newly created table gives authenticated no TRUNCATE (default privileges)',
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee = 'authenticated' AND table_name = 'zz_future_table' AND privilege_type = 'TRUNCATE');
DROP TABLE public.zz_future_table;

-- Privileged functions are not reachable by anon at all.
INSERT INTO results SELECT 'anon cannot execute ' || fn,
  NOT has_function_privilege('anon', fn, 'EXECUTE')
FROM unnest(ARRAY[
  'public.approve_merchant_application(uuid,text,uuid,text)',
  'public.review_merchant_application(uuid,text,text)',
  'public.submit_merchant_application(uuid)',
  'public.find_application_duplicates(uuid)',
  'public.cancel_help_request(uuid)',
  'public.update_help_request(uuid,text,text,text)',
  'public.set_storefront_visibility(uuid,text,text)',
  'public.bootstrap_first_admin(text)']) AS fn;
INSERT INTO results SELECT 'authenticated cannot execute bootstrap_first_admin (service role only)',
  NOT has_function_privilege('authenticated', 'public.bootstrap_first_admin(text)', 'EXECUTE');

-- Help Me Find It throttle holds even when the function is bypassed (the race-free trigger, migration 008).
INSERT INTO localities (name, slug, district, pincode) VALUES ('Zz Throttle Area', 'zz-throttle-area', 'Khammam', '507001') ON CONFLICT DO NOTHING;
DO $$
DECLARE loc UUID := (SELECT id FROM localities WHERE slug = 'zz-throttle-area'); ok BOOLEAN := false; i INT;
BEGIN
  FOR i IN 1..5 LOOP
    INSERT INTO help_me_find_it_requests (tracking_id, item_name, preferred_locality_id, contact_name, contact_phone, consent_given)
    VALUES ('HMF-TST-209901-000' || i, 'item', loc, 'T', '+919000099999', true);
  END LOOP;
  BEGIN
    INSERT INTO help_me_find_it_requests (tracking_id, item_name, preferred_locality_id, contact_name, contact_phone, consent_given)
    VALUES ('HMF-TST-209901-0006', 'item', loc, 'T', '+919000099999', true);
  EXCEPTION WHEN program_limit_exceeded THEN ok := true;
  END;
  INSERT INTO pg_temp.results VALUES ('the 6th request for one phone within an hour is refused by the table trigger', ok);
  INSERT INTO help_me_find_it_requests (tracking_id, item_name, preferred_locality_id, contact_name, contact_phone, consent_given)
  VALUES ('HMF-TST-209901-0007', 'item', loc, 'T', '+919000088888', true);
  INSERT INTO pg_temp.results VALUES ('a different phone is unaffected', true);
END $$;

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_temp.results WHERE NOT pass) THEN RAISE EXCEPTION 'hardening tests failed'; END IF; END $$;
ROLLBACK;