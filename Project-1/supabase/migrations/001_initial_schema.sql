-- ============================================================================
-- 001_initial_schema.sql — NationX Foundation, Phase 1
-- Source of truth: docs/DATABASE_SCHEMA.md (sections 3 and 4)
-- ============================================================================

-- Extensions ---------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Shared trigger: keep updated_at current ------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 3.1 Identity & User Profiles ----------------------------------------------
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'te')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('customer', 'merchant', 'admin', 'operator')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, role)
);

-- 3.2 Geographic & Taxonomy Backbone ----------------------------------------
CREATE TABLE public.localities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    district TEXT NOT NULL DEFAULT 'Khammam',
    state TEXT NOT NULL DEFAULT 'Telangana',
    pincode TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    icon_url TEXT,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.subcategories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.3 Merchant Onboarding Applications --------------------------------------
CREATE TABLE public.merchant_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    applicant_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    business_name TEXT NOT NULL,
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
    subcategory_id UUID REFERENCES public.subcategories(id) ON DELETE RESTRICT,
    contact_phone TEXT NOT NULL,
    contact_email TEXT,
    whatsapp_number TEXT,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    locality_id UUID NOT NULL REFERENCES public.localities(id) ON DELETE RESTRICT,
    landmark TEXT,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    opening_time TIME,
    closing_time TIME,
    weekly_off_days TEXT[],
    business_description TEXT,
    logo_storage_path TEXT,
    photos_storage_paths TEXT[],
    operating_models TEXT[] NOT NULL DEFAULT ARRAY['visit_only'] CHECK (
        operating_models <@ ARRAY['delivery', 'pickup', 'visit_only', 'appointment', 'quotation']
    ),
    category_specific_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'submitted', 'correction_requested', 'approved', 'rejected', 'suspended')
    ),
    rejection_reason TEXT,
    correction_notes TEXT,
    reviewed_by UUID REFERENCES public.profiles(id),
    reviewed_at TIMESTAMPTZ,
    associated_business_id UUID, -- populated after approval; FK added below
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.4 Authoritative Business, Shop & Storefront Records ----------------------
CREATE TABLE public.businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    legal_name TEXT,
    pan_number TEXT,
    gstin TEXT,
    primary_owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    origin_application_id UUID UNIQUE REFERENCES public.merchant_applications(id),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Back-reference from application to the business created on approval.
-- Added after `businesses` exists to avoid a circular table dependency.
ALTER TABLE public.merchant_applications
    ADD CONSTRAINT merchant_applications_associated_business_fk
    FOREIGN KEY (associated_business_id) REFERENCES public.businesses(id) ON DELETE RESTRICT;

CREATE TABLE public.business_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'employee')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, user_id)
);

CREATE TABLE public.shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    shop_code TEXT NOT NULL, -- e.g., 'MAIN', 'BRANCH-1'
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
    subcategory_id UUID REFERENCES public.subcategories(id) ON DELETE RESTRICT,
    locality_id UUID NOT NULL REFERENCES public.localities(id) ON DELETE RESTRICT,
    address_line TEXT NOT NULL,
    landmark TEXT,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    phone TEXT NOT NULL,
    whatsapp TEXT,
    operating_hours JSONB NOT NULL DEFAULT '{"opens": "09:00", "closes": "21:00", "closed_days": []}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, shop_code)
);

CREATE TABLE public.storefronts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID UNIQUE NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    slug TEXT UNIQUE NOT NULL, -- e.g., "sri-lakshmi-kirana-khammam"
    headline TEXT,
    description TEXT,
    logo_url TEXT,
    banner_url TEXT,
    gallery_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    template_name TEXT NOT NULL DEFAULT 'standard_retail' CHECK (
        template_name IN ('standard_retail', 'grocery', 'service_provider', 'artisan')
    ),
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    visibility_status TEXT NOT NULL DEFAULT 'visible' CHECK (
        visibility_status IN ('visible', 'hidden', 'suspended')
    ),
    supported_actions TEXT[] NOT NULL DEFAULT ARRAY['call', 'directions'] CHECK (
        supported_actions <@ ARRAY['call', 'whatsapp', 'directions', 'appointment', 'inquiry', 'order']
    ),
    ordering_enabled BOOLEAN NOT NULL DEFAULT FALSE, -- strictly disabled until catalog is certified
    meta_title TEXT,
    meta_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.storefront_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_te TEXT, -- Telugu name
    description TEXT,
    category_id UUID REFERENCES public.categories(id),
    price NUMERIC(10, 2),
    mrp NUMERIC(10, 2),
    unit TEXT, -- e.g. 'kg', 'pack', 'liter'
    stock_status TEXT NOT NULL DEFAULT 'call_to_confirm' CHECK (
        stock_status IN ('in_stock', 'call_to_confirm', 'out_of_stock')
    ),
    image_url TEXT,
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.5 Customer Demand & Operations ------------------------------------------
CREATE TABLE public.help_me_find_it_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tracking_id TEXT UNIQUE NOT NULL, -- e.g. "HMF-KHM-202611-001"
    customer_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    item_name TEXT NOT NULL,
    item_description TEXT,
    preferred_locality_id UUID NOT NULL REFERENCES public.localities(id) ON DELETE RESTRICT,
    contact_phone TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'under_review', 'matched', 'unresolved', 'cancelled')
    ),
    matched_shop_id UUID REFERENCES public.shops(id),
    resolution_notes TEXT,
    operator_id UUID REFERENCES public.profiles(id),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.6 Administration, Feature Flags & Audit Logs ----------------------------
CREATE TABLE public.feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_localities UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    previous_state JSONB,
    new_state JSONB,
    reason TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes ------------------------------------------------------------------
CREATE INDEX idx_shops_name_trgm ON public.shops USING gin (name gin_trgm_ops);
CREATE INDEX idx_storefronts_slug ON public.storefronts(slug);
CREATE INDEX idx_products_name_trgm ON public.storefront_products USING gin (name gin_trgm_ops);
CREATE INDEX idx_products_name_te_trgm ON public.storefront_products USING gin (name_te gin_trgm_ops);
CREATE INDEX idx_shops_locality ON public.shops(locality_id);
CREATE INDEX idx_storefronts_shop_id ON public.storefronts(shop_id);
CREATE INDEX idx_apps_applicant ON public.merchant_applications(applicant_user_id);
CREATE INDEX idx_audit_entity ON public.audit_logs(entity_type, entity_id);

-- updated_at triggers -------------------------------------------------------
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_merchant_applications_updated_at BEFORE UPDATE ON public.merchant_applications
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_businesses_updated_at BEFORE UPDATE ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_shops_updated_at BEFORE UPDATE ON public.shops
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_storefronts_updated_at BEFORE UPDATE ON public.storefronts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_storefront_products_updated_at BEFORE UPDATE ON public.storefront_products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_help_me_find_it_updated_at BEFORE UPDATE ON public.help_me_find_it_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_feature_flags_updated_at BEFORE UPDATE ON public.feature_flags
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
