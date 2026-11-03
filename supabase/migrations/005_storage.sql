-- ============================================================================
-- 005_storage.sql — Storage buckets and access policies (docs/SECURITY.md §5)
--
-- private-merchant-kyc      : application photos/logo/documents. Path:
--                             {user_id}/{application_id}/{file}. Readable only by
--                             the applicant and admins. 10 MB, images + PDF.
-- public-storefront-assets  : published storefront images. Path: {shop_id}/{file}.
--                             Public read; only owners/managers of that shop write.
--                             5 MB, images only.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
    ('private-merchant-kyc', 'private-merchant-kyc', FALSE, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    ('public-storefront-assets', 'public-storefront-assets', TRUE, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- True when the first path segment is a UUID naming a shop the caller manages.
-- (CASE avoids casting non-UUID folder names.)
CREATE OR REPLACE FUNCTION public.storage_path_is_managed_shop(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT CASE
        WHEN (STRING_TO_ARRAY(p_name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.is_shop_manager(((STRING_TO_ARRAY(p_name, '/'))[1])::UUID)
        ELSE FALSE
    END;
$$;
REVOKE ALL ON FUNCTION public.storage_path_is_managed_shop(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_path_is_managed_shop(TEXT) TO anon, authenticated;

-- Private bucket: owner folder only (+ admin read) ------------------------------
CREATE POLICY kyc_insert_own ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'private-merchant-kyc' AND (STRING_TO_ARRAY(name, '/'))[1] = auth.uid()::TEXT);
CREATE POLICY kyc_select_own ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'private-merchant-kyc' AND (STRING_TO_ARRAY(name, '/'))[1] = auth.uid()::TEXT);
CREATE POLICY kyc_delete_own ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'private-merchant-kyc' AND (STRING_TO_ARRAY(name, '/'))[1] = auth.uid()::TEXT);
CREATE POLICY kyc_select_admin ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'private-merchant-kyc' AND public.has_role('admin'));

-- Public bucket: world-readable, shop managers write ----------------------------
CREATE POLICY storefront_assets_read ON storage.objects FOR SELECT TO anon, authenticated
    USING (bucket_id = 'public-storefront-assets');
CREATE POLICY storefront_assets_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'public-storefront-assets' AND public.storage_path_is_managed_shop(name));
CREATE POLICY storefront_assets_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'public-storefront-assets' AND public.storage_path_is_managed_shop(name))
    WITH CHECK (bucket_id = 'public-storefront-assets' AND public.storage_path_is_managed_shop(name));
CREATE POLICY storefront_assets_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'public-storefront-assets' AND public.storage_path_is_managed_shop(name));
