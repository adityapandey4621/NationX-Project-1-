-- ============================================================================
-- seed.sql — NationX Foundation, Phase 1 reference data
-- Scope: only operational reference data named in docs/DEVELOPMENT_ROADMAP.md
-- (Phase 1): Khammam localities and the five standard categories.
-- No shops, products, users, ratings or other business data is seeded.
--
-- [UNRESOLVED] Pincodes: DATABASE_SCHEMA.md requires pincode NOT NULL, but no
-- per-locality pincode is specified in the docs. 507001 (Khammam city head
-- post office area) is used as a placeholder for all four city localities and
-- MUST be verified/corrected by an admin before launch.
--
-- Additional localities (the roadmap says "etc.") and subcategories are to be
-- supplied by the NationX team via the admin taxonomy tools (REQ-ADM-03).
-- Idempotent: safe to run repeatedly.
-- ============================================================================

INSERT INTO public.localities (name, slug, district, state, pincode) VALUES
    ('Gandhi Chowk',          'gandhi-chowk',          'Khammam', 'Telangana', '507001'),
    ('Wyra Road',             'wyra-road',             'Khammam', 'Telangana', '507001'),
    ('Mamata Hospital Road',  'mamata-hospital-road',  'Khammam', 'Telangana', '507001'),
    ('Rotary Nagar',          'rotary-nagar',          'Khammam', 'Telangana', '507001')
ON CONFLICT (slug) DO NOTHING;

-- default_template picks the storefront layout generated on approval
-- ([PROPOSED] mapping; admin-editable via taxonomy management).
INSERT INTO public.categories (name, slug, display_order, default_template) VALUES
    ('Kirana',     'kirana',     10, 'grocery'),
    ('Pharmacy',   'pharmacy',   20, 'standard_retail'),
    ('Hardware',   'hardware',   30, 'standard_retail'),
    ('Electrical', 'electrical', 40, 'service_provider'),
    ('Salons',     'salons',     50, 'service_provider')
ON CONFLICT (slug) DO NOTHING;
