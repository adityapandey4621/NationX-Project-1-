-- Behavioural tests for migrations 001-003. Runs inside a transaction that is
-- rolled back. Exits non-zero (via exception) if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;

-- Fixtures (superuser). Accounts are created the way Supabase Auth does it:
-- by inserting into auth.users, which fires the profile trigger.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-00000000000a','a@example.test','{"full_name":"Merchant A","phone":"+919000000001"}'),
 ('00000000-0000-0000-0000-00000000000b','b@example.test','{"full_name":"Merchant B","phone":"+919000000002"}'),
 ('00000000-0000-0000-0000-0000000000ad','admin@example.test','{"full_name":"Admin","phone":"+919000000003"}'),
 ('00000000-0000-0000-0000-0000000000c1','c@example.test','{"full_name":"Customer","phone":"+919000000004"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000ad','admin');
INSERT INTO businesses (id, name, primary_owner_id) VALUES
 ('10000000-0000-0000-0000-00000000000a','Biz A','00000000-0000-0000-0000-00000000000a'),
 ('10000000-0000-0000-0000-00000000000b','Biz B','00000000-0000-0000-0000-00000000000b');
INSERT INTO business_members (business_id, user_id, role) VALUES
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','owner'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','owner');
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT '20000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','Shop A','MAIN',
        (SELECT id FROM categories LIMIT 1),(SELECT id FROM localities LIMIT 1),'addr','+919100000001';
INSERT INTO shops (id, business_id, name, shop_code, category_id, locality_id, address_line, phone)
 SELECT '20000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000b','Shop B','MAIN',
        (SELECT id FROM categories LIMIT 1),(SELECT id FROM localities LIMIT 1),'addr','+919100000002';
INSERT INTO storefronts (shop_id, slug, is_published) VALUES
 ('20000000-0000-0000-0000-00000000000a','shop-a', true),
 ('20000000-0000-0000-0000-00000000000b','shop-b', false);
INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
 VALUES ('00000000-0000-0000-0000-0000000000c1','test','shop','20000000-0000-0000-0000-00000000000a');

-- Helpers -------------------------------------------------------------------
CREATE FUNCTION t.act(uid TEXT, r TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(uid,''), true);
  EXECUTE format('SET LOCAL ROLE %I', r);
END $$;
GRANT EXECUTE ON FUNCTION t.act(TEXT,TEXT) TO anon, authenticated, service_role;

