-- ============================================================================
-- 002_rls_policies.sql — NationX Foundation, Phase 1
-- Source of truth: docs/DATABASE_SCHEMA.md section 5, docs/SECURITY.md
--
-- Model:
--   * Service-role connections (auth.uid() IS NULL) bypass RLS and are used
--     only by trusted server code (approval pipeline, audit writes).
--   * Every other actor is constrained by the policies below.
--   * Tables with RLS enabled and no policy for an operation deny it.
-- ============================================================================

-- Helper predicates ----------------------------------------------------------
-- SECURITY DEFINER so policies on one table can consult another without
-- triggering recursive RLS evaluation. search_path is pinned for safety.

CREATE OR REPLACE FUNCTION public.has_role(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = p_role
    );
$$;

CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.business_members bm
        WHERE bm.business_id = p_business_id AND bm.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_shop_member(p_shop_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.shops s
        JOIN public.business_members bm ON bm.business_id = s.business_id
        WHERE s.id = p_shop_id AND bm.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_shop_publicly_visible(p_shop_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.storefronts sf
        JOIN public.shops s ON s.id = sf.shop_id
        WHERE sf.shop_id = p_shop_id
          AND sf.is_published = TRUE
          AND sf.visibility_status = 'visible'
          AND s.is_active = TRUE
    );
$$;

REVOKE ALL ON FUNCTION public.has_role(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_business_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_shop_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_shop_publicly_visible(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_member(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_shop_member(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_shop_publicly_visible(UUID) TO anon, authenticated;

-- Enable RLS on every table ---------------------------------------------------
ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.localities               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_applications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shops                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefronts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storefront_products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_me_find_it_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs               ENABLE ROW LEVEL SECURITY;

-- Profiles -------------------------------------------------------------------
CREATE POLICY profiles_select_own ON public.profiles
    FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profiles_select_admin ON public.profiles
    FOR SELECT TO authenticated USING (public.has_role('admin'));
CREATE POLICY profiles_update_own ON public.profiles
    FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update_admin ON public.profiles
    FOR UPDATE TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
-- Profile creation is performed by server code (Phase 2), not by clients.

-- User roles: read own; only admins (or server code) grant roles ---------------
CREATE POLICY user_roles_select_own ON public.user_roles
    FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_roles_admin_all ON public.user_roles
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Taxonomy & geography: active rows are public; admins manage ------------------
-- NOTE: docs/DATABASE_SCHEMA.md section 5.1 ties public read of these tables to
-- storefront visibility. That cannot work for the locality selector or the
-- onboarding form (no storefront exists yet), so active taxonomy rows are
-- readable by everyone. See PROJECT_STATE.md for the recorded deviation.
CREATE POLICY localities_public_read ON public.localities
    FOR SELECT TO anon, authenticated USING (is_active = TRUE);
CREATE POLICY localities_admin_all ON public.localities
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

CREATE POLICY categories_public_read ON public.categories
    FOR SELECT TO anon, authenticated USING (is_active = TRUE);
CREATE POLICY categories_admin_all ON public.categories
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

CREATE POLICY subcategories_public_read ON public.subcategories
    FOR SELECT TO anon, authenticated USING (is_active = TRUE);
CREATE POLICY subcategories_admin_all ON public.subcategories
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Merchant applications -------------------------------------------------------
CREATE POLICY apps_insert_own ON public.merchant_applications
    FOR INSERT TO authenticated
    WITH CHECK (applicant_user_id = auth.uid() AND status IN ('draft', 'submitted'));
CREATE POLICY apps_select_own ON public.merchant_applications
    FOR SELECT TO authenticated USING (applicant_user_id = auth.uid());
CREATE POLICY apps_update_own ON public.merchant_applications
    FOR UPDATE TO authenticated
    USING (applicant_user_id = auth.uid() AND status IN ('draft', 'correction_requested'))
    WITH CHECK (applicant_user_id = auth.uid() AND status IN ('draft', 'submitted'));
CREATE POLICY apps_select_admin ON public.merchant_applications
    FOR SELECT TO authenticated USING (public.has_role('admin'));
CREATE POLICY apps_update_admin ON public.merchant_applications
    FOR UPDATE TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Businesses & membership ---------------------------------------------------
-- Creation happens only in the atomic approval pipeline (service role).
CREATE POLICY businesses_select_member ON public.businesses
    FOR SELECT TO authenticated USING (public.is_business_member(id));
CREATE POLICY businesses_admin_all ON public.businesses
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

CREATE POLICY business_members_select_own ON public.business_members
    FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY business_members_select_peers ON public.business_members
    FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY business_members_admin_all ON public.business_members
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Shops ----------------------------------------------------------------------
CREATE POLICY shops_public_read ON public.shops
    FOR SELECT TO anon, authenticated USING (public.is_shop_publicly_visible(id));
CREATE POLICY shops_select_member ON public.shops
    FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY shops_update_member ON public.shops
    FOR UPDATE TO authenticated
    USING (public.is_business_member(business_id))
    WITH CHECK (public.is_business_member(business_id));
CREATE POLICY shops_admin_all ON public.shops
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Storefronts ----------------------------------------------------------------
CREATE POLICY storefronts_public_read ON public.storefronts
    FOR SELECT TO anon, authenticated
    USING (is_published = TRUE AND visibility_status = 'visible' AND public.is_shop_publicly_visible(shop_id));
CREATE POLICY storefronts_select_member ON public.storefronts
    FOR SELECT TO authenticated USING (public.is_shop_member(shop_id));
CREATE POLICY storefronts_update_member ON public.storefronts
    FOR UPDATE TO authenticated
    USING (public.is_shop_member(shop_id))
    WITH CHECK (public.is_shop_member(shop_id));
CREATE POLICY storefronts_admin_all ON public.storefronts
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Storefront products -----------------------------------------------------------
CREATE POLICY products_public_read ON public.storefront_products
    FOR SELECT TO anon, authenticated USING (public.is_shop_publicly_visible(shop_id));
CREATE POLICY products_member_all ON public.storefront_products
    FOR ALL TO authenticated
    USING (public.is_shop_member(shop_id))
    WITH CHECK (public.is_shop_member(shop_id));
CREATE POLICY products_admin_all ON public.storefront_products
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- "Help Me Find It" ------------------------------------------------------------
-- Anonymous customers may submit; reads of tracking status go through the API.
CREATE POLICY hmf_insert_public ON public.help_me_find_it_requests
    FOR INSERT TO anon, authenticated
    WITH CHECK (
        status = 'pending'
        AND matched_shop_id IS NULL
        AND operator_id IS NULL
        AND (customer_user_id IS NULL OR customer_user_id = auth.uid())
    );
CREATE POLICY hmf_select_own ON public.help_me_find_it_requests
    FOR SELECT TO authenticated USING (customer_user_id = auth.uid());
CREATE POLICY hmf_select_staff ON public.help_me_find_it_requests
    FOR SELECT TO authenticated USING (public.has_role('admin') OR public.has_role('operator'));
CREATE POLICY hmf_update_staff ON public.help_me_find_it_requests
    FOR UPDATE TO authenticated
    USING (public.has_role('admin') OR public.has_role('operator'))
    WITH CHECK (public.has_role('admin') OR public.has_role('operator'));

-- Feature flags: readable by all (gating UI), writable by admins --------------
CREATE POLICY flags_public_read ON public.feature_flags
    FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY flags_admin_all ON public.feature_flags
    FOR ALL TO authenticated USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

-- Audit logs: admins may read; nobody but server code may write ---------------
CREATE POLICY audit_select_admin ON public.audit_logs
    FOR SELECT TO authenticated USING (public.has_role('admin'));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated;

-- Audit immutability -----------------------------------------------------------
-- Rows may never be deleted or edited. The single exception is the engine's own
-- `ON DELETE SET NULL` on actor_id (profile removal), which is allowed only when
-- nothing else on the row changes.
CREATE OR REPLACE FUNCTION public.enforce_audit_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.actor_id IS NULL
           AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'audit_logs rows are immutable (% blocked)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.enforce_audit_immutability();

CREATE TRIGGER trg_audit_logs_no_truncate
    BEFORE TRUNCATE ON public.audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_audit_immutability();

-- Column guards ----------------------------------------------------------------
-- RLS cannot restrict individual columns. These triggers stop non-admin
-- end-users from editing fields reserved for the platform. Server-side code
-- running as service role (auth.uid() IS NULL) is unaffected.

CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('admin') THEN
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'profiles.is_active is admin-only' USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_application_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('admin') THEN
        IF NEW.applicant_user_id IS DISTINCT FROM OLD.applicant_user_id
           OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
           OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
           OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
           OR NEW.correction_notes IS DISTINCT FROM OLD.correction_notes
           OR NEW.associated_business_id IS DISTINCT FROM OLD.associated_business_id THEN
            RAISE EXCEPTION 'review fields on merchant_applications are admin-only'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_shop_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('admin') THEN
        IF NEW.business_id IS DISTINCT FROM OLD.business_id
           OR NEW.shop_code IS DISTINCT FROM OLD.shop_code
           OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'business_id, shop_code and is_active on shops are admin-only'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_storefront_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.has_role('admin') THEN
        IF NEW.shop_id IS DISTINCT FROM OLD.shop_id
           OR NEW.slug IS DISTINCT FROM OLD.slug
           OR NEW.is_published IS DISTINCT FROM OLD.is_published
           OR NEW.visibility_status IS DISTINCT FROM OLD.visibility_status
           OR NEW.ordering_enabled IS DISTINCT FROM OLD.ordering_enabled
           OR NEW.template_name IS DISTINCT FROM OLD.template_name THEN
            RAISE EXCEPTION 'platform-controlled storefront fields are admin-only'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_guard BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();
CREATE TRIGGER trg_merchant_applications_guard BEFORE UPDATE ON public.merchant_applications
    FOR EACH ROW EXECUTE FUNCTION public.guard_application_update();
CREATE TRIGGER trg_shops_guard BEFORE UPDATE ON public.shops
    FOR EACH ROW EXECUTE FUNCTION public.guard_shop_update();
CREATE TRIGGER trg_storefronts_guard BEFORE UPDATE ON public.storefronts
    FOR EACH ROW EXECUTE FUNCTION public.guard_storefront_update();
