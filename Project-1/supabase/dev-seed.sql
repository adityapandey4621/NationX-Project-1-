-- ============================================================================
-- dev-seed.sql — DEVELOPMENT-ONLY sample marketplace data. NEVER run in production.
--
-- Applied only by `npm run dev:stack` (local throwaway Postgres). It needs the
-- stub `auth.users` table of that local stack and cannot run on hosted Supabase.
--
-- Every listing is plainly named "Sample …", carries storefronts.is_sample = TRUE
-- (the UI shows a "Sample listing" badge) and uses invented numbers (555-style
-- phone numbers, no photos). Nothing here is a real business, price or stock
-- statement. It also adds three extra categories to show that a new category
-- needs no code change: it only needs a row (and picks one of four templates).
-- Idempotent: safe to run repeatedly.
-- ============================================================================

INSERT INTO public.categories (name, slug, display_order, default_template) VALUES
    ('Fruits & Vegetables', 'fruits-vegetables', 15, 'grocery'),
    ('Fashion',             'fashion',            60, 'standard_retail'),
    ('Restaurants',         'restaurants',        70, 'artisan')
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
    v_owner UUID := '00000000-0000-4000-8000-0000000d3500';
    v_row RECORD;
    v_business UUID;
    v_shop UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM public.storefronts WHERE is_sample) THEN
        RETURN; -- already seeded
    END IF;

    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_owner, 'sample-owner@example.invalid', '{"full_name":"Sample Owner","phone":"+919000000999"}')
    ON CONFLICT (id) DO NOTHING;

    FOR v_row IN
        SELECT * FROM (VALUES
            ('Sample Daily Kirana',        'sample-daily-kirana',        'kirana',            'gandhi-chowk',         'Everyday groceries, grains and oils (sample listing).',            ARRAY['visit_only','pickup'],             '08:00', '21:30', '["sunday"]',  1),
            ('Sample Fresh Basket',        'sample-fresh-basket',        'fruits-vegetables', 'wyra-road',            'Seasonal fruit and vegetables (sample listing).',                  ARRAY['visit_only','pickup','delivery'], '06:00', '20:00', '[]',          2),
            ('Sample Care Pharmacy',       'sample-care-pharmacy',       'pharmacy',          'mamata-hospital-road', 'Medicines and health basics (sample listing).',                    ARRAY['visit_only','pickup'],             '08:00', '23:00', '[]',          3),
            ('Sample Bolt & Tool Hardware','sample-bolt-and-tool',       'hardware',          'rotary-nagar',         'Tools, fittings and paint (sample listing).',                      ARRAY['visit_only','quotation'],          '09:00', '19:30', '["sunday"]',  4),
            ('Sample Spark Electricals',   'sample-spark-electricals',   'electrical',        'gandhi-chowk',         'Wiring, repairs and appliances (sample listing).',                 ARRAY['visit_only','quotation','appointment'], '09:30', '20:00', '["sunday"]', 5),
            ('Sample Glow Salon',          'sample-glow-salon',          'salons',            'wyra-road',            'Haircuts and grooming by appointment (sample listing).',           ARRAY['appointment','visit_only'],        '10:00', '20:00', '["monday"]',  6),
            ('Sample Thread & Loom',       'sample-thread-and-loom',     'fashion',           'rotary-nagar',         'Everyday and festive clothing (sample listing).',                  ARRAY['visit_only'],                      '10:00', '21:00', '[]',          7),
            ('Sample Spice Route Kitchen', 'sample-spice-route-kitchen', 'restaurants',       'mamata-hospital-road', 'Home-style meals, dine-in and pickup (sample listing).',           ARRAY['visit_only','pickup'],             '11:00', '23:00', '[]',          8)
        ) AS t(name, slug, cat, loc, descr, models, opens, closes, closed, n)
    LOOP
        INSERT INTO public.businesses (name, primary_owner_id) VALUES (v_row.name, v_owner) RETURNING id INTO v_business;

        INSERT INTO public.shops (business_id, name, shop_code, category_id, locality_id, address_line, phone, whatsapp,
                                  pincode, operating_models, operating_hours)
        VALUES (v_business, v_row.name, 'MAIN',
                (SELECT id FROM public.categories WHERE slug = v_row.cat),
                (SELECT id FROM public.localities WHERE slug = v_row.loc),
                'Sample address ' || v_row.n, '+91900000' || LPAD(v_row.n::TEXT, 4, '0'), '+91900000' || LPAD(v_row.n::TEXT, 4, '0'),
                '507001', v_row.models,
                JSONB_BUILD_OBJECT('opens', v_row.opens, 'closes', v_row.closes, 'closed_days', v_row.closed::JSONB))
        RETURNING id INTO v_shop;

        INSERT INTO public.storefronts (shop_id, slug, headline, description, template_name, supported_actions, is_sample)
        VALUES (v_shop, v_row.slug, 'Sample listing', v_row.descr,
                (SELECT default_template FROM public.categories WHERE slug = v_row.cat),
                ARRAY['call','whatsapp','directions'], TRUE);
    END LOOP;

    -- Sample items: a mix of priced / unpriced and in-stock / unconfirmed, as real shops would have.
    INSERT INTO public.storefront_products (shop_id, name, unit, price, mrp, stock_status)
    SELECT s.id, p.name, p.unit, p.price, p.mrp, p.stock
    FROM (VALUES
        ('sample-daily-kirana', 'Sample Basmati Rice',    '1 kg',   82.00, 95.00, 'in_stock'),
        ('sample-daily-kirana', 'Sample Toor Dal',        '1 kg',  NULL::NUMERIC, NULL::NUMERIC, 'call_to_confirm'),
        ('sample-daily-kirana', 'Sample Groundnut Oil',   '1 L',  165.00, NULL, 'in_stock'),
        ('sample-fresh-basket', 'Sample Tomatoes',        '1 kg',   32.00, NULL, 'in_stock'),
        ('sample-fresh-basket', 'Sample Bananas',         '1 dozen',NULL, NULL, 'call_to_confirm'),
        ('sample-care-pharmacy','Sample Glucose Powder',  '200 g',  NULL, NULL, 'call_to_confirm'),
        ('sample-bolt-and-tool','Sample Claw Hammer',     '1 pc',  260.00, 299.00, 'in_stock'),
        ('sample-spark-electricals','Sample LED Bulb 9W', '1 pc',   90.00, NULL, 'in_stock'),
        ('sample-thread-and-loom','Sample Cotton Kurta',  '1 pc',  NULL, NULL, 'call_to_confirm')
    ) AS p(slug, name, unit, price, mrp, stock)
    JOIN public.storefronts sf ON sf.slug = p.slug
    JOIN public.shops s ON s.id = sf.shop_id;
END $$;
