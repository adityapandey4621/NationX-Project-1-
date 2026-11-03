-- ============================================================================
-- 004_merchant_onboarding.sql — Merchant application workflow & storefront engine
--
-- Application lifecycle (docs/PRODUCT_REQUIREMENTS.md REQ-APP-04) — transitions
-- are performed ONLY by the SECURITY DEFINER functions below, never by direct
-- UPDATEs from clients, so every change is validated, atomic and audited:
--
--   draft ──submit──▶ submitted ──approve──▶ approved
--     ▲                  │  ├──reject──────▶ rejected   (terminal; may re-apply)
--     │                  │  └──request_corrections──▶ correction_requested
--     └──────── (edit) ──┴───────────────────────────────────┘ ──submit──▶ submitted
--
-- `suspended` exists in the schema for post-approval oversight (REQ-ADM-02),
-- which is outside this phase; no transition into it is implemented here.
-- ============================================================================

-- Schema additions (documented in docs/DATABASE_SCHEMA.md) ---------------------
ALTER TABLE public.merchant_applications
    ADD COLUMN document_storage_paths TEXT[],
    ADD COLUMN pincode TEXT CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$');

ALTER TABLE public.shops
    ADD COLUMN pincode TEXT CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$'),
    ADD COLUMN operating_models TEXT[] NOT NULL DEFAULT ARRAY['visit_only'] CHECK (
        operating_models <@ ARRAY['delivery', 'pickup', 'visit_only', 'appointment', 'quotation']
    );

-- Admin-configurable layout template per category (REQ-STR-01 step 2, REQ-ADM-03).
ALTER TABLE public.categories
    ADD COLUMN default_template TEXT NOT NULL DEFAULT 'standard_retail' CHECK (
        default_template IN ('standard_retail', 'grocery', 'service_provider', 'artisan')
    );

-- Duplicate prevention: one open application per applicant + business + locality.
-- (`rejected` is excluded so a rejected applicant may re-apply.)
CREATE UNIQUE INDEX uq_apps_open_per_applicant
    ON public.merchant_applications (applicant_user_id, LOWER(BTRIM(business_name)), locality_id)
    WHERE status IN ('draft', 'submitted', 'correction_requested', 'approved');
CREATE INDEX idx_apps_status ON public.merchant_applications(status, created_at);
CREATE INDEX idx_apps_contact_phone ON public.merchant_applications(contact_phone);
CREATE INDEX idx_shops_phone ON public.shops(phone);

-- Manager-level helpers (owner/manager may edit; employees may not) ------------
CREATE OR REPLACE FUNCTION public.is_business_manager(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.business_members bm
        WHERE bm.business_id = p_business_id AND bm.user_id = auth.uid()
          AND bm.role IN ('owner', 'manager')
    );
$$;

CREATE OR REPLACE FUNCTION public.is_shop_manager(p_shop_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.shops s
        JOIN public.business_members bm ON bm.business_id = s.business_id
        WHERE s.id = p_shop_id AND bm.user_id = auth.uid() AND bm.role IN ('owner', 'manager')
    );
$$;