-- Statement must be blocked: raises, or (RLS-filtered) affects 0 rows.
CREATE FUNCTION t.blocked(name TEXT, uid TEXT, r TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n INT; ok BOOLEAN;
BEGIN
  BEGIN
    PERFORM t.act(uid, r); EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT; ok := (n = 0); RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; ok := true;
  END;
  INSERT INTO t.results VALUES (name, ok);
END $$;

-- Statement must be blocked by an ERROR (stricter: rules out silent 0-row filtering).
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
        AD TEXT := '00000000-0000-0000-0000-0000000000ad'; C TEXT := '00000000-0000-0000-0000-0000000000c1';
BEGIN
  -- Identity trigger (003) -----------------------------------------------------
  INSERT INTO t.results SELECT 'signup creates profile with phone from metadata',
    EXISTS (SELECT 1 FROM profiles WHERE id = A::uuid AND phone = '+919000000001' AND email = 'a@example.test');
  INSERT INTO t.results SELECT 'signup grants exactly the customer role',
    (SELECT array_agg(role) FROM user_roles WHERE user_id = A::uuid) = ARRAY['customer'];

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ('00000000-0000-0000-0000-0000000000e1','evil@example.test',
            '{"full_name":"Evil","phone":"+919000000099","role":"admin","roles":["admin"],"is_admin":true}');
    INSERT INTO t.results SELECT 'metadata cannot grant roles (only customer)',
      (SELECT array_agg(role) FROM user_roles WHERE user_id = '00000000-0000-0000-0000-0000000000e1') = ARRAY['customer'];
  END;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000e2','nophone@example.test','{"full_name":"No Phone"}');
    INSERT INTO t.results VALUES ('signup without phone is rejected', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO t.results VALUES ('signup without phone is rejected', true);
  END;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000e3','dup@example.test','{"full_name":"Dup","phone":"+919000000001"}');
    INSERT INTO t.results VALUES ('duplicate phone is rejected', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO t.results VALUES ('duplicate phone is rejected', true);
  END;

  UPDATE auth.users SET email = 'a2@example.test' WHERE id = A::uuid;
  INSERT INTO t.results SELECT 'auth email change syncs to profile',
    EXISTS (SELECT 1 FROM profiles WHERE id = A::uuid AND email = 'a2@example.test');

  -- Role escalation ------------------------------------------------------------
  PERFORM t.raises('user cannot grant self admin', C, 'authenticated', $q$INSERT INTO user_roles(user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c1','admin')$q$);
  PERFORM t.raises('user cannot grant self merchant', C, 'authenticated', $q$INSERT INTO user_roles(user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c1','merchant')$q$);
  PERFORM t.raises('anon cannot grant roles', NULL, 'anon', $q$INSERT INTO user_roles(user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c1','admin')$q$);
  PERFORM t.blocked('user cannot rewrite own role row to admin', C, 'authenticated', $q$UPDATE user_roles SET role='admin' WHERE user_id='00000000-0000-0000-0000-0000000000c1'$q$);
  PERFORM t.blocked('user cannot delete another user''s role', C, 'authenticated', $q$DELETE FROM user_roles WHERE user_id='00000000-0000-0000-0000-0000000000ad'$q$);
  PERFORM t.raises('user cannot call bootstrap_first_admin', C, 'authenticated', $q$SELECT public.bootstrap_first_admin('c@example.test')$q$);
  PERFORM t.raises('anon cannot call bootstrap_first_admin', NULL, 'anon', $q$SELECT public.bootstrap_first_admin('c@example.test')$q$);
  PERFORM t.count_is('user sees own role rows only (customer)', C, 'authenticated', 'SELECT 1 FROM user_roles', 1);
  PERFORM t.count_is('admin sees all role rows', AD, 'authenticated', 'SELECT 1 FROM user_roles', 6);

  -- Profile privacy --------------------------------------------------------------
  PERFORM t.count_is('user sees only own profile', C, 'authenticated', 'SELECT 1 FROM profiles', 1);
  PERFORM t.count_is('admin sees all profiles', AD, 'authenticated', 'SELECT 1 FROM profiles', 5);
  PERFORM t.count_is('anon sees no profiles', NULL, 'anon', 'SELECT 1 FROM profiles', 0);
  PERFORM t.blocked('user cannot edit another profile', C, 'authenticated', $q$UPDATE profiles SET full_name='Hacked' WHERE id='00000000-0000-0000-0000-00000000000a'$q$);
  PERFORM t.blocked('user cannot insert a profile directly', C, 'authenticated', $q$INSERT INTO profiles(id, full_name, phone) VALUES ('00000000-0000-0000-0000-0000000000f1','X','+919000000050')$q$);
  PERFORM t.raises('user cannot deactivate self', C, 'authenticated', $q$UPDATE profiles SET is_active=false WHERE id='00000000-0000-0000-0000-0000000000c1'$q$);
  PERFORM t.allowed('user can edit own profile', C, 'authenticated', $q$UPDATE profiles SET full_name='New' WHERE id='00000000-0000-0000-0000-0000000000c1'$q$);

  -- Public read ----------------------------------------------------------------------
  PERFORM t.count_is('anon sees active localities', NULL, 'anon', 'SELECT 1 FROM localities', 4);
  PERFORM t.count_is('anon sees categories', NULL, 'anon', 'SELECT 1 FROM categories', 5);
  PERFORM t.count_is('anon sees only published storefront', NULL, 'anon', 'SELECT 1 FROM storefronts', 1);
  PERFORM t.count_is('anon sees only publicly visible shop', NULL, 'anon', 'SELECT 1 FROM shops', 1);
  PERFORM t.count_is('anon sees no applications', NULL, 'anon', 'SELECT 1 FROM merchant_applications', 0);
  PERFORM t.count_is('anon sees no audit logs', NULL, 'anon', 'SELECT 1 FROM audit_logs', 0);
  PERFORM t.count_is('anon sees no businesses', NULL, 'anon', 'SELECT 1 FROM businesses', 0);

  -- Tenant isolation -----------------------------------------------------------------------
  PERFORM t.count_is('merchant A sees own shop only (1 shop)', A, 'authenticated', 'SELECT 1 FROM shops', 1);
  PERFORM t.count_is('merchant B sees own unpublished + public shop', B, 'authenticated', 'SELECT 1 FROM shops', 2);
  PERFORM t.count_is('merchant A sees only own business', A, 'authenticated', 'SELECT 1 FROM businesses', 1);
  PERFORM t.blocked('merchant A cannot update shop B', A, 'authenticated', $q$UPDATE shops SET phone='+919999999999' WHERE id='20000000-0000-0000-0000-00000000000b'$q$);
  PERFORM t.allowed('merchant A can update own shop phone', A, 'authenticated', $q$UPDATE shops SET phone='+919999999998' WHERE id='20000000-0000-0000-0000-00000000000a'$q$);
  PERFORM t.raises('merchant A cannot reassign shop to business B', A, 'authenticated', $q$UPDATE shops SET business_id='10000000-0000-0000-0000-00000000000b' WHERE id='20000000-0000-0000-0000-00000000000a'$q$);
  PERFORM t.allowed('merchant A can edit own storefront headline', A, 'authenticated', $q$UPDATE storefronts SET headline='Hello' WHERE shop_id='20000000-0000-0000-0000-00000000000a'$q$);
  PERFORM t.raises('merchant A cannot change own slug', A, 'authenticated', $q$UPDATE storefronts SET slug='hijack' WHERE shop_id='20000000-0000-0000-0000-00000000000a'$q$);
  PERFORM t.raises('merchant A cannot enable ordering', A, 'authenticated', $q$UPDATE storefronts SET ordering_enabled=true WHERE shop_id='20000000-0000-0000-0000-00000000000a'$q$);
  PERFORM t.raises('merchant B cannot publish own storefront', B, 'authenticated', $q$UPDATE storefronts SET is_published=true WHERE shop_id='20000000-0000-0000-0000-00000000000b'$q$);
  PERFORM t.blocked('merchant cannot insert shop directly', A, 'authenticated', $q$INSERT INTO shops(business_id,name,shop_code,category_id,locality_id,address_line,phone) SELECT '10000000-0000-0000-0000-00000000000a','X','X2',(SELECT id FROM categories LIMIT 1),(SELECT id FROM localities LIMIT 1),'a','+919100000009'$q$);

  -- Applications ----------------------------------------------------------------------------------
  PERFORM t.allowed('applicant can insert own draft', A, 'authenticated', format($q$INSERT INTO merchant_applications(applicant_user_id,business_name,category_id,locality_id,contact_phone,address_line1) SELECT %L,'App A',(SELECT id FROM categories LIMIT 1),(SELECT id FROM localities LIMIT 1),'+919100000003','addr'$q$, A));
  PERFORM t.blocked('applicant cannot insert for someone else', A, 'authenticated', format($q$INSERT INTO merchant_applications(applicant_user_id,business_name,category_id,locality_id,contact_phone,address_line1) SELECT %L,'Forged',(SELECT id FROM categories LIMIT 1),(SELECT id FROM localities LIMIT 1),'+919100000003','addr'$q$, B));
  PERFORM t.blocked('applicant cannot insert pre-approved', A, 'authenticated', format($q$INSERT INTO merchant_applications(applicant_user_id,business_name,category_id,locality_id,contact_phone,address_line1,status) SELECT %L,'Sneaky',(SELECT id FROM categories LIMIT 1),(SELECT id FROM localities LIMIT 1),'+919100000003','addr','approved'$q$, A));
  PERFORM t.count_is('B cannot see A application', B, 'authenticated', 'SELECT 1 FROM merchant_applications', 0);
  PERFORM t.count_is('admin sees all applications', AD, 'authenticated', 'SELECT 1 FROM merchant_applications', 1);
  PERFORM t.blocked('applicant cannot self-approve', A, 'authenticated', $q$UPDATE merchant_applications SET status='approved'$q$);
  PERFORM t.raises('applicant cannot set reviewed_by', A, 'authenticated', $q$UPDATE merchant_applications SET reviewed_by='00000000-0000-0000-0000-0000000000ad'$q$);
  PERFORM t.raises('applicant cannot submit by editing status directly', A, 'authenticated', $q$UPDATE merchant_applications SET status='submitted', declaration_accepted=true$q$);
  PERFORM t.blocked('admin cannot bypass the workflow by editing status', AD, 'authenticated', $q$UPDATE merchant_applications SET status='approved', reviewed_by='00000000-0000-0000-0000-0000000000ad'$q$);

  -- Audit immutability -----------------------------------------------------------------------------------
  PERFORM t.count_is('admin can read audit logs', AD, 'authenticated', 'SELECT 1 FROM audit_logs', 1);
  PERFORM t.raises('authenticated cannot insert audit', AD, 'authenticated', $q$INSERT INTO audit_logs(action,entity_type,entity_id) VALUES ('x','y','20000000-0000-0000-0000-00000000000a')$q$);
  PERFORM t.raises('authenticated cannot update audit', AD, 'authenticated', $q$UPDATE audit_logs SET action='tamper'$q$);
  PERFORM t.raises('authenticated cannot delete audit', AD, 'authenticated', $q$DELETE FROM audit_logs$q$);
  PERFORM t.raises('even superuser cannot update audit', NULL, 'postgres', $q$UPDATE audit_logs SET action='tamper'$q$);
  PERFORM t.raises('even superuser cannot delete audit', NULL, 'postgres', $q$DELETE FROM audit_logs$q$);
  PERFORM t.raises('even superuser cannot truncate audit', NULL, 'postgres', $q$TRUNCATE audit_logs$q$);
  PERFORM t.allowed('service_role can insert audit', NULL, 'service_role', $q$INSERT INTO audit_logs(action,entity_type,entity_id) VALUES ('approve','shop','20000000-0000-0000-0000-00000000000a')$q$);
  PERFORM t.allowed('service_role can change slug', NULL, 'service_role', $q$UPDATE storefronts SET slug='shop-a-v2' WHERE shop_id='20000000-0000-0000-0000-00000000000a'$q$);
END $$;

-- ===========================================================================
-- Merchant onboarding workflow (004), storage (005), pincodes
-- ===========================================================================
CREATE FUNCTION t.ok(name TEXT, cond BOOLEAN) RETURNS void LANGUAGE sql AS
$$ INSERT INTO t.results VALUES (name, COALESCE(cond, FALSE)) $$;

DO $$
DECLARE
  A TEXT := '00000000-0000-0000-0000-00000000000a'; B TEXT := '00000000-0000-0000-0000-00000000000b';
  AD TEXT := '00000000-0000-0000-0000-0000000000ad'; C TEXT := '00000000-0000-0000-0000-0000000000c1';
  D TEXT := '00000000-0000-0000-0000-0000000000d1'; E TEXT := '00000000-0000-0000-0000-0000000000e5';
  F TEXT := '00000000-0000-0000-0000-0000000000f6';
  cat UUID := (SELECT id FROM categories WHERE slug = 'kirana');
  loc UUID := (SELECT id FROM localities WHERE slug = 'gandhi-chowk');
  app_a UUID; app_b UUID; app_d UUID; app_d2 UUID; app_f UUID; app_f2 UUID;
  r JSONB; r2 JSONB; shop_a UUID; biz_a UUID; sf_a UUID; slug_a TEXT := 'sri-ram-kirana-gandhi-chowk';
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (D::uuid,'d@example.test','{"full_name":"Applicant D","phone":"+919000000005"}'),
    (E::uuid,'e@example.test','{"full_name":"Employee E","phone":"+919000000006"}'),
    (F::uuid,'f@example.test','{"full_name":"Applicant F","phone":"+919000000007"}');

  -- Draft creation + duplicate prevention -------------------------------------------
  PERFORM t.act(A, 'authenticated');
  INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, locality_id, contact_phone,
      address_line1, whatsapp_number, operating_models, business_description, opening_time, closing_time,
      weekly_off_days, pincode)
  VALUES (A::uuid, 'Sri Ram Kirana', cat, loc, '+919100000101', 'Near Old Bus Stand', '+919100000101',
      ARRAY['visit_only','pickup','appointment'], 'Daily groceries', '08:30', '21:00', ARRAY['tuesday'], '507001')
  RETURNING id INTO app_a;
  RESET ROLE;
  PERFORM t.ok('applicant creates a draft application', EXISTS (SELECT 1 FROM merchant_applications WHERE id = app_a AND status = 'draft'));
  PERFORM t.raises('duplicate open application (same applicant/name/locality) is rejected', A, 'authenticated',
    format($q$INSERT INTO merchant_applications(applicant_user_id,business_name,category_id,locality_id,contact_phone,address_line1) VALUES (%L,'  sri ram KIRANA ',%L,%L,'+919100000199','x')$q$, A, cat, loc));
  PERFORM t.raises('invalid pincode is rejected', A, 'authenticated', format($q$UPDATE merchant_applications SET pincode='012345' WHERE id=%L$q$, app_a));

  -- Submission rules ---------------------------------------------------------------------
  PERFORM t.raises('cannot submit without the declaration', A, 'authenticated', format($q$SELECT public.submit_merchant_application(%L)$q$, app_a));
  PERFORM t.raises('another user cannot submit my application', C, 'authenticated', format($q$SELECT public.submit_merchant_application(%L)$q$, app_a));
  PERFORM t.raises('anon cannot call submit', NULL, 'anon', format($q$SELECT public.submit_merchant_application(%L)$q$, app_a));
  PERFORM t.allowed('applicant accepts declaration on own draft', A, 'authenticated', format($q$UPDATE merchant_applications SET declaration_accepted=true WHERE id=%L$q$, app_a));
  PERFORM t.allowed('applicant submits own application', A, 'authenticated', format($q$SELECT public.submit_merchant_application(%L)$q$, app_a));
  PERFORM t.ok('status is now submitted', (SELECT status FROM merchant_applications WHERE id = app_a) = 'submitted');
  PERFORM t.blocked('applicant cannot edit after submit', A, 'authenticated', format($q$UPDATE merchant_applications SET business_name='Changed' WHERE id=%L$q$, app_a));
  PERFORM t.raises('cannot submit twice', A, 'authenticated', format($q$SELECT public.submit_merchant_application(%L)$q$, app_a));
  PERFORM t.ok('unapproved application creates no storefront or business',
    NOT EXISTS (SELECT 1 FROM businesses WHERE origin_application_id = app_a));

  -- Approval authorisation ---------------------------------------------------------------
  PERFORM t.raises('customer cannot approve', C, 'authenticated', format($q$SELECT public.approve_merchant_application(%L)$q$, app_a));
  PERFORM t.raises('applicant cannot approve own application', A, 'authenticated', format($q$SELECT public.approve_merchant_application(%L)$q$, app_a));
  PERFORM t.raises('anon cannot approve', NULL, 'anon', format($q$SELECT public.approve_merchant_application(%L)$q$, app_a));
  PERFORM t.raises('non-admin cannot reject', A, 'authenticated', format($q$SELECT public.review_merchant_application(%L,'reject','nope')$q$, app_a));
  PERFORM t.raises('non-admin cannot list duplicates', A, 'authenticated', format($q$SELECT public.find_application_duplicates(%L)$q$, app_a));

  -- Approval: business, ownership, shop, storefront --------------------------------------
  PERFORM t.act(AD, 'authenticated');
  r := public.approve_merchant_application(app_a, 'Verified at shop');
  RESET ROLE;
  biz_a := (r ->> 'business_id')::uuid; shop_a := (r ->> 'shop_id')::uuid; sf_a := (r ->> 'storefront_id')::uuid;
  PERFORM t.ok('slug is deterministic: name + locality', r ->> 'slug' = slug_a);
  PERFORM t.ok('approval creates the business owned by the applicant',
    EXISTS (SELECT 1 FROM businesses WHERE id = biz_a AND origin_application_id = app_a AND primary_owner_id = A::uuid));
  PERFORM t.ok('applicant is an owner member', EXISTS (SELECT 1 FROM business_members WHERE business_id = biz_a AND user_id = A::uuid AND role = 'owner'));
  PERFORM t.ok('applicant is granted the merchant role', EXISTS (SELECT 1 FROM user_roles WHERE user_id = A::uuid AND role = 'merchant'));
  PERFORM t.ok('shop carries approved details',
    EXISTS (SELECT 1 FROM shops WHERE id = shop_a AND business_id = biz_a AND shop_code = 'MAIN' AND phone = '+919100000101'
            AND pincode = '507001' AND operating_hours ->> 'opens' = '08:30' AND operating_hours -> 'closed_days' = '["tuesday"]'::jsonb
            AND 'pickup' = ANY (operating_models)));
  PERFORM t.ok('storefront is published, visible, template by category, ordering off',
    EXISTS (SELECT 1 FROM storefronts WHERE id = sf_a AND shop_id = shop_a AND slug = slug_a AND is_published AND visibility_status = 'visible'
            AND template_name = 'grocery' AND NOT ordering_enabled AND description = 'Daily groceries'
            AND 'whatsapp' = ANY (supported_actions) AND 'appointment' = ANY (supported_actions)));
  PERFORM t.ok('application is approved and linked to the business',
    EXISTS (SELECT 1 FROM merchant_applications WHERE id = app_a AND status = 'approved' AND associated_business_id = biz_a AND reviewed_by = AD::uuid));
  PERFORM t.ok('approval is audited with notes',
    EXISTS (SELECT 1 FROM audit_logs WHERE entity_id = app_a AND action = 'application.approved' AND actor_id = AD::uuid AND reason = 'Verified at shop'));

  -- Idempotency ---------------------------------------------------------------------------------
  PERFORM t.act(AD, 'authenticated');
  r2 := public.approve_merchant_application(app_a);
  RESET ROLE;
  PERFORM t.ok('repeated approval returns the same business/shop/storefront',
    r2 ->> 'business_id' = r ->> 'business_id' AND r2 ->> 'shop_id' = r ->> 'shop_id' AND r2 ->> 'slug' = r ->> 'slug'
    AND (r2 ->> 'already_approved')::boolean);
  PERFORM t.ok('repeated approval creates no duplicates',
    (SELECT count(*) FROM businesses WHERE origin_application_id = app_a) = 1
    AND (SELECT count(*) FROM storefronts WHERE shop_id = shop_a) = 1
    AND (SELECT count(*) FROM shops WHERE business_id = biz_a) = 1
    AND (SELECT count(*) FROM user_roles WHERE user_id = A::uuid AND role = 'merchant') = 1
    AND (SELECT count(*) FROM audit_logs WHERE entity_id = app_a AND action = 'application.approved') = 1);
  PERFORM t.count_is('audit trail for application: submitted + approved', AD, 'authenticated',
    format($q$SELECT 1 FROM audit_logs WHERE entity_type='merchant_application' AND entity_id=%L$q$, app_a), 2);

  -- Public access & unpublished denial --------------------------------------------------------
  PERFORM t.count_is('anon can read the approved storefront', NULL, 'anon', format($q$SELECT 1 FROM storefronts WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('anon can read the approved shop', NULL, 'anon', format($q$SELECT 1 FROM shops WHERE id=%L$q$, shop_a), 1);
  PERFORM t.count_is('anon cannot read the business record', NULL, 'anon', format($q$SELECT 1 FROM businesses WHERE id=%L$q$, biz_a), 0);
  PERFORM t.allowed('admin can hide a storefront', AD, 'authenticated', format($q$UPDATE storefronts SET visibility_status='hidden' WHERE id=%L$q$, sf_a));
  PERFORM t.count_is('hidden storefront is invisible to anon', NULL, 'anon', format($q$SELECT 1 FROM storefronts WHERE slug=%L$q$, slug_a), 0);
  PERFORM t.count_is('hidden storefront''s shop is invisible to anon', NULL, 'anon', format($q$SELECT 1 FROM shops WHERE id=%L$q$, shop_a), 0);
  PERFORM t.count_is('owner still sees own hidden storefront', A, 'authenticated', format($q$SELECT 1 FROM storefronts WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.allowed('admin can restore visibility', AD, 'authenticated', format($q$UPDATE storefronts SET visibility_status='visible' WHERE id=%L$q$, sf_a));
  PERFORM t.count_is('restored storefront is public again', NULL, 'anon', format($q$SELECT 1 FROM storefronts WHERE slug=%L$q$, slug_a), 1);

  -- Merchant workspace permissions & isolation ---------------------------------------------------
  INSERT INTO business_members (business_id, user_id, role) VALUES (biz_a, E::uuid, 'employee');
  PERFORM t.allowed('owner can edit storefront headline', A, 'authenticated', format($q$UPDATE storefronts SET headline='Fresh daily' WHERE id=%L$q$, sf_a));
  PERFORM t.allowed('owner can edit shop phone and hours', A, 'authenticated', format($q$UPDATE shops SET phone='+919100000102', operating_hours='{"opens":"09:00","closes":"20:00","closed_days":[]}' WHERE id=%L$q$, shop_a));
  PERFORM t.raises('owner cannot rename the shop (re-verification)', A, 'authenticated', format($q$UPDATE shops SET name='Renamed' WHERE id=%L$q$, shop_a));
  PERFORM t.raises('owner cannot change locality', A, 'authenticated', format($q$UPDATE shops SET locality_id=(SELECT id FROM localities WHERE slug='wyra-road') WHERE id=%L$q$, shop_a));
  PERFORM t.raises('owner cannot change the slug', A, 'authenticated', format($q$UPDATE storefronts SET slug='new-slug' WHERE id=%L$q$, sf_a));
  PERFORM t.raises('owner cannot unpublish or enable ordering', A, 'authenticated', format($q$UPDATE storefronts SET is_published=false, ordering_enabled=true WHERE id=%L$q$, sf_a));
  PERFORM t.blocked('employee cannot edit shop details', E, 'authenticated', format($q$UPDATE shops SET phone='+919100000999' WHERE id=%L$q$, shop_a));
  PERFORM t.blocked('employee cannot edit storefront', E, 'authenticated', format($q$UPDATE storefronts SET headline='x' WHERE id=%L$q$, sf_a));
  PERFORM t.blocked('other merchant cannot edit this shop', B, 'authenticated', format($q$UPDATE shops SET phone='+919100000998' WHERE id=%L$q$, shop_a));
  PERFORM t.blocked('other merchant cannot edit this storefront', B, 'authenticated', format($q$UPDATE storefronts SET headline='hijack' WHERE id=%L$q$, sf_a));
  PERFORM t.blocked('other user cannot add themselves as a member', C, 'authenticated', format($q$INSERT INTO business_members(business_id,user_id,role) VALUES (%L,%L,'owner')$q$, biz_a, C));
  PERFORM t.blocked('owner cannot add members directly (admin/workflow only)', A, 'authenticated', format($q$INSERT INTO business_members(business_id,user_id,role) VALUES (%L,%L,'manager')$q$, biz_a, C));
  PERFORM t.count_is('other merchant cannot read this business', B, 'authenticated', format($q$SELECT 1 FROM businesses WHERE id=%L$q$, biz_a), 0);

  -- Slug collision + corrections + duplicate warnings ----------------------------------------------
  PERFORM t.act(B, 'authenticated');
  INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, declaration_accepted)
  VALUES (B::uuid, 'Sri Ram Kirana', cat, loc, '+919100000101', 'Near Old Bus Stand', TRUE) RETURNING id INTO app_b;
  PERFORM public.submit_merchant_application(app_b);
  RESET ROLE;
  PERFORM t.act(AD, 'authenticated');
  r := public.find_application_duplicates(app_b);
  RESET ROLE;
  PERFORM t.ok('admin sees duplicate warnings (same phone as an approved shop / application)',
    jsonb_array_length(r) >= 2 AND r::text LIKE '%same_phone%');
  PERFORM t.raises('request-corrections requires a note', AD, 'authenticated', format($q$SELECT public.review_merchant_application(%L,'request_corrections','  ')$q$, app_b));
  PERFORM t.allowed('admin requests corrections with a note', AD, 'authenticated', format($q$SELECT public.review_merchant_application(%L,'request_corrections','Please add a clearer photo')$q$, app_b));
  PERFORM t.ok('status is correction_requested with notes',
    EXISTS (SELECT 1 FROM merchant_applications WHERE id = app_b AND status = 'correction_requested' AND correction_notes = 'Please add a clearer photo'));
  PERFORM t.allowed('applicant can edit during correction', B, 'authenticated', format($q$UPDATE merchant_applications SET landmark='Behind SBI' WHERE id=%L$q$, app_b));
  PERFORM t.raises('applicant cannot erase admin feedback', B, 'authenticated', format($q$UPDATE merchant_applications SET correction_notes=NULL WHERE id=%L$q$, app_b));
  PERFORM t.allowed('applicant resubmits after corrections', B, 'authenticated', format($q$SELECT public.submit_merchant_application(%L)$q$, app_b));
  PERFORM t.act(AD, 'authenticated');
  r := public.approve_merchant_application(app_b);
  RESET ROLE;
  PERFORM t.ok('slug collision resolved with a suffix', r ->> 'slug' = slug_a || '-2');
  PERFORM t.ok('original storefront slug is unchanged', EXISTS (SELECT 1 FROM storefronts WHERE id = sf_a AND slug = slug_a));
  PERFORM t.ok('second merchant owns a separate business', (r ->> 'business_id') <> biz_a::text
    AND EXISTS (SELECT 1 FROM business_members WHERE business_id = (r ->> 'business_id')::uuid AND user_id = B::uuid AND role = 'owner'));
  PERFORM t.ok('audit has the full history of the corrected application',
    (SELECT array_agg(action ORDER BY created_at, action) FROM audit_logs WHERE entity_id = app_b) @> ARRAY['application.submitted','application.corrections_requested','application.approved']);

  -- Rejection --------------------------------------------------------------------------------------------
  PERFORM t.act(D, 'authenticated');
  INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, declaration_accepted)
  VALUES (D::uuid, 'Unverifiable Shop', cat, loc, '+919100000301', 'Unknown lane', TRUE) RETURNING id INTO app_d;
  PERFORM public.submit_merchant_application(app_d);
  RESET ROLE;
  PERFORM t.raises('reject requires a reason', AD, 'authenticated', format($q$SELECT public.review_merchant_application(%L,'reject','')$q$, app_d));
  PERFORM t.allowed('admin rejects with a reason', AD, 'authenticated', format($q$SELECT public.review_merchant_application(%L,'reject','Unable to verify establishment')$q$, app_d));
  PERFORM t.ok('rejection recorded with reason and audit',
    EXISTS (SELECT 1 FROM merchant_applications WHERE id = app_d AND status = 'rejected' AND rejection_reason = 'Unable to verify establishment' AND reviewed_by = AD::uuid)
    AND EXISTS (SELECT 1 FROM audit_logs WHERE entity_id = app_d AND action = 'application.rejected' AND reason = 'Unable to verify establishment'));
  PERFORM t.raises('rejected application cannot be approved', AD, 'authenticated', format($q$SELECT public.approve_merchant_application(%L)$q$, app_d));
  PERFORM t.raises('rejected application cannot be resubmitted', D, 'authenticated', format($q$SELECT public.submit_merchant_application(%L)$q$, app_d));
  PERFORM t.ok('rejection creates no business, role or storefront',
    NOT EXISTS (SELECT 1 FROM businesses WHERE origin_application_id = app_d)
    AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = D::uuid AND role = 'merchant'));
  PERFORM t.act(D, 'authenticated');
  INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1)
  VALUES (D::uuid, 'Unverifiable Shop', cat, loc, '+919100000301', 'Unknown lane') RETURNING id INTO app_d2;
  RESET ROLE;
  PERFORM t.ok('a rejected applicant may re-apply', app_d2 IS NOT NULL);
  PERFORM t.raises('a draft cannot be approved', AD, 'authenticated', format($q$SELECT public.approve_merchant_application(%L)$q$, app_d2));
  PERFORM t.count_is('applicant D sees only own applications', D, 'authenticated', 'SELECT 1 FROM merchant_applications', 2);
  PERFORM t.allowed('applicant can delete own draft', D, 'authenticated', format($q$DELETE FROM merchant_applications WHERE id=%L$q$, app_d2));
  PERFORM t.blocked('applicant cannot delete a reviewed application', D, 'authenticated', format($q$DELETE FROM merchant_applications WHERE id=%L$q$, app_d));

  -- Custom slug override ---------------------------------------------------------------------------------------
  PERFORM t.act(F, 'authenticated');
  INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, declaration_accepted)
  VALUES (F::uuid, 'Telugu Name', cat, loc, '+919100000401', 'Main road', TRUE) RETURNING id INTO app_f;
  INSERT INTO merchant_applications (applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, declaration_accepted)
  VALUES (F::uuid, 'తెలుగు పేరు', cat, loc, '+919100000402', 'Second road', TRUE) RETURNING id INTO app_f2;
  PERFORM public.submit_merchant_application(app_f);
  PERFORM public.submit_merchant_application(app_f2);
  RESET ROLE;
  PERFORM t.raises('custom slug already taken is refused', AD, 'authenticated', format($q$SELECT public.approve_merchant_application(%L,NULL,NULL,%L)$q$, app_f, slug_a));
  PERFORM t.ok('failed approval rolled back completely',
    (SELECT status FROM merchant_applications WHERE id = app_f) = 'submitted'
    AND NOT EXISTS (SELECT 1 FROM businesses WHERE origin_application_id = app_f));
  PERFORM t.raises('custom slug must be kebab-case', AD, 'authenticated', format($q$SELECT public.approve_merchant_application(%L,NULL,NULL,'Bad Slug!')$q$, app_f));
  PERFORM t.act(AD, 'authenticated');
  r := public.approve_merchant_application(app_f, NULL, NULL, 'my-custom-shop');
  r2 := public.approve_merchant_application(app_f2);
  RESET ROLE;
  PERFORM t.ok('valid custom slug is honoured', r ->> 'slug' = 'my-custom-shop');
  PERFORM t.ok('non-Latin name still gets a valid unique slug (category + locality)', r2 ->> 'slug' = 'kirana-gandhi-chowk');

  -- Storage policies --------------------------------------------------------------------------------------------------
  PERFORM t.allowed('applicant uploads to own private folder', A, 'authenticated',
    format($q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('private-merchant-kyc',%L,%L)$q$, A || '/' || app_a || '/logo.png', A));
  PERFORM t.raises('applicant cannot upload into someone else''s private folder', A, 'authenticated',
    format($q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('private-merchant-kyc',%L,%L)$q$, B || '/x/logo.png', A));
  PERFORM t.count_is('applicant reads own private files', A, 'authenticated', $q$SELECT 1 FROM storage.objects WHERE bucket_id='private-merchant-kyc'$q$, 1);
  PERFORM t.count_is('other merchant cannot read private files', B, 'authenticated', $q$SELECT 1 FROM storage.objects WHERE bucket_id='private-merchant-kyc'$q$, 0);
  PERFORM t.count_is('anon cannot read private files', NULL, 'anon', $q$SELECT 1 FROM storage.objects WHERE bucket_id='private-merchant-kyc'$q$, 0);
  PERFORM t.count_is('admin can read private files for review', AD, 'authenticated', $q$SELECT 1 FROM storage.objects WHERE bucket_id='private-merchant-kyc'$q$, 1);
  PERFORM t.allowed('shop owner uploads a storefront image', A, 'authenticated',
    format($q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('public-storefront-assets',%L,%L)$q$, shop_a || '/logo.png', A));
  PERFORM t.raises('other merchant cannot upload to this shop', B, 'authenticated',
    format($q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('public-storefront-assets',%L,%L)$q$, shop_a || '/evil.png', B));
  PERFORM t.raises('employee cannot upload to the shop', E, 'authenticated',
    format($q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('public-storefront-assets',%L,%L)$q$, shop_a || '/emp.png', E));
  PERFORM t.raises('non-shop folder names are refused', A, 'authenticated',
    $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('public-storefront-assets','junk/x.png',NULL)$q$);
  PERFORM t.raises('anon cannot upload to public bucket', NULL, 'anon',
    format($q$INSERT INTO storage.objects(bucket_id,name) VALUES ('public-storefront-assets',%L)$q$, shop_a || '/anon.png'));
  PERFORM t.count_is('anyone can read published storefront assets', NULL, 'anon', $q$SELECT 1 FROM storage.objects WHERE bucket_id='public-storefront-assets'$q$, 1);
  PERFORM t.ok('buckets configured with size limits and private/public flags',
    (SELECT public FROM storage.buckets WHERE id='public-storefront-assets') AND NOT (SELECT public FROM storage.buckets WHERE id='private-merchant-kyc')
    AND (SELECT file_size_limit FROM storage.buckets WHERE id='public-storefront-assets') = 5242880
    AND (SELECT file_size_limit FROM storage.buckets WHERE id='private-merchant-kyc') = 10485760);

  -- Pincodes / location -------------------------------------------------------------------------------------------------------
  INSERT INTO pincodes (pincode, office_name, district, state, latitude, longitude) VALUES
    ('507001', 'Test Office One', 'Khammam', 'Telangana', 17.2473, 80.1514),
    ('507002', 'Test Office Two', 'Khammam', 'Telangana', 17.3000, 80.2000),
    ('507003', 'No Coordinates', 'Khammam', 'Telangana', NULL, NULL);
  PERFORM t.count_is('anon can read pincodes', NULL, 'anon', 'SELECT 1 FROM pincodes', 3);
  PERFORM t.raises('pincode format is enforced', NULL, 'postgres', $q$INSERT INTO pincodes(pincode,office_name,district,state) VALUES ('012345','Bad','x','y')$q$);
  PERFORM t.raises('anon cannot write pincodes', NULL, 'anon', $q$INSERT INTO pincodes(pincode,office_name,district,state) VALUES ('507009','x','y','z')$q$);
  PERFORM t.act(NULL, 'anon');
  PERFORM t.ok('nearest_pincodes returns the closest office with coordinates first',
    (SELECT pincode FROM public.nearest_pincodes(17.2480, 80.1520, 2) ORDER BY distance_km LIMIT 1) = '507001'
    AND (SELECT count(*) FROM public.nearest_pincodes(17.2480, 80.1520, 5)) = 2);
  PERFORM t.ok('nearest_pincodes rejects out-of-range coordinates', (SELECT count(*) FROM public.nearest_pincodes(95, 0, 3)) = 0);
  RESET ROLE;
END $$;

-- ===========================================================================
-- Discovery & search (006)
-- ===========================================================================
DO $$
DECLARE
  A TEXT := '00000000-0000-0000-0000-00000000000a'; B TEXT := '00000000-0000-0000-0000-00000000000b';
  AD TEXT := '00000000-0000-0000-0000-0000000000ad';
  slug_a TEXT := 'sri-ram-kirana-gandhi-chowk';
  sf_a UUID := (SELECT id FROM storefronts WHERE slug = 'sri-ram-kirana-gandhi-chowk');
  shop_a UUID := (SELECT shop_id FROM storefronts WHERE slug = 'sri-ram-kirana-gandhi-chowk');
  cat UUID := (SELECT id FROM categories WHERE slug = 'kirana');
  wyra UUID := (SELECT id FROM localities WHERE slug = 'wyra-road');
  gandhi UUID := (SELECT id FROM localities WHERE slug = 'gandhi-chowk');
  visible INT := (SELECT count(*) FROM storefronts WHERE is_published AND visibility_status = 'visible');
  v_total BIGINT; v_sum BIGINT; first_name TEXT; second_name TEXT; first_created TIMESTAMPTZ; second_created TIMESTAMPTZ;
  page1 TEXT; page2 TEXT;
BEGIN
  PERFORM t.ok('search document includes shop, category, locality, address and description',
    (SELECT search_text FROM storefronts WHERE id = sf_a) ILIKE '%Sri Ram Kirana%'
    AND (SELECT search_text FROM storefronts WHERE id = sf_a) ILIKE '%Gandhi Chowk%'
    AND (SELECT search_text FROM storefronts WHERE id = sf_a) ILIKE '%Daily groceries%'
    AND (SELECT search_text FROM storefronts WHERE id = sf_a) ILIKE '%507001%');

  -- Browse + published-only
  PERFORM t.count_is('anon browse returns every published storefront and nothing else', NULL, 'anon',
    $q$SELECT 1 FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 50, 0)$q$, visible);
  PERFORM t.count_is('unpublished storefront is never listed', NULL, 'anon', $q$SELECT 1 FROM search_storefronts('Shop B')$q$, 0);
  PERFORM t.count_is('even its owner cannot find an unpublished storefront in public search', B, 'authenticated', $q$SELECT 1 FROM search_storefronts('Shop B')$q$, 0);
  PERFORM t.count_is('draft/submitted/rejected applicant names are not searchable', NULL, 'anon', $q$SELECT 1 FROM search_storefronts('Unverifiable')$q$, 0);

  -- Searchable fields
  PERFORM t.count_is('search by business name', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('sri ram') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('search by description', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('groceries') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('search by locality', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('gandhi chowk') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('search by category name', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('kirana') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('search by PIN code', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('507001') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('search is case-insensitive', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('SRI RAM KIRANA') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('search tolerates a spelling mistake', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('kirna') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('every word must match (AND)', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('sri ram pharmacy') WHERE slug=%L$q$, slug_a), 0);
  PERFORM t.count_is('non-Latin text is searched as plain text (no error)', NULL, 'anon', $q$SELECT 1 FROM search_storefronts('తెలుగు')$q$, 1);

  -- No results, hostile input
  PERFORM t.count_is('no-result query returns nothing', NULL, 'anon', $q$SELECT 1 FROM search_storefronts('zzzzqqqq')$q$, 0);
  PERFORM t.count_is('SQL-looking input is just text', NULL, 'anon', $q$SELECT 1 FROM search_storefronts($s$'; drop table shops; --$s$)$q$, 0);
  PERFORM t.ok('shops table survived hostile input', to_regclass('public.shops') IS NOT NULL);
  PERFORM t.count_is('LIKE wildcards are neutralised', NULL, 'anon', $q$SELECT 1 FROM search_storefronts('%_%\') WHERE false$q$, 0);
  PERFORM t.count_is('wildcard-only query degrades to browse, not an error', NULL, 'anon', $q$SELECT 1 FROM search_storefronts('%%', NULL, NULL, NULL, 'newest', 50, 0)$q$, visible);
  PERFORM t.count_is('very long query is truncated and behaves like its first words', NULL, 'anon',
    format($q$SELECT 1 FROM search_storefronts(%L)$q$, repeat('kirana ', 100)), (SELECT count(*) FROM search_storefronts('kirana'))::int);

  -- Filters
  PERFORM t.count_is('category filter keeps matching shops', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts(NULL, %L, NULL, NULL, 'newest', 50, 0) WHERE slug=%L$q$, cat, slug_a), 1);
  PERFORM t.count_is('locality filter excludes other localities', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts(NULL, NULL, %L, NULL, 'newest', 50, 0) WHERE slug=%L$q$, wyra, slug_a), 0);
  PERFORM t.count_is('locality filter includes the right locality', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts(NULL, NULL, %L, NULL, 'newest', 50, 0) WHERE slug=%L$q$, gandhi, slug_a), 1);
  PERFORM t.count_is('operating-model filter (pickup)', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts(NULL, NULL, NULL, 'pickup', 'newest', 50, 0) WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('operating-model filter excludes shops without it (delivery)', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts(NULL, NULL, NULL, 'delivery', 'newest', 50, 0) WHERE slug=%L$q$, slug_a), 0);
  PERFORM t.count_is('query + filters combine', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('kirana', %L, %L, 'pickup') WHERE slug=%L$q$, cat, gandhi, slug_a), 1);

  -- Sorting & pagination
  PERFORM t.act(NULL, 'anon');
  SELECT s1.shop_name, s2.shop_name INTO first_name, second_name FROM
    (SELECT shop_name FROM search_storefronts(NULL, NULL, NULL, NULL, 'name', 50, 0) OFFSET 0 LIMIT 1) s1,
    (SELECT shop_name FROM search_storefronts(NULL, NULL, NULL, NULL, 'name', 50, 0) OFFSET 1 LIMIT 1) s2;
  SELECT s1.created_at, s2.created_at INTO first_created, second_created FROM
    (SELECT created_at FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 50, 0) OFFSET 0 LIMIT 1) s1,
    (SELECT created_at FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 50, 0) OFFSET 1 LIMIT 1) s2;
  SELECT total_count INTO v_total FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 2, 0) LIMIT 1;
  SELECT string_agg(slug, ',' ORDER BY slug) INTO page1 FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 2, 0);
  SELECT string_agg(slug, ',' ORDER BY slug) INTO page2 FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 2, 2);
  RESET ROLE;
  PERFORM t.ok('sort by name is alphabetical', lower(first_name) <= lower(second_name));
  PERFORM t.ok('sort by newest is newest first', first_created >= second_created);
  PERFORM t.ok('total_count reports all matches while paging', v_total = visible);
  PERFORM t.ok('pages do not overlap', page1 IS NOT NULL AND page2 IS NOT NULL AND page1 <> page2);
  PERFORM t.count_is('page size is clamped to 50', NULL, 'anon', $q$SELECT 1 FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 100000, 0)$q$, LEAST(visible, 50));
  PERFORM t.count_is('negative offset is treated as 0 and unknown sort falls back', NULL, 'anon', $q$SELECT 1 FROM search_storefronts(NULL, NULL, NULL, NULL, 'bogus', 3, -5)$q$, LEAST(visible, 3));
  PERFORM t.count_is('offset past the end returns an empty page', NULL, 'anon', $q$SELECT 1 FROM search_storefronts(NULL, NULL, NULL, NULL, 'newest', 10, 9000)$q$, 0);
  PERFORM t.ok('relevance ranks an exact name match first',
    (SELECT slug FROM search_storefronts('sri ram kirana', NULL, NULL, NULL, 'relevance', 5, 0) LIMIT 1) IN (slug_a, slug_a || '-2'));

  -- Visibility changes take effect immediately
  PERFORM t.allowed('admin hides a storefront', AD, 'authenticated', format($q$UPDATE storefronts SET visibility_status='suspended' WHERE id=%L$q$, sf_a));
  PERFORM t.count_is('suspended storefront disappears from search', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('sri ram') WHERE slug=%L$q$, slug_a), 0);
  PERFORM t.count_is('...and from search even for its owner', A, 'authenticated', format($q$SELECT 1 FROM search_storefronts('sri ram') WHERE slug=%L$q$, slug_a), 0);
  PERFORM t.ok('...and from browse counts',
    (SELECT sum(shop_count) FROM public_category_counts()) = visible - 1);
  PERFORM t.allowed('admin restores it', AD, 'authenticated', format($q$UPDATE storefronts SET visibility_status='visible' WHERE id=%L$q$, sf_a));
  PERFORM t.count_is('restored storefront is searchable again', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('sri ram') WHERE slug=%L$q$, slug_a), 1);

  -- Index stays in sync with edits
  PERFORM t.allowed('owner edits description', A, 'authenticated', format($q$UPDATE storefronts SET description='Fresh vegetables and spices' WHERE id=%L$q$, sf_a));
  PERFORM t.count_is('new description is searchable', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('vegetables') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.count_is('old description is gone', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('groceries') WHERE slug=%L$q$, slug_a), 0);
  PERFORM t.allowed('admin renames a shop', AD, 'authenticated', format($q$UPDATE shops SET name='Zeta Provisions' WHERE id=%L$q$, shop_a));
  PERFORM t.count_is('renamed shop is found by new name', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('zeta') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.allowed('admin renames a locality', AD, 'authenticated', format($q$UPDATE localities SET name='Gandhi Chowk Central' WHERE id=%L$q$, gandhi));
  PERFORM t.count_is('locality rename flows into the search document', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('central') WHERE slug=%L$q$, slug_a), 1);
  PERFORM t.allowed('admin renames a category', AD, 'authenticated', format($q$UPDATE categories SET name='Grocery Stores' WHERE id=%L$q$, cat));
  PERFORM t.count_is('category rename flows into the search document', NULL, 'anon', format($q$SELECT 1 FROM search_storefronts('grocery stores') WHERE slug=%L$q$, slug_a), 1);

  -- Browse counts
  PERFORM t.act(NULL, 'anon');
  SELECT sum(shop_count) INTO v_sum FROM public_category_counts();
  RESET ROLE;
  PERFORM t.ok('category counts add up to published storefronts', v_sum = visible);
  PERFORM t.act(NULL, 'anon');
  SELECT sum(shop_count) INTO v_sum FROM public_locality_counts();
  RESET ROLE;
  PERFORM t.ok('locality counts add up to published storefronts', v_sum = visible);
END $$;

-- ===========================================================================
-- Help Me Find It (006)
-- ===========================================================================
DO $$
DECLARE
  A TEXT := '00000000-0000-0000-0000-00000000000a'; B TEXT := '00000000-0000-0000-0000-00000000000b';
  AD TEXT := '00000000-0000-0000-0000-0000000000ad'; C TEXT := '00000000-0000-0000-0000-0000000000c1';
  O TEXT := '00000000-0000-0000-0000-0000000000a9';
  gandhi UUID := (SELECT id FROM localities WHERE slug = 'gandhi-chowk');
  cat UUID := (SELECT id FROM categories LIMIT 1);
  slug_a TEXT := 'sri-ram-kirana-gandhi-chowk';
  r1 JSONB; r2 JSONB; rc JSONB; req_c UUID; req_anon UUID; n1 INT; n2 INT; res JSONB;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (O::uuid, 'op@example.test', '{"full_name":"Operator","phone":"+919000000009"}');
  INSERT INTO user_roles (user_id, role) VALUES (O::uuid, 'operator');

  -- Anonymous submission
  PERFORM t.act(NULL, 'anon');
  r1 := public.submit_help_request('Wood-pressed sesame oil 5L', 'Ganuga oil please', gandhi, cat, 'Venkatesh', '+919848012345', NULL, TRUE);
  r2 := public.submit_help_request('Second thing', NULL, gandhi, NULL, 'Venkatesh', '+919848012345', 'v@example.test', TRUE);
  RESET ROLE;
  PERFORM t.ok('tracking id has the documented format',
    r1 ->> 'tracking_id' ~ ('^HMF-KHM-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM') || '-[0-9]{4}$') AND r1 ->> 'status' = 'pending');
  n1 := right(r1 ->> 'tracking_id', 4)::int; n2 := right(r2 ->> 'tracking_id', 4)::int;
  PERFORM t.ok('tracking ids are sequential and unique', n2 = n1 + 1 AND r1 ->> 'tracking_id' <> r2 ->> 'tracking_id');
  req_anon := (SELECT id FROM help_me_find_it_requests WHERE tracking_id = r1 ->> 'tracking_id');
  PERFORM t.ok('anonymous request stored without an owner, pending, with consent',
    EXISTS (SELECT 1 FROM help_me_find_it_requests WHERE id = req_anon AND customer_user_id IS NULL AND status = 'pending' AND consent_given AND category_id = cat));

  -- Signed-in submission is owned by the caller
  PERFORM t.act(C, 'authenticated');
  rc := public.submit_help_request('Brass pooja lamp', NULL, gandhi, NULL, 'Customer C', '+919848099999', NULL, TRUE);
  RESET ROLE;
  req_c := (SELECT id FROM help_me_find_it_requests WHERE tracking_id = rc ->> 'tracking_id');
  PERFORM t.ok('signed-in request is attributed to the caller', (SELECT customer_user_id FROM help_me_find_it_requests WHERE id = req_c) = C::uuid);

  -- Validation
  PERFORM t.raises('consent is mandatory', NULL, 'anon', format($q$SELECT public.submit_help_request('Oil', NULL, %L, NULL, 'N', '+919848012345', NULL, FALSE)$q$, gandhi));
  PERFORM t.raises('item name too short', NULL, 'anon', format($q$SELECT public.submit_help_request('x', NULL, %L, NULL, 'N', '+919848012345', NULL, TRUE)$q$, gandhi));
  PERFORM t.raises('item name too long', NULL, 'anon', format($q$SELECT public.submit_help_request(%L, NULL, %L, NULL, 'N', '+919848012345', NULL, TRUE)$q$, repeat('a', 201), gandhi));
  PERFORM t.raises('invalid phone', NULL, 'anon', format($q$SELECT public.submit_help_request('Oil', NULL, %L, NULL, 'N', '12345', NULL, TRUE)$q$, gandhi));
  PERFORM t.raises('invalid email', NULL, 'anon', format($q$SELECT public.submit_help_request('Oil', NULL, %L, NULL, 'N', '+919848012346', 'not-an-email', TRUE)$q$, gandhi));
  PERFORM t.raises('unknown locality', NULL, 'anon', $q$SELECT public.submit_help_request('Oil', NULL, '99999999-9999-4999-8999-999999999999', NULL, 'N', '+919848012346', NULL, TRUE)$q$);
  PERFORM t.raises('unknown category', NULL, 'anon', format($q$SELECT public.submit_help_request('Oil', NULL, %L, '99999999-9999-4999-8999-999999999999', 'N', '+919848012346', NULL, TRUE)$q$, gandhi));
  PERFORM t.raises('blank name', NULL, 'anon', format($q$SELECT public.submit_help_request('Oil', NULL, %L, NULL, '  ', '+919848012346', NULL, TRUE)$q$, gandhi));
  PERFORM t.raises('direct insert by anon is not possible', NULL, 'anon', format($q$INSERT INTO help_me_find_it_requests(tracking_id,item_name,preferred_locality_id,contact_phone,contact_name) VALUES ('HMF-FAKE-1','x',%L,'+919848012345','n')$q$, gandhi));
  PERFORM t.raises('direct insert by a signed-in user is not possible', C, 'authenticated', format($q$INSERT INTO help_me_find_it_requests(tracking_id,item_name,preferred_locality_id,contact_phone,contact_name) VALUES ('HMF-FAKE-2','x',%L,'+919848012345','n')$q$, gandhi));

  -- Abuse protection: 5 / phone / hour
  PERFORM t.act(NULL, 'anon');
  FOR i IN 1..5 LOOP
    PERFORM public.submit_help_request('Throttle test ' || i, NULL, gandhi, NULL, 'Spammer', '+919848000777', NULL, TRUE);
  END LOOP;
  RESET ROLE;
  PERFORM t.raises('the 6th request from one phone within an hour is refused', NULL, 'anon', format($q$SELECT public.submit_help_request('Throttle test 6', NULL, %L, NULL, 'Spammer', '+919848000777', NULL, TRUE)$q$, gandhi));
  PERFORM t.ok('a different phone is unaffected',
    (SELECT public.submit_help_request('Other person', NULL, gandhi, NULL, 'Other', '+919848000778', NULL, TRUE)) IS NOT NULL);

  -- Ownership: private to the customer
  PERFORM t.count_is('customer sees only their own requests', C, 'authenticated', 'SELECT 1 FROM help_me_find_it_requests', 1);
  PERFORM t.count_is('another customer sees none of them', B, 'authenticated', 'SELECT 1 FROM help_me_find_it_requests', 0);
  PERFORM t.count_is('anon cannot list requests', NULL, 'anon', 'SELECT 1 FROM help_me_find_it_requests', 0);
  PERFORM t.count_is('a merchant cannot read customer requests', A, 'authenticated', 'SELECT 1 FROM help_me_find_it_requests', 0);
  PERFORM t.ok('operator sees all requests', (SELECT count(*) FROM help_me_find_it_requests) >= 9);
  PERFORM t.count_is('operator role grants read access', O, 'authenticated', format($q$SELECT 1 FROM help_me_find_it_requests WHERE id=%L$q$, req_c), 1);
  PERFORM t.count_is('admin can read requests', AD, 'authenticated', format($q$SELECT 1 FROM help_me_find_it_requests WHERE id=%L$q$, req_c), 1);
  PERFORM t.blocked('customer cannot edit own request directly', C, 'authenticated', format($q$UPDATE help_me_find_it_requests SET status='matched', matched_shop_id=NULL WHERE id=%L$q$, req_c));
  PERFORM t.blocked('customer cannot edit someone else''s request', B, 'authenticated', format($q$UPDATE help_me_find_it_requests SET item_name='hacked' WHERE id=%L$q$, req_c));
  PERFORM t.blocked('customer cannot delete requests', C, 'authenticated', format($q$DELETE FROM help_me_find_it_requests WHERE id=%L$q$, req_c));
  PERFORM t.raises('another user cannot cancel it', B, 'authenticated', format($q$SELECT public.cancel_help_request(%L)$q$, req_c));
  PERFORM t.raises('anon cannot cancel', NULL, 'anon', format($q$SELECT public.cancel_help_request(%L)$q$, req_c));
  PERFORM t.raises('customers cannot use the staff function', C, 'authenticated', format($q$SELECT public.update_help_request(%L,'matched',NULL,%L)$q$, req_c, slug_a));
  PERFORM t.raises('anon cannot use the staff function', NULL, 'anon', format($q$SELECT public.update_help_request(%L,'under_review')$q$, req_c));
  PERFORM t.raises('a merchant cannot use the staff function', A, 'authenticated', format($q$SELECT public.update_help_request(%L,'under_review')$q$, req_c));

  -- Tracking without an account (needs id AND phone)
  PERFORM t.act(NULL, 'anon');
  res := public.track_help_request(lower(r1 ->> 'tracking_id'), '+919848012345');
  RESET ROLE;
  PERFORM t.ok('anonymous tracking works with the right id + phone', res ->> 'status' = 'pending' AND res ->> 'item_name' = 'Wood-pressed sesame oil 5L');
  PERFORM t.raises('wrong phone is refused', NULL, 'anon', format($q$SELECT public.track_help_request(%L,'+919848000000')$q$, r1 ->> 'tracking_id'));
  PERFORM t.raises('unknown tracking id is refused', NULL, 'anon', $q$SELECT public.track_help_request('HMF-KHM-209901-0001','+919848012345')$q$);
  PERFORM t.ok('tracking exposes no contact details', NOT (res ? 'contact_phone') AND NOT (res ? 'contact_name') AND NOT (res ? 'contact_email'));

  -- Staff handling workflow
  PERFORM t.allowed('operator moves a request to under_review', O, 'authenticated', format($q$SELECT public.update_help_request(%L,'under_review','Checking with kirana shops')$q$, req_anon));
  PERFORM t.ok('operator is recorded', (SELECT operator_id FROM help_me_find_it_requests WHERE id = req_anon) = O::uuid);
  PERFORM t.raises('matched needs a real published shop', O, 'authenticated', format($q$SELECT public.update_help_request(%L,'matched','x','no-such-shop')$q$, req_anon));
  PERFORM t.raises('matched needs a shop slug', O, 'authenticated', format($q$SELECT public.update_help_request(%L,'matched','x')$q$, req_anon));
  PERFORM t.raises('unresolved needs a note', O, 'authenticated', format($q$SELECT public.update_help_request(%L,'unresolved','  ')$q$, req_anon));
  PERFORM t.raises('unknown status is refused', O, 'authenticated', format($q$SELECT public.update_help_request(%L,'teleported')$q$, req_anon));
  PERFORM t.allowed('admin matches it to a published shop', AD, 'authenticated', format($q$SELECT public.update_help_request(%L,'matched','Shop confirmed stocking it',%L)$q$, req_anon, slug_a));
  PERFORM t.ok('matched request references the shop and is resolved',
    EXISTS (SELECT 1 FROM help_me_find_it_requests h JOIN storefronts sf ON sf.shop_id = h.matched_shop_id
            WHERE h.id = req_anon AND h.status = 'matched' AND sf.slug = slug_a AND h.resolved_at IS NOT NULL));
  PERFORM t.act(NULL, 'anon');
  res := public.track_help_request(r1 ->> 'tracking_id', '+919848012345');
  RESET ROLE;
  PERFORM t.ok('requester sees the confirmed shop', res ->> 'status' = 'matched' AND res ->> 'matched_shop_slug' = slug_a);
  UPDATE storefronts SET visibility_status = 'hidden' WHERE slug = slug_a;
  PERFORM t.act(NULL, 'anon');
  res := public.track_help_request(r1 ->> 'tracking_id', '+919848012345');
  RESET ROLE;
  PERFORM t.ok('a hidden shop is not revealed through a request', res ->> 'matched_shop_slug' IS NULL);
  UPDATE storefronts SET visibility_status = 'visible' WHERE slug = slug_a;
  PERFORM t.raises('a matched request cannot jump to cancelled', O, 'authenticated', format($q$SELECT public.update_help_request(%L,'cancelled')$q$, req_anon));
  PERFORM t.allowed('a matched request can be reopened', O, 'authenticated', format($q$SELECT public.update_help_request(%L,'under_review','Shop no longer stocks it')$q$, req_anon));
  PERFORM t.ok('reopening clears the match', (SELECT matched_shop_id FROM help_me_find_it_requests WHERE id = req_anon) IS NULL);
  PERFORM t.allowed('operator marks it unresolved with a note', O, 'authenticated', format($q$SELECT public.update_help_request(%L,'unresolved','No local source found')$q$, req_anon));
  PERFORM t.ok('every staff action is audited with actor and reason',
    (SELECT count(*) FROM audit_logs WHERE entity_id = req_anon AND action LIKE 'help_request.%' AND actor_id IS NOT NULL) = 4
    AND EXISTS (SELECT 1 FROM audit_logs WHERE entity_id = req_anon AND action = 'help_request.unresolved' AND reason = 'No local source found'));

  -- Customer cancels own open request
  PERFORM t.allowed('customer cancels their own pending request', C, 'authenticated', format($q$SELECT public.cancel_help_request(%L)$q$, req_c));
  PERFORM t.ok('cancelled status recorded and audited',
    (SELECT status FROM help_me_find_it_requests WHERE id = req_c) = 'cancelled'
    AND EXISTS (SELECT 1 FROM audit_logs WHERE entity_id = req_c AND action = 'help_request.cancelled'));
  PERFORM t.raises('a cancelled request cannot be cancelled again', C, 'authenticated', format($q$SELECT public.cancel_help_request(%L)$q$, req_c));
  PERFORM t.raises('a cancelled request cannot be reopened by staff', O, 'authenticated', format($q$SELECT public.update_help_request(%L,'under_review')$q$, req_c));
END $$;

-- Deleting an actor must still work (ON DELETE SET NULL) without breaking immutability.
DO $$
BEGIN
  DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000c1';
  INSERT INTO t.results SELECT 'actor delete nulls audit actor_id, row preserved',
    (SELECT count(*) FROM audit_logs WHERE actor_id IS NULL AND action = 'test') = 1;
END $$;

-- Admin bootstrap: refuses while an admin exists; works once none do. -----------------------------
DO $$
DECLARE ok BOOLEAN; uid UUID;
BEGIN
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.bootstrap_first_admin('a2@example.test'); ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  RESET ROLE;
  INSERT INTO t.results VALUES ('bootstrap refuses when an admin already exists', ok);

  DELETE FROM user_roles WHERE role = 'admin';
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.bootstrap_first_admin('nobody@example.test'); ok := false;
  EXCEPTION WHEN no_data_found THEN ok := true;
  END;
  uid := public.bootstrap_first_admin('A2@EXAMPLE.test');
  RESET ROLE;
  INSERT INTO t.results VALUES ('bootstrap rejects unknown email', ok);
  INSERT INTO t.results SELECT 'bootstrap grants admin to existing account (case-insensitive)',
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = uid AND role = 'admin');
  INSERT INTO t.results SELECT 'bootstrap writes an audit entry',
    EXISTS (SELECT 1 FROM audit_logs WHERE action = 'role.bootstrap_admin' AND entity_id = uid);
END $$;

SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results ORDER BY pass, name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN
    RAISE EXCEPTION 'RLS/identity tests failed';
  END IF;
END $$;
ROLLBACK;
