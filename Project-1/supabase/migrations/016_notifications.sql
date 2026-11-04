-- ============================================================================
-- 016_notifications.sql - transactional e-mail / SMS queue (contract C8)
--
-- What it does: when an application is approved / rejected / sent back for corrections, or staff move a
-- Help Me Find It request forward, a row is queued here IN THE SAME TRANSACTION as the status change
-- (so a message is never lost and never sent for a change that rolled back). A server-side dispatcher
-- (/api/v1/internal/notifications/dispatch, called by a scheduler) claims rows and hands them to the
-- configured e-mail / SMS provider. No provider is built in: with none configured, rows simply wait
-- (and expire after 3 days, because a stale approval notice is worse than none).
--
-- Safety properties (all covered by supabase/tests/notifications.test.sql):
--   * clients (anon / authenticated, including admins) cannot read or write the queue or call any function;
--     only the service role (the dispatcher) can
--   * several dispatchers can run at once without sending a message twice (FOR UPDATE SKIP LOCKED)
--   * a crashed dispatcher does not strand a message (stale 'sending' rows are reclaimed)
--   * retries back off exponentially and stop after 5 attempts
--   * after delivery the recipient is masked and the payload scrubbed (data minimisation, DPDP)
--   * message content carries NO item names, reasons for rejection are only in the e-mail, never in SMS
-- ============================================================================

CREATE TABLE public.notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
    template TEXT NOT NULL CHECK (template IN (
        'application_approved', 'application_rejected', 'application_corrections', 'help_request_update'
    )),
    recipient TEXT NOT NULL CHECK (CHAR_LENGTH(recipient) BETWEEN 3 AND 254),
    locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'te')),
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    -- One logical notification = one key. A retried transaction cannot queue it twice.
    dedupe_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notification_queue_due ON public.notification_queue (channel, next_attempt_at)
    WHERE status IN ('pending', 'sending');
CREATE INDEX idx_notification_queue_entity ON public.notification_queue (entity_type, entity_id);

-- Row-level security ON with NO policy = nobody but the service role (which bypasses RLS) can touch it.
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_queue TO service_role;