REVOKE ALL ON FUNCTION public.is_business_manager(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_shop_manager(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_business_manager(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_shop_manager(UUID) TO anon, authenticated;

-- Tighten write policies ------------------------------------------------------
DROP POLICY apps_insert_own ON public.merchant_applications;
DROP POLICY apps_update_own ON public.merchant_applications;
DROP POLICY apps_update_admin ON public.merchant_applications;

-- Clients may create and edit DRAFT / CORRECTION content only. Status changes
-- go through the functions below (also enforced by guard_application_update).
CREATE POLICY apps_insert_own ON public.merchant_applications
    FOR INSERT TO authenticated
    WITH CHECK (applicant_user_id = auth.uid() AND status = 'draft');
CREATE POLICY apps_update_own ON public.merchant_applications
    FOR UPDATE TO authenticated
    USING (applicant_user_id = auth.uid() AND status IN ('draft', 'correction_requested'))
    WITH CHECK (applicant_user_id = auth.uid() AND status IN ('draft', 'correction_requested'));
CREATE POLICY apps_delete_own_draft ON public.merchant_applications
    FOR DELETE TO authenticated USING (applicant_user_id = auth.uid() AND status = 'draft');

DROP POLICY shops_update_member ON public.shops;
CREATE POLICY shops_update_manager ON public.shops
    FOR UPDATE TO authenticated
    USING (public.is_business_manager(business_id))
    WITH CHECK (public.is_business_manager(business_id));

DROP POLICY storefronts_update_member ON public.storefronts;
CREATE POLICY storefronts_update_manager ON public.storefronts
    FOR UPDATE TO authenticated
    USING (public.is_shop_manager(shop_id))
    WITH CHECK (public.is_shop_manager(shop_id));

DROP POLICY products_member_all ON public.storefront_products;
CREATE POLICY products_manager_all ON public.storefront_products
    FOR ALL TO authenticated
    USING (public.is_shop_manager(shop_id))
    WITH CHECK (public.is_shop_manager(shop_id));

-- Guards ----------------------------------------------------------------------
-- In a client request PostgREST runs as `authenticated`/`anon`; inside our
-- SECURITY DEFINER functions current_user is the function owner, which is how
-- the guard tells a sanctioned workflow transition from a direct client edit.
CREATE OR REPLACE FUNCTION public.guard_application_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        IF NEW.applicant_user_id IS DISTINCT FROM OLD.applicant_user_id
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
           OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
           OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
           OR NEW.correction_notes IS DISTINCT FROM OLD.correction_notes
           OR NEW.associated_business_id IS DISTINCT FROM OLD.associated_business_id THEN
            RAISE EXCEPTION 'status and review fields on merchant_applications change only through the workflow functions'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Business name, category and locality changes need re-verification (REQ-STR-05).
CREATE OR REPLACE FUNCTION public.guard_shop_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('admin') THEN
        IF NEW.business_id IS DISTINCT FROM OLD.business_id
           OR NEW.shop_code IS DISTINCT FROM OLD.shop_code
           OR NEW.is_active IS DISTINCT FROM OLD.is_active
           OR NEW.name IS DISTINCT FROM OLD.name
           OR NEW.category_id IS DISTINCT FROM OLD.category_id
           OR NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
           OR NEW.locality_id IS DISTINCT FROM OLD.locality_id THEN
            RAISE EXCEPTION 'name, category, locality, ownership and status of a shop are admin-only (re-verification required)'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Slug engine (ADR-003) ---------------------------------------------------------
-- Telugu-script names are not transliterated yet (no ASCII letters survive);
-- they fall back to the category slug so a valid, unique slug is always produced.
CREATE OR REPLACE FUNCTION public.slugify(p_text TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
    SELECT BTRIM(REGEXP_REPLACE(LOWER(COALESCE(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-');
$$;

-- Callers MUST hold the storefront-slug advisory lock (approve function does).
CREATE OR REPLACE FUNCTION public.generate_storefront_slug(
    p_business_name TEXT, p_locality_slug TEXT, p_category_slug TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_name TEXT := public.slugify(p_business_name);
    v_loc  TEXT := public.slugify(p_locality_slug);
    v_base TEXT;
    v_candidate TEXT;
    v_n INT := 1;
BEGIN
    IF v_name = '' THEN
        v_name := COALESCE(NULLIF(public.slugify(p_category_slug), ''), 'shop');
    END IF;
    IF v_loc <> '' AND RIGHT(v_name, LENGTH(v_loc)) <> v_loc THEN
        v_base := v_name || '-' || v_loc;
    ELSE
        v_base := v_name;
    END IF;
    v_base := BTRIM(LEFT(v_base, 80), '-');
    v_candidate := v_base;
    WHILE EXISTS (SELECT 1 FROM public.storefronts WHERE slug = v_candidate) LOOP
        v_n := v_n + 1;
        v_candidate := v_base || '-' || v_n;
    END LOOP;
    RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.slugify(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_storefront_slug(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Workflow: submit ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_merchant_application(p_application_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_app public.merchant_applications%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_app FROM public.merchant_applications WHERE id = p_application_id FOR UPDATE;
    -- Same error for "missing" and "not yours": do not reveal other users' records.
    IF NOT FOUND OR v_app.applicant_user_id <> v_uid THEN
        RAISE EXCEPTION 'application not found' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_app.status NOT IN ('draft', 'correction_requested') THEN
        RAISE EXCEPTION 'an application in status % cannot be submitted', v_app.status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF NOT v_app.declaration_accepted THEN
        RAISE EXCEPTION 'the declaration must be accepted before submitting' USING ERRCODE = 'check_violation';
    END IF;
    IF CARDINALITY(v_app.operating_models) = 0 THEN
        RAISE EXCEPTION 'select at least one operating model' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.merchant_applications SET status = 'submitted' WHERE id = v_app.id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
    VALUES (v_uid, 'application.submitted', 'merchant_application', v_app.id,
            jsonb_build_object('status', v_app.status), jsonb_build_object('status', 'submitted'));

    RETURN jsonb_build_object('application_id', v_app.id, 'status', 'submitted');
END;
$$;

-- Workflow: reject / request corrections ------------------------------------------
CREATE OR REPLACE FUNCTION public.review_merchant_application(
    p_application_id UUID, p_decision TEXT, p_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin UUID := auth.uid();
    v_app public.merchant_applications%ROWTYPE;
    v_to TEXT;
BEGIN
    IF v_admin IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_decision NOT IN ('reject', 'request_corrections') THEN
        RAISE EXCEPTION 'unknown decision %', p_decision USING ERRCODE = 'check_violation';
    END IF;
    IF p_text IS NULL OR BTRIM(p_text) = '' THEN
        RAISE EXCEPTION 'a reason or note is required' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_app FROM public.merchant_applications WHERE id = p_application_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'application not found' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_app.status <> 'submitted' THEN
        RAISE EXCEPTION 'only submitted applications can be reviewed (status is %)', v_app.status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    v_to := CASE p_decision WHEN 'reject' THEN 'rejected' ELSE 'correction_requested' END;

    UPDATE public.merchant_applications
    SET status = v_to,
        rejection_reason = CASE WHEN v_to = 'rejected' THEN BTRIM(p_text) ELSE rejection_reason END,
        correction_notes = CASE WHEN v_to = 'correction_requested' THEN BTRIM(p_text) ELSE correction_notes END,
        reviewed_by = v_admin,
        reviewed_at = NOW()
    WHERE id = v_app.id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state, reason)
    VALUES (v_admin,
            CASE v_to WHEN 'rejected' THEN 'application.rejected' ELSE 'application.corrections_requested' END,
            'merchant_application', v_app.id,
            jsonb_build_object('status', v_app.status), jsonb_build_object('status', v_to), BTRIM(p_text));

    RETURN jsonb_build_object('application_id', v_app.id, 'status', v_to);
END;
$$;

-- Workflow: approve → business + owner + shop + storefront (atomic, idempotent) ---
CREATE OR REPLACE FUNCTION public.approve_merchant_application(
    p_application_id UUID,
    p_review_notes TEXT DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_custom_slug TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin UUID := auth.uid();
    v_app public.merchant_applications%ROWTYPE;
    v_category public.categories%ROWTYPE;
    v_locality public.localities%ROWTYPE;
    v_business_id UUID;
    v_shop_id UUID;
    v_storefront_id UUID;
    v_slug TEXT;
    v_actions TEXT[] := ARRAY['call', 'directions'];
    v_description TEXT;
BEGIN
    IF v_admin IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_app FROM public.merchant_applications WHERE id = p_application_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'application not found' USING ERRCODE = 'no_data_found';
    END IF;

    -- Idempotent: a repeated approval returns the existing result unchanged.
    IF v_app.status = 'approved' AND v_app.associated_business_id IS NOT NULL THEN
        SELECT s.id, sf.id, sf.slug INTO v_shop_id, v_storefront_id, v_slug
        FROM public.shops s JOIN public.storefronts sf ON sf.shop_id = s.id
        WHERE s.business_id = v_app.associated_business_id AND s.shop_code = 'MAIN';
        RETURN jsonb_build_object(
            'application_id', v_app.id, 'business_id', v_app.associated_business_id,
            'shop_id', v_shop_id, 'storefront_id', v_storefront_id, 'slug', v_slug,
            'owner_id', v_app.applicant_user_id, 'already_approved', TRUE);
    END IF;

    IF v_app.status <> 'submitted' THEN
        RAISE EXCEPTION 'only submitted applications can be approved (status is %)', v_app.status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    SELECT * INTO v_category FROM public.categories
    WHERE id = COALESCE(p_category_id, v_app.category_id) AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'category is missing or inactive' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_locality FROM public.localities WHERE id = v_app.locality_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'locality is missing or inactive' USING ERRCODE = 'check_violation';
    END IF;

    -- Serialise slug allocation; the UNIQUE constraint remains the final guard.
    PERFORM pg_advisory_xact_lock(HASHTEXT('nationx.storefront_slug'));

    IF p_custom_slug IS NOT NULL AND BTRIM(p_custom_slug) <> '' THEN
        v_slug := BTRIM(p_custom_slug);
        IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR LENGTH(v_slug) > 100 THEN
            RAISE EXCEPTION 'custom slug must be lowercase kebab-case (max 100 chars)' USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM public.storefronts WHERE slug = v_slug) THEN
            RAISE EXCEPTION 'slug "%" is already taken', v_slug USING ERRCODE = 'unique_violation';
        END IF;
    ELSE
        v_slug := public.generate_storefront_slug(v_app.business_name, v_locality.slug, v_category.slug);
    END IF;

    -- 1-3. Business, ownership
    INSERT INTO public.businesses (name, primary_owner_id, origin_application_id)
    VALUES (v_app.business_name, v_app.applicant_user_id, v_app.id)
    ON CONFLICT (origin_application_id) DO NOTHING
    RETURNING id INTO v_business_id;
    IF v_business_id IS NULL THEN
        SELECT id INTO v_business_id FROM public.businesses WHERE origin_application_id = v_app.id;
    END IF;

    INSERT INTO public.business_members (business_id, user_id, role)
    VALUES (v_business_id, v_app.applicant_user_id, 'owner')
    ON CONFLICT (business_id, user_id) DO NOTHING;

    -- Shop
    INSERT INTO public.shops (
        business_id, name, shop_code, category_id, subcategory_id, locality_id, address_line, landmark,
        latitude, longitude, pincode, phone, whatsapp, operating_models, operating_hours)
    VALUES (
        v_business_id, v_app.business_name, 'MAIN', v_category.id, v_app.subcategory_id, v_app.locality_id,
        CONCAT_WS(', ', NULLIF(BTRIM(v_app.address_line1), ''), NULLIF(BTRIM(v_app.address_line2), '')),
        v_app.landmark, v_app.latitude, v_app.longitude, v_app.pincode, v_app.contact_phone,
        v_app.whatsapp_number, v_app.operating_models,
        JSONB_BUILD_OBJECT(
            'opens', COALESCE(TO_CHAR(v_app.opening_time, 'HH24:MI'), '09:00'),
            'closes', COALESCE(TO_CHAR(v_app.closing_time, 'HH24:MI'), '21:00'),
            'closed_days', COALESCE(TO_JSONB(v_app.weekly_off_days), '[]'::JSONB)))
    ON CONFLICT (business_id, shop_code) DO UPDATE SET name = public.shops.name
    RETURNING id INTO v_shop_id;

    -- 4-6. Storefront: slug, template by category, published; ordering stays off (ADR-003)
    IF v_app.whatsapp_number IS NOT NULL THEN v_actions := ARRAY_APPEND(v_actions, 'whatsapp'); END IF;
    IF 'appointment' = ANY (v_app.operating_models) THEN v_actions := ARRAY_APPEND(v_actions, 'appointment'); END IF;
    IF 'quotation' = ANY (v_app.operating_models) THEN v_actions := ARRAY_APPEND(v_actions, 'inquiry'); END IF;
    v_description := NULLIF(BTRIM(v_app.business_description), '');

    INSERT INTO public.storefronts (
        shop_id, slug, description, template_name, is_published, visibility_status,
        supported_actions, ordering_enabled, meta_title, meta_description)
    VALUES (
        v_shop_id, v_slug, v_description, v_category.default_template, TRUE, 'visible',
        v_actions, FALSE,
        v_app.business_name || ' – ' || v_locality.name,
        LEFT(COALESCE(v_description, v_app.business_name || ' in ' || v_locality.name), 160))
    ON CONFLICT (shop_id) DO NOTHING
    RETURNING id INTO v_storefront_id;
    IF v_storefront_id IS NULL THEN
        SELECT id, slug INTO v_storefront_id, v_slug FROM public.storefronts WHERE shop_id = v_shop_id;
    END IF;

    -- Applicant becomes a merchant
    INSERT INTO public.user_roles (user_id, role) VALUES (v_app.applicant_user_id, 'merchant')
    ON CONFLICT (user_id, role) DO NOTHING;

    UPDATE public.merchant_applications
    SET status = 'approved',
        category_id = v_category.id,
        associated_business_id = v_business_id,
        reviewed_by = v_admin,
        reviewed_at = NOW()
    WHERE id = v_app.id;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state, reason)
    VALUES (v_admin, 'application.approved', 'merchant_application', v_app.id,
            JSONB_BUILD_OBJECT('status', v_app.status),
            JSONB_BUILD_OBJECT('status', 'approved', 'business_id', v_business_id, 'shop_id', v_shop_id,
                               'storefront_id', v_storefront_id, 'slug', v_slug),
            NULLIF(BTRIM(p_review_notes), ''));

    RETURN jsonb_build_object(
        'application_id', v_app.id, 'business_id', v_business_id, 'shop_id', v_shop_id,
        'storefront_id', v_storefront_id, 'slug', v_slug, 'owner_id', v_app.applicant_user_id,
        'already_approved', FALSE);
END;
$$;

-- Admin: possible duplicates (REQ-APP-03: warn, do not silently create twins) ---------
CREATE OR REPLACE FUNCTION public.find_application_duplicates(p_application_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_app public.merchant_applications%ROWTYPE;
    v_result JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_app FROM public.merchant_applications WHERE id = p_application_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'application not found' USING ERRCODE = 'no_data_found';
    END IF;

    SELECT COALESCE(JSONB_AGG(TO_JSONB(d)), '[]'::JSONB) INTO v_result
    FROM (
        SELECT 'application' AS kind, a.id, a.business_name AS label, a.status AS detail,
               CASE WHEN a.contact_phone = v_app.contact_phone THEN 'same_phone' ELSE 'same_address' END AS reason
        FROM public.merchant_applications a
        WHERE a.id <> v_app.id AND a.status <> 'rejected'
          AND (a.contact_phone = v_app.contact_phone
               OR (a.locality_id = v_app.locality_id
                   AND LOWER(BTRIM(a.address_line1)) = LOWER(BTRIM(v_app.address_line1))))
        UNION ALL
        SELECT 'shop', s.id, s.name, 'active',
               CASE WHEN s.phone = v_app.contact_phone THEN 'same_phone' ELSE 'same_address' END
        FROM public.shops s
        WHERE s.business_id IS DISTINCT FROM v_app.associated_business_id
          AND (s.phone = v_app.contact_phone
               OR (s.locality_id = v_app.locality_id
                   AND LOWER(BTRIM(s.address_line)) = LOWER(BTRIM(v_app.address_line1))))
    ) d;
    RETURN v_result;
END;
$$;

-- Execution rights: signed-in users only; each function re-checks identity/role.
REVOKE ALL ON FUNCTION public.submit_merchant_application(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_merchant_application(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_merchant_application(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.find_application_duplicates(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_merchant_application(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_merchant_application(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_merchant_application(UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_application_duplicates(UUID) TO authenticated;

-- Location reference data: India Post pincode directory (imported, never invented) -----
-- Load with `npm run import:pincodes -- <csv>`; see docs/adr/ADR-005.
CREATE TABLE public.pincodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pincode TEXT NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
    office_name TEXT NOT NULL,
    district TEXT NOT NULL,
    state TEXT NOT NULL,
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (pincode, office_name)
);
CREATE INDEX idx_pincodes_pincode ON public.pincodes(pincode);

ALTER TABLE public.pincodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY pincodes_public_read ON public.pincodes FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY pincodes_admin_all ON public.pincodes
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Nearest post offices to a GPS point (great-circle distance; no PostGIS needed yet).
CREATE OR REPLACE FUNCTION public.nearest_pincodes(
    p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_limit INT DEFAULT 3
)
RETURNS TABLE (pincode TEXT, office_name TEXT, district TEXT, state TEXT, distance_km DOUBLE PRECISION)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT p.pincode, p.office_name, p.district, p.state,
           6371 * 2 * ASIN(SQRT(
               POWER(SIN(RADIANS(p.latitude::DOUBLE PRECISION - p_lat) / 2), 2)
               + COS(RADIANS(p_lat)) * COS(RADIANS(p.latitude::DOUBLE PRECISION))
                 * POWER(SIN(RADIANS(p.longitude::DOUBLE PRECISION - p_lng) / 2), 2))) AS distance_km
    FROM public.pincodes p
    WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
      AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
    ORDER BY distance_km
    LIMIT LEAST(GREATEST(p_limit, 1), 10);
$$;
GRANT EXECUTE ON FUNCTION public.nearest_pincodes(DOUBLE PRECISION, DOUBLE PRECISION, INT) TO anon, authenticated;
