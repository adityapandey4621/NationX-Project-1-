-- 020: subcategories you can manage, searchable, and chosen on the application; admin-defined category
-- attributes (ADR-015). Spec: REQ-ADM-03 (CRUD over categories, subcategories, custom category attributes),
-- REQ-APP-01 (category AND subcategory on the application), REQ-HOM-03 (category and subcategory navigation).
--
-- Design in one paragraph: an administrator defines, per category, extra questions ("attributes": text, number,
-- one-of-a-list, yes/no). An applicant answers them on the application (stored in the existing
-- merchant_applications.category_specific_data). The database validates the answers on every save and requires the
-- mandatory ones on submit, so no client can bypass it. On approval the answers are copied to the shop
-- (shops.category_details) and shown on its public page. Nothing here changes who may approve or publish.

-- 1. Subcategories ---------------------------------------------------------------------------
-- Admin writes go through an audited function (the table keeps its existing admin policy as a fallback).
CREATE FUNCTION public.admin_save_subcategory(
    p_id UUID, p_category_id UUID, p_name TEXT, p_slug TEXT, p_display_order INT, p_is_active BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_name TEXT := BTRIM(REGEXP_REPLACE(COALESCE(p_name, ''), '\s+', ' ', 'g'));
    v_slug TEXT := LOWER(BTRIM(COALESCE(p_slug, '')));
    v_id UUID;
    v_prev JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF CHAR_LENGTH(v_name) NOT BETWEEN 2 AND 60 THEN
        RAISE EXCEPTION 'the name must be 2 to 60 characters' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(p_display_order, 0) NOT BETWEEN 0 AND 10000 THEN
        RAISE EXCEPTION 'the order must be between 0 and 10000' USING ERRCODE = 'check_violation';
    END IF;

    IF p_id IS NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.categories WHERE id = p_category_id) THEN
            RAISE EXCEPTION 'category not found' USING ERRCODE = 'no_data_found';
        END IF;
        IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR CHAR_LENGTH(v_slug) > 80 THEN
            RAISE EXCEPTION 'the web address may use lowercase letters, digits and single hyphens only' USING ERRCODE = 'check_violation';
        END IF;
        INSERT INTO public.subcategories (category_id, name, slug, display_order, is_active)
        VALUES (p_category_id, v_name, v_slug, COALESCE(p_display_order, 0), COALESCE(p_is_active, TRUE))
        RETURNING id INTO v_id;
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, new_state)
        VALUES (auth.uid(), 'subcategory.created', 'subcategory', v_id,
                JSONB_BUILD_OBJECT('name', v_name, 'slug', v_slug, 'category_id', p_category_id));
    ELSE
        SELECT TO_JSONB(s) - 'created_at' INTO v_prev FROM public.subcategories s WHERE s.id = p_id;
        IF v_prev IS NULL THEN
            RAISE EXCEPTION 'subcategory not found' USING ERRCODE = 'no_data_found';
        END IF;
        -- The category and web address never change after creation (links and shops depend on them).
        UPDATE public.subcategories
        SET name = v_name, display_order = COALESCE(p_display_order, display_order), is_active = COALESCE(p_is_active, is_active)
        WHERE id = p_id;
        v_id := p_id;
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
        VALUES (auth.uid(), 'subcategory.updated', 'subcategory', v_id, v_prev,
                JSONB_BUILD_OBJECT('name', v_name, 'display_order', p_display_order, 'is_active', p_is_active));
    END IF;
    RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_save_subcategory(UUID, UUID, TEXT, TEXT, INT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_subcategory(UUID, UUID, TEXT, TEXT, INT, BOOLEAN) TO authenticated;

-- A subcategory name is part of what customers can search for.
CREATE OR REPLACE FUNCTION public.shop_search_text(p_shop_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT CONCAT_WS(' ', s.name, c.name, sc.name, l.name, s.address_line, s.landmark, s.pincode)
    FROM public.shops s
    JOIN public.categories c ON c.id = s.category_id
    JOIN public.localities l ON l.id = s.locality_id
    LEFT JOIN public.subcategories sc ON sc.id = s.subcategory_id
    WHERE s.id = p_shop_id;
$$;
REVOKE ALL ON FUNCTION public.shop_search_text(UUID) FROM PUBLIC, anon, authenticated;

-- Renaming a subcategory re-indexes the shops that use it (same pattern as categories and localities).
CREATE FUNCTION public.touch_storefronts_for_subcategory()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    UPDATE public.storefronts SET search_text = search_text
    WHERE shop_id IN (SELECT id FROM public.shops WHERE subcategory_id = NEW.id);
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_storefronts_for_subcategory() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_subcategories_touch_storefronts AFTER UPDATE OF name ON public.subcategories
    FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION public.touch_storefronts_for_subcategory();

-- Shops that already have a subcategory become searchable by it now.
UPDATE public.storefronts SET search_text = search_text
WHERE shop_id IN (SELECT id FROM public.shops WHERE subcategory_id IS NOT NULL);

-- An applicant's subcategory must belong to the chosen category and be active (unchanged old choices are kept).
CREATE FUNCTION public.merchant_applications_check_subcategory()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    -- Decisions by an administrator (approve may reassign the category) are not the applicant's choice.
    IF NEW.status IN ('approved', 'rejected', 'suspended') OR NEW.subcategory_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.subcategory_id IS NOT DISTINCT FROM NEW.subcategory_id
       AND OLD.category_id IS NOT DISTINCT FROM NEW.category_id THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.subcategories sc
        WHERE sc.id = NEW.subcategory_id AND sc.category_id = NEW.category_id AND sc.is_active
    ) THEN
        RAISE EXCEPTION 'the subcategory does not belong to the chosen category' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_applications_check_subcategory() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_merchant_applications_check_subcategory BEFORE INSERT OR UPDATE ON public.merchant_applications
    FOR EACH ROW EXECUTE FUNCTION public.merchant_applications_check_subcategory();

-- 2. Category attributes ---------------------------------------------------------------------
CREATE FUNCTION public.attribute_options_valid(p_options TEXT[])
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
    SELECT COALESCE(BOOL_AND(CHAR_LENGTH(BTRIM(o)) BETWEEN 1 AND 40), TRUE) FROM UNNEST(p_options) AS o;
$$;

CREATE TABLE public.category_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
    label TEXT NOT NULL CHECK (CHAR_LENGTH(BTRIM(label)) BETWEEN 2 AND 80),
    help_text TEXT CHECK (help_text IS NULL OR CHAR_LENGTH(help_text) <= 200),
    field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'choice', 'yes_no')),
    options TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 10000),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (category_id, key),
    CHECK (
        (field_type = 'choice' AND CARDINALITY(options) BETWEEN 2 AND 12 AND public.attribute_options_valid(options))
        OR (field_type <> 'choice' AND CARDINALITY(options) = 0)
    )
);
CREATE INDEX idx_category_attributes_category ON public.category_attributes (category_id, display_order);