-- Masks a recipient for the retained record: a***@example.com / +91*****123.
CREATE FUNCTION public.mask_recipient(p_recipient TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_recipient LIKE '%@%' THEN LEFT(p_recipient, 1) || '***@' || SPLIT_PART(p_recipient, '@', 2)
        ELSE '+91*****' || RIGHT(p_recipient, 3)
    END;
$$;

-- Internal: queue one message. Idempotent on dedupe_key. Never callable by clients.
CREATE FUNCTION public.enqueue_notification(
    p_channel TEXT, p_template TEXT, p_recipient TEXT, p_locale TEXT, p_data JSONB,
    p_entity_type TEXT, p_entity_id UUID, p_dedupe_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_recipient IS NULL OR BTRIM(p_recipient) = '' THEN
        RETURN;
    END IF;
    -- Only well-formed destinations are queued: a bad address would only burn retries.
    IF p_channel = 'sms' AND p_recipient !~ '^\+91[6-9][0-9]{9}$' THEN
        RETURN;
    END IF;
    IF p_channel = 'email' AND p_recipient !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RETURN;
    END IF;
    INSERT INTO public.notification_queue (channel, template, recipient, locale, data, entity_type, entity_id, dedupe_key)
    VALUES (p_channel, p_template, BTRIM(p_recipient), COALESCE(p_locale, 'en'), COALESCE(p_data, '{}'::jsonb),
            p_entity_type, p_entity_id, p_dedupe_key)
    ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

-- Application decisions -> applicant (e-mail with the detail, a short SMS without any reason text).
CREATE FUNCTION public.trg_application_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_template TEXT;
    v_email TEXT;
    v_lang TEXT;
    v_data JSONB;
    v_tx TEXT := TXID_CURRENT()::TEXT;
BEGIN
    v_template := CASE NEW.status
        WHEN 'approved' THEN 'application_approved'
        WHEN 'rejected' THEN 'application_rejected'
        WHEN 'correction_requested' THEN 'application_corrections'
    END;
    IF v_template IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT p.email, p.preferred_language INTO v_email, v_lang
    FROM public.profiles p WHERE p.id = NEW.applicant_user_id;

    v_data := JSONB_BUILD_OBJECT(
        'application_id', NEW.id,
        'business_name', NEW.business_name,
        'reason', CASE NEW.status WHEN 'rejected' THEN NEW.rejection_reason WHEN 'correction_requested' THEN NEW.correction_notes END
    );

    PERFORM public.enqueue_notification('email', v_template, COALESCE(NULLIF(BTRIM(NEW.contact_email), ''), v_email),
        v_lang, v_data, 'merchant_application', NEW.id, v_template || ':' || NEW.id || ':email:' || v_tx);
    -- The SMS never carries the reason (it is shown on the applicant's page after sign-in).
    PERFORM public.enqueue_notification('sms', v_template, NEW.contact_phone,
        v_lang, v_data - 'reason', 'merchant_application', NEW.id, v_template || ':' || NEW.id || ':sms:' || v_tx);
    RETURN NEW;
END;
$$;

CREATE TRIGGER notify_on_application_decision
    AFTER UPDATE OF status ON public.merchant_applications
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.trg_application_notify();

-- Help Me Find It: tell the requester when staff pick the request up or resolve it. Pending (initial) and
-- cancelled (the person's own action) are not messaged. The item name is never put in a message.
CREATE FUNCTION public.trg_help_request_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_email TEXT;
    v_lang TEXT := 'en';
    v_data JSONB;
    v_tx TEXT := TXID_CURRENT()::TEXT;
BEGIN
    IF NEW.status NOT IN ('under_review', 'matched', 'unresolved') THEN
        RETURN NEW;
    END IF;
    IF NEW.customer_user_id IS NOT NULL THEN
        SELECT p.email, p.preferred_language INTO v_email, v_lang
        FROM public.profiles p WHERE p.id = NEW.customer_user_id;
    END IF;
    v_data := JSONB_BUILD_OBJECT('tracking_id', NEW.tracking_id, 'status', NEW.status, 'contact_name', NEW.contact_name);

    PERFORM public.enqueue_notification('sms', 'help_request_update', NEW.contact_phone, COALESCE(v_lang, 'en'), v_data,
        'help_request', NEW.id, 'help_request_update:' || NEW.id || ':sms:' || v_tx);
    PERFORM public.enqueue_notification('email', 'help_request_update', v_email, COALESCE(v_lang, 'en'), v_data,
        'help_request', NEW.id, 'help_request_update:' || NEW.id || ':email:' || v_tx);
    RETURN NEW;
END;
$$;

CREATE TRIGGER notify_on_help_request_update
    AFTER UPDATE OF status ON public.help_me_find_it_requests
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.trg_help_request_notify();

-- Dispatcher: claim up to p_limit due messages for the channels it can actually send. Safe to call from
-- several workers at once. Expired and exhausted rows are retired here so they never block the queue.
CREATE FUNCTION public.claim_notifications(p_channels TEXT[], p_limit INT DEFAULT 20)
RETURNS SETOF public.notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Too old to be useful: the same news is on the applicant's page / tracking page.
    UPDATE public.notification_queue
    SET status = 'skipped', last_error = 'expired before it could be sent', locked_at = NULL,
        recipient = public.mask_recipient(recipient), data = '{}'::jsonb
    WHERE status = 'pending' AND created_at < NOW() - INTERVAL '3 days';

    -- A worker that died mid-send, too many times: stop retrying.
    UPDATE public.notification_queue
    SET status = 'failed', last_error = COALESCE(last_error, 'worker stopped while sending'), locked_at = NULL,
        recipient = public.mask_recipient(recipient), data = '{}'::jsonb
    WHERE status = 'sending' AND locked_at < NOW() - INTERVAL '5 minutes' AND attempts >= 5;

    RETURN QUERY
    WITH picked AS (
        SELECT id FROM public.notification_queue
        WHERE channel = ANY (p_channels)
          AND ((status = 'pending' AND next_attempt_at <= NOW())
               OR (status = 'sending' AND locked_at < NOW() - INTERVAL '5 minutes'))
        ORDER BY created_at
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.notification_queue q
    SET status = 'sending', attempts = q.attempts + 1, locked_at = NOW()
    FROM picked
    WHERE q.id = picked.id
    RETURNING q.*;
END;
$$;

-- Dispatcher: record the outcome. Success scrubs personal data; failure schedules a backoff retry
-- (2, 4, 8, 16 minutes) unless the provider said it is permanent or this was the 5th attempt.
CREATE FUNCTION public.finish_notification(p_id UUID, p_ok BOOLEAN, p_error TEXT DEFAULT NULL, p_permanent BOOLEAN DEFAULT FALSE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row public.notification_queue%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.notification_queue WHERE id = p_id AND status = 'sending' FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'not_found';
    END IF;

    IF p_ok THEN
        UPDATE public.notification_queue
        SET status = 'sent', sent_at = NOW(), locked_at = NULL, last_error = NULL,
            recipient = public.mask_recipient(recipient), data = '{}'::jsonb
        WHERE id = p_id;
        RETURN 'sent';
    END IF;

    IF p_permanent OR v_row.attempts >= 5 THEN
        UPDATE public.notification_queue
        SET status = 'failed', locked_at = NULL, last_error = LEFT(COALESCE(p_error, 'failed'), 500),
            recipient = public.mask_recipient(recipient), data = '{}'::jsonb
        WHERE id = p_id;
        RETURN 'failed';
    END IF;

    UPDATE public.notification_queue
    SET status = 'pending', locked_at = NULL, last_error = LEFT(COALESCE(p_error, 'failed'), 500),
        next_attempt_at = NOW() + (POWER(2, v_row.attempts)::INT * INTERVAL '1 minute')
    WHERE id = p_id;
    RETURN 'retry';
END;
$$;

-- Housekeeping: delete finished rows after p_days (default 30). Returns how many were removed.
CREATE FUNCTION public.purge_old_notifications(p_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_n INT;
BEGIN
    DELETE FROM public.notification_queue
    WHERE status IN ('sent', 'failed', 'skipped') AND created_at < NOW() - (GREATEST(COALESCE(p_days, 30), 1) * INTERVAL '1 day');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- Counts for monitoring (no personal data): how many messages are in each state.
CREATE FUNCTION public.notification_stats()
RETURNS TABLE (channel TEXT, status TEXT, total BIGINT, oldest_pending TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT q.channel, q.status, COUNT(*), MIN(q.created_at) FILTER (WHERE q.status IN ('pending', 'sending'))
    FROM public.notification_queue q GROUP BY q.channel, q.status ORDER BY 1, 2;
$$;

-- Postgres grants EXECUTE to PUBLIC by default: close that, then open to the service role only.
REVOKE EXECUTE ON FUNCTION public.mask_recipient(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_application_notify() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_help_request_notify() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_notifications(TEXT[], INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_notification(UUID, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_old_notifications(INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notification_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notifications(TEXT[], INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification(UUID, BOOLEAN, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_notifications(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_stats() TO service_role;
