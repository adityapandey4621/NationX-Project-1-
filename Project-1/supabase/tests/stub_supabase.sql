-- Minimal stand-in for the parts of Supabase that our migrations depend on, so
-- migrations and RLS can be tested on a single plain Postgres container
-- (`npm run test:db`). It is NOT a substitute for testing against real
-- Supabase Auth/Storage; see docs/SETUP.md.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
    id UUID PRIMARY KEY,
    email TEXT,
    raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb
);
-- Like Supabase: the legacy per-claim setting first, then the JSON claims PostgREST sets.
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
$$ SELECT COALESCE(
       NULLIF(current_setting('request.jwt.claim.sub', true), ''),
       NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')
   )::uuid $$;

-- Storage (subset): buckets + objects with RLS enabled, as in Supabase.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public BOOLEAN NOT NULL DEFAULT FALSE,
    file_size_limit BIGINT,
    allowed_mime_types TEXT[]
);
CREATE TABLE storage.objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id TEXT NOT NULL REFERENCES storage.buckets(id),
    name TEXT NOT NULL,
    owner UUID
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;

-- Mirror Supabase: new public tables AND functions are granted to the API roles
-- by default, so any function we forget to REVOKE shows up in tests.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