ALTER TABLE public.category_attributes ENABLE ROW LEVEL SECURITY;
-- Applicants (and the public storefront) read the active questions; the administrator also sees switched-off ones.
CREATE POLICY category_attributes_public_read ON public.category_attributes FOR SELECT USING (is_active);
CREATE POLICY category_attributes_admin_read ON public.category_attributes FOR SELECT USING (public.has_role('admin'));
REVOKE ALL ON public.category_attributes FROM anon, authenticated;
GRANT SELECT ON public.category_attributes TO anon, authenticated;

CREATE FUNCTION public.admin_save_category_attribute(
    p_id UUID, p_category_id UUID, p_key TEXT, p_label TEXT, p_help_text TEXT, p_field_type TEXT,
    p_options TEXT[], p_is_required BOOLEAN, p_display_order INT, p_is_active BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_label TEXT := BTRIM(REGEXP_REPLACE(COALESCE(p_label, ''), '\s+', ' ', 'g'));
    v_key TEXT := LOWER(BTRIM(COALESCE(p_key, '')));
    v_options TEXT[];
    v_id UUID;
    v_prev JSONB;
    v_type TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'administrator role required' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF CHAR_LENGTH(v_label) NOT BETWEEN 2 AND 80 THEN
        RAISE EXCEPTION 'the question must be 2 to 80 characters' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(ARRAY_AGG(BTRIM(o) ORDER BY ord), ARRAY[]::TEXT[]) INTO v_options
    FROM UNNEST(COALESCE(p_options, ARRAY[]::TEXT[])) WITH ORDINALITY AS t(o, ord) WHERE BTRIM(o) <> '';

    IF p_id IS NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.categories WHERE id = p_category_id) THEN
            RAISE EXCEPTION 'category not found' USING ERRCODE = 'no_data_found';
        END IF;
        IF (SELECT COUNT(*) FROM public.category_attributes WHERE category_id = p_category_id AND is_active) >= 20 THEN
            RAISE EXCEPTION 'a category can have at most 20 questions; turn one off first' USING ERRCODE = 'check_violation';
        END IF;
        INSERT INTO public.category_attributes (category_id, key, label, help_text, field_type, options, is_required, display_order, is_active)
        VALUES (p_category_id, v_key, v_label, NULLIF(BTRIM(p_help_text), ''), COALESCE(p_field_type, ''),
                CASE WHEN p_field_type = 'choice' THEN v_options ELSE ARRAY[]::TEXT[] END,
                COALESCE(p_is_required, FALSE), COALESCE(p_display_order, 0), COALESCE(p_is_active, TRUE))
        RETURNING id INTO v_id;
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, new_state)
        VALUES (auth.uid(), 'category_attribute.created', 'category_attribute', v_id,
                JSONB_BUILD_OBJECT('category_id', p_category_id, 'key', v_key, 'label', v_label, 'field_type', p_field_type,
                                   'is_required', COALESCE(p_is_required, FALSE)));
    ELSE
        SELECT TO_JSONB(a) - 'created_at' - 'updated_at', a.field_type INTO v_prev, v_type
        FROM public.category_attributes a WHERE a.id = p_id;
        IF v_prev IS NULL THEN
            RAISE EXCEPTION 'question not found' USING ERRCODE = 'no_data_found';
        END IF;
        -- Key and answer type never change: stored answers depend on them.
        UPDATE public.category_attributes
        SET label = v_label, help_text = NULLIF(BTRIM(p_help_text), ''),
            options = CASE WHEN v_type = 'choice' THEN v_options ELSE ARRAY[]::TEXT[] END,
            is_required = COALESCE(p_is_required, is_required), display_order = COALESCE(p_display_order, display_order),
            is_active = COALESCE(p_is_active, is_active), updated_at = NOW()
        WHERE id = p_id;
        v_id := p_id;
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
        VALUES (auth.uid(), 'category_attribute.updated', 'category_attribute', v_id, v_prev,
                JSONB_BUILD_OBJECT('label', v_label, 'is_required', p_is_required, 'is_active', p_is_active, 'options', v_options));
    END IF;
    RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_save_category_attribute(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, INT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_category_attribute(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], BOOLEAN, INT, BOOLEAN) TO authenticated;

-- 3. Answers are validated by the database on every save --------------------------------------
CREATE FUNCTION public.merchant_applications_check_details()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_key TEXT;
    v_val JSONB;
    v_attr public.category_attributes%ROWTYPE;
BEGIN
    IF NEW.status IN ('approved', 'rejected', 'suspended') THEN RETURN NEW; END IF;
    IF NEW.category_specific_data IS NULL OR JSONB_TYPEOF(NEW.category_specific_data) <> 'object' THEN
        RAISE EXCEPTION 'the extra details must be an object' USING ERRCODE = 'check_violation';
    END IF;
    IF OCTET_LENGTH(NEW.category_specific_data::TEXT) > 8000 THEN
        RAISE EXCEPTION 'the extra details are too long' USING ERRCODE = 'check_violation';
    END IF;

    FOR v_key, v_val IN SELECT * FROM JSONB_EACH(NEW.category_specific_data) LOOP
        SELECT * INTO v_attr FROM public.category_attributes
        WHERE category_id = NEW.category_id AND key = v_key AND is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'unknown detail "%" for this category', LEFT(v_key, 40) USING ERRCODE = 'check_violation';
        END IF;
        IF v_attr.field_type = 'text' AND (JSONB_TYPEOF(v_val) <> 'string' OR CHAR_LENGTH(v_val #>> '{}') > 200) THEN
            RAISE EXCEPTION '"%" must be text of at most 200 characters', v_attr.label USING ERRCODE = 'check_violation';
        ELSIF v_attr.field_type = 'number' AND (JSONB_TYPEOF(v_val) <> 'number' OR (v_val #>> '{}')::NUMERIC NOT BETWEEN -1000000000 AND 1000000000) THEN
            RAISE EXCEPTION '"%" must be a number', v_attr.label USING ERRCODE = 'check_violation';
        ELSIF v_attr.field_type = 'choice' AND (JSONB_TYPEOF(v_val) <> 'string' OR NOT ((v_val #>> '{}') = ANY (v_attr.options))) THEN
            RAISE EXCEPTION '"%" must be one of the listed choices', v_attr.label USING ERRCODE = 'check_violation';
        ELSIF v_attr.field_type = 'yes_no' AND JSONB_TYPEOF(v_val) <> 'boolean' THEN
            RAISE EXCEPTION '"%" must be yes or no', v_attr.label USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    -- Mandatory questions are enforced when the application is sent in, not while it is still a draft.
    IF NEW.status = 'submitted' THEN
        FOR v_attr IN SELECT * FROM public.category_attributes WHERE category_id = NEW.category_id AND is_active AND is_required LOOP
            IF NOT (NEW.category_specific_data ? v_attr.key) THEN
                RAISE EXCEPTION 'please answer "%"', v_attr.label USING ERRCODE = 'check_violation';
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.merchant_applications_check_details() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_merchant_applications_check_details BEFORE INSERT OR UPDATE ON public.merchant_applications
    FOR EACH ROW EXECUTE FUNCTION public.merchant_applications_check_details();

-- 4. Approved shops carry the answers ---------------------------------------------------------
ALTER TABLE public.shops ADD COLUMN category_details JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Only an administrator (or the approval itself) may change a shop's category details.
CREATE FUNCTION public.shops_guard_category_details()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF NEW.category_details IS DISTINCT FROM OLD.category_details
       AND auth.uid() IS NOT NULL AND NOT public.has_role('admin') THEN
        RAISE EXCEPTION 'category details are set by the application and reviewed by NationX' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.shops_guard_category_details() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_shops_guard_category_details BEFORE UPDATE ON public.shops
    FOR EACH ROW EXECUTE FUNCTION public.shops_guard_category_details();

CREATE FUNCTION public.copy_application_details_to_shop()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    UPDATE public.shops SET category_details = NEW.category_specific_data
    WHERE business_id = NEW.associated_business_id AND shop_code = 'MAIN';
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.copy_application_details_to_shop() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_copy_application_details AFTER UPDATE OF status ON public.merchant_applications
    FOR EACH ROW WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' AND NEW.associated_business_id IS NOT NULL)
    EXECUTE FUNCTION public.copy_application_details_to_shop();
