-- Behavioural tests for migration 016 (notification queue). Rolled back; raises if any check fails.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.results (name TEXT, pass BOOLEAN);
GRANT ALL ON t.results TO anon, authenticated, service_role;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000000e1','applicant@example.test','{"full_name":"Applicant","phone":"+919000000061","preferred_language":"te"}'),
 ('00000000-0000-0000-0000-0000000000e2','admin@example.test','{"full_name":"Admin","phone":"+919000000062"}');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000e2','admin');

CREATE FUNCTION t.act(uid TEXT, r TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', coalesce(uid,''), true); EXECUTE format('SET LOCAL ROLE %I', r); END $$;
GRANT EXECUTE ON FUNCTION t.act(TEXT,TEXT) TO anon, authenticated, service_role;
CREATE FUNCTION t.raises(name TEXT, uid TEXT, r TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ok BOOLEAN;
BEGIN
  BEGIN PERFORM t.act(uid, r); EXECUTE stmt; RESET ROLE; ok := false;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; ok := true; END;
  INSERT INTO t.results VALUES (name, ok);
END $$;
GRANT EXECUTE ON FUNCTION t.raises(TEXT,TEXT,TEXT,TEXT) TO anon, authenticated, service_role;

SELECT id AS loc FROM localities ORDER BY slug LIMIT 1 \gset
SELECT id AS cat FROM categories ORDER BY slug LIMIT 1 \gset

-- ---- Application decisions queue messages -----------------------------------------------------------------
INSERT INTO merchant_applications (id, applicant_user_id, business_name, category_id, locality_id, contact_phone, contact_email, address_line1, status)
VALUES ('00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000e1','Test Stores',:'cat',:'loc','+919100000011',NULL,'addr','draft'),
       ('00000000-0000-0000-0000-00000000aa02','00000000-0000-0000-0000-0000000000e1','Bad Phone Stores',:'cat',:'loc','12345',NULL,'addr','draft');

INSERT INTO t.results SELECT 'creating a draft queues nothing', (SELECT count(*) = 0 FROM notification_queue);
UPDATE merchant_applications SET status = 'submitted' WHERE id = '00000000-0000-0000-0000-00000000aa01';
INSERT INTO t.results SELECT 'submitting an application queues nothing (only decisions notify)', (SELECT count(*) = 0 FROM notification_queue);

UPDATE merchant_applications SET status = 'correction_requested', correction_notes = 'Please add a clearer shop photo' WHERE id = '00000000-0000-0000-0000-00000000aa01';
INSERT INTO t.results SELECT 'a correction request queues one e-mail and one SMS', (SELECT count(*) = 2 FROM notification_queue WHERE template = 'application_corrections');
INSERT INTO t.results SELECT 'the e-mail goes to the account address and carries the note', (SELECT count(*) = 1 FROM notification_queue WHERE template = 'application_corrections' AND channel = 'email' AND recipient = 'applicant@example.test' AND data->>'reason' = 'Please add a clearer shop photo');
INSERT INTO t.results SELECT 'the SMS goes to the contact phone and never carries the reason', (SELECT count(*) = 1 FROM notification_queue WHERE template = 'application_corrections' AND channel = 'sms' AND recipient = '+919100000011' AND NOT (data ? 'reason'));
INSERT INTO t.results SELECT 'the recipient language comes from the applicant''s profile', (SELECT bool_and(locale = 'te') FROM notification_queue);

UPDATE merchant_applications SET status = 'submitted' WHERE id = '00000000-0000-0000-0000-00000000aa01';
UPDATE merchant_applications SET status = 'rejected', rejection_reason = 'Documents unreadable' WHERE id = '00000000-0000-0000-0000-00000000aa01';
INSERT INTO t.results SELECT 'a rejection queues its own template', (SELECT count(*) = 2 FROM notification_queue WHERE template = 'application_rejected');

-- A malformed phone must not be queued (it would only burn retries); the e-mail still goes.
UPDATE merchant_applications SET status = 'submitted' WHERE id = '00000000-0000-0000-0000-00000000aa02';
UPDATE merchant_applications SET status = 'approved' WHERE id = '00000000-0000-0000-0000-00000000aa02';
INSERT INTO t.results SELECT 'a malformed phone queues no SMS but the e-mail is still queued',
  (SELECT count(*) = 0 FROM notification_queue WHERE template = 'application_approved' AND channel = 'sms')
  AND (SELECT count(*) = 1 FROM notification_queue WHERE template = 'application_approved' AND channel = 'email');

-- A rolled-back decision leaves no message behind (the queue row is written in the same transaction).
SAVEPOINT before_decision;
INSERT INTO merchant_applications (id, applicant_user_id, business_name, category_id, locality_id, contact_phone, address_line1, status)
VALUES ('00000000-0000-0000-0000-00000000aa03','00000000-0000-0000-0000-0000000000e1','Rolled Back',:'cat',:'loc','+919100000013','addr','submitted');
UPDATE merchant_applications SET status = 'approved' WHERE id = '00000000-0000-0000-0000-00000000aa03';
ROLLBACK TO SAVEPOINT before_decision;
INSERT INTO t.results SELECT 'a rolled-back decision queues nothing', (SELECT count(*) = 0 FROM notification_queue WHERE entity_id = '00000000-0000-0000-0000-00000000aa03');

-- ---- Help Me Find It ---------------------------------------------------------------------------------------
INSERT INTO help_me_find_it_requests (id, tracking_id, item_name, preferred_locality_id, contact_name, contact_phone, consent_given)
VALUES ('00000000-0000-0000-0000-00000000bb01','HMF-TST-000001','Secret Item Name',:'loc','Ravi','+919100000021',true);
INSERT INTO t.results SELECT 'a new request queues nothing', (SELECT count(*) = 0 FROM notification_queue WHERE entity_type = 'help_request');
UPDATE help_me_find_it_requests SET status = 'under_review' WHERE id = '00000000-0000-0000-0000-00000000bb01';
INSERT INTO t.results SELECT 'moving a request to review queues an SMS', (SELECT count(*) = 1 FROM notification_queue WHERE entity_type = 'help_request' AND channel = 'sms' AND recipient = '+919100000021');
INSERT INTO t.results SELECT 'a guest request has no e-mail, so only the SMS is queued', (SELECT count(*) = 0 FROM notification_queue WHERE entity_type = 'help_request' AND channel = 'email');
INSERT INTO t.results SELECT 'the item name is never put in a message', (SELECT count(*) = 0 FROM notification_queue WHERE data::text ILIKE '%Secret Item Name%');
UPDATE help_me_find_it_requests SET status = 'cancelled' WHERE id = '00000000-0000-0000-0000-00000000bb01';
INSERT INTO t.results SELECT 'a cancellation is not messaged', (SELECT count(*) = 1 FROM notification_queue WHERE entity_type = 'help_request');

-- ---- Nobody but the service role can touch the queue ------------------------------------------------------
SELECT t.raises('anon cannot read the queue', NULL, 'anon', $$SELECT * FROM public.notification_queue$$);
SELECT t.raises('a customer cannot read the queue', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT * FROM public.notification_queue$$);
SELECT t.raises('an admin cannot read the queue directly', '00000000-0000-0000-0000-0000000000e2', 'authenticated', $$SELECT * FROM public.notification_queue$$);
SELECT t.raises('a customer cannot write the queue', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$INSERT INTO public.notification_queue (channel, template, recipient, entity_type, entity_id, dedupe_key) VALUES ('sms','help_request_update','+919100000099','x',gen_random_uuid(),'k')$$);
SELECT t.raises('anon cannot call claim_notifications', NULL, 'anon', $$SELECT * FROM public.claim_notifications(ARRAY['sms'], 5)$$);
SELECT t.raises('a customer cannot call claim_notifications', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT * FROM public.claim_notifications(ARRAY['sms'], 5)$$);
SELECT t.raises('an admin cannot call claim_notifications', '00000000-0000-0000-0000-0000000000e2', 'authenticated', $$SELECT * FROM public.claim_notifications(ARRAY['sms'], 5)$$);
SELECT t.raises('a customer cannot call finish_notification', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT public.finish_notification(gen_random_uuid(), true)$$);
SELECT t.raises('a customer cannot call purge_old_notifications', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT public.purge_old_notifications(1)$$);
SELECT t.raises('a customer cannot call enqueue_notification', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT public.enqueue_notification('sms','help_request_update','+919100000098','en','{}','x',gen_random_uuid(),'k2')$$);
SELECT t.raises('a customer cannot read the monitoring counts', '00000000-0000-0000-0000-0000000000e1', 'authenticated', $$SELECT * FROM public.notification_stats()$$);

-- ---- Idempotency -------------------------------------------------------------------------------------------
SELECT public.enqueue_notification('sms','help_request_update','+919100000077','en','{}','help_request','00000000-0000-0000-0000-00000000bb01','dupe-key');
SELECT public.enqueue_notification('sms','help_request_update','+919100000077','en','{}','help_request','00000000-0000-0000-0000-00000000bb01','dupe-key');
INSERT INTO t.results SELECT 'the same dedupe key queues once', (SELECT count(*) = 1 FROM notification_queue WHERE dedupe_key = 'dupe-key');
SELECT public.enqueue_notification('sms','help_request_update','not-a-phone','en','{}','help_request','00000000-0000-0000-0000-00000000bb01','bad-sms');
SELECT public.enqueue_notification('email','help_request_update','not an email','en','{}','help_request','00000000-0000-0000-0000-00000000bb01','bad-email');
INSERT INTO t.results SELECT 'malformed destinations are never queued', (SELECT count(*) = 0 FROM notification_queue WHERE dedupe_key IN ('bad-sms','bad-email'));

-- ---- Claiming (as the service role, like the dispatcher) --------------------------------------------------
SELECT count(*) AS emails_waiting FROM notification_queue WHERE channel = 'email' AND status = 'pending' \gset
SELECT t.act(NULL, 'service_role');
CREATE TEMP TABLE claimed1 AS SELECT * FROM public.claim_notifications(ARRAY['email'], 2);
CREATE TEMP TABLE claimed2 AS SELECT * FROM public.claim_notifications(ARRAY['email'], 100);
RESET ROLE;
INSERT INTO t.results SELECT 'the limit is respected', (SELECT count(*) = 2 FROM claimed1);
INSERT INTO t.results SELECT 'claimed rows are marked sending with one attempt', (SELECT bool_and(status = 'sending' AND attempts = 1 AND locked_at IS NOT NULL) FROM claimed1);
INSERT INTO t.results SELECT 'only the requested channel is claimed', (SELECT bool_and(channel = 'email') FROM claimed1) AND (SELECT bool_and(channel = 'email') FROM claimed2);
INSERT INTO t.results SELECT 'a second claim never returns rows already being sent (no double send)', (SELECT count(*) = 0 FROM claimed2 c2 JOIN claimed1 c1 USING (id));
INSERT INTO t.results SELECT 'together the two claims took every waiting e-mail exactly once', (SELECT count(*) FROM claimed1) + (SELECT count(*) FROM claimed2) = :emails_waiting;
INSERT INTO t.results SELECT 'SMS rows were left alone', (SELECT bool_and(status = 'pending') FROM notification_queue WHERE channel = 'sms');

-- ---- Finishing: success scrubs, retries back off, permanent failures stop ---------------------------------
SELECT id AS ok_id FROM claimed1 ORDER BY id LIMIT 1 \gset
SELECT id AS retry_id FROM claimed1 WHERE id <> :'ok_id' LIMIT 1 \gset
SELECT t.act(NULL, 'service_role');
SELECT public.finish_notification(:'ok_id', true) AS r_ok \gset
SELECT public.finish_notification(:'retry_id', false, 'provider timeout') AS r_retry \gset
SELECT public.finish_notification(:'ok_id', true) AS r_again \gset
RESET ROLE;
INSERT INTO t.results SELECT 'success is reported as sent', :'r_ok' = 'sent';
INSERT INTO t.results SELECT 'a sent message has its recipient masked and its data scrubbed', (SELECT status = 'sent' AND sent_at IS NOT NULL AND recipient NOT LIKE '%applicant@%' AND recipient LIKE '%***@%' AND data = '{}'::jsonb FROM notification_queue WHERE id = :'ok_id');
INSERT INTO t.results SELECT 'finishing twice is a harmless no-op', :'r_again' = 'not_found';
INSERT INTO t.results SELECT 'a transient failure schedules a retry with backoff', :'r_retry' = 'retry' AND (SELECT status = 'pending' AND next_attempt_at > NOW() + INTERVAL '90 seconds' AND last_error = 'provider timeout' FROM notification_queue WHERE id = :'retry_id');
SELECT t.act(NULL, 'service_role');
CREATE TEMP TABLE claimed3 AS SELECT * FROM public.claim_notifications(ARRAY['email'], 100);
RESET ROLE;
INSERT INTO t.results SELECT 'a message waiting for its retry time is not claimed early', (SELECT count(*) = 0 FROM claimed3 WHERE id = :'retry_id');

UPDATE notification_queue SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = :'retry_id';
SELECT t.act(NULL, 'service_role');
CREATE TEMP TABLE claimed4 AS SELECT * FROM public.claim_notifications(ARRAY['email'], 100);
SELECT public.finish_notification(:'retry_id', false, 'bad address', true) AS r_perm \gset
RESET ROLE;
INSERT INTO t.results SELECT 'once due, the retry is claimed again (attempt 2)', (SELECT attempts = 2 FROM claimed4 WHERE id = :'retry_id');
INSERT INTO t.results SELECT 'a permanent failure is final and scrubbed', :'r_perm' = 'failed' AND (SELECT status = 'failed' AND data = '{}'::jsonb AND recipient LIKE '%***@%' FROM notification_queue WHERE id = :'retry_id');

-- The 5th failed attempt is final even if the provider says "try later".
UPDATE notification_queue SET status = 'sending', attempts = 5, locked_at = NOW() WHERE id = (SELECT id FROM notification_queue WHERE channel = 'sms' LIMIT 1);
SELECT id AS fifth_id FROM notification_queue WHERE status = 'sending' AND attempts = 5 \gset
SELECT t.act(NULL, 'service_role');
SELECT public.finish_notification(:'fifth_id', false, 'still down') AS r_fifth \gset
RESET ROLE;
INSERT INTO t.results SELECT 'the 5th failed attempt ends the message', :'r_fifth' = 'failed';

-- A worker that died mid-send: the stale lock is reclaimed.
UPDATE notification_queue SET status = 'sending', attempts = 1, locked_at = NOW() - INTERVAL '10 minutes'
 WHERE id = (SELECT id FROM notification_queue WHERE channel = 'sms' AND status = 'pending' LIMIT 1);
SELECT id AS stale_id FROM notification_queue WHERE status = 'sending' AND locked_at < NOW() - INTERVAL '5 minutes' \gset
SELECT t.act(NULL, 'service_role');
CREATE TEMP TABLE claimed5 AS SELECT * FROM public.claim_notifications(ARRAY['sms'], 100);
RESET ROLE;
INSERT INTO t.results SELECT 'a message stranded by a crashed worker is reclaimed', (SELECT attempts = 2 FROM claimed5 WHERE id = :'stale_id');

-- Expiry and housekeeping.
UPDATE notification_queue SET status = 'pending', created_at = NOW() - INTERVAL '4 days', next_attempt_at = NOW() WHERE id = :'stale_id';
SELECT t.act(NULL, 'service_role');
CREATE TEMP TABLE claimed6 AS SELECT * FROM public.claim_notifications(ARRAY['sms'], 100);
RESET ROLE;
INSERT INTO t.results SELECT 'a message older than 3 days is skipped, not sent late', (SELECT status = 'skipped' AND data = '{}'::jsonb FROM notification_queue WHERE id = :'stale_id') AND (SELECT count(*) = 0 FROM claimed6 WHERE id = :'stale_id');

UPDATE notification_queue SET created_at = NOW() - INTERVAL '40 days' WHERE id IN (:'ok_id', :'retry_id');
SELECT t.act(NULL, 'service_role');
SELECT public.purge_old_notifications(30) AS purged \gset
RESET ROLE;
INSERT INTO t.results SELECT 'old finished messages are purged, unfinished ones are kept', :purged = 2 AND (SELECT count(*) > 0 FROM notification_queue WHERE status IN ('pending','sending'));

SELECT t.act(NULL, 'service_role');
INSERT INTO t.results SELECT 'monitoring counts are available to the service role', (SELECT count(*) > 0 FROM public.notification_stats());
RESET ROLE;

SELECT result, name FROM (SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name FROM t.results) r ORDER BY name;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM t.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM t.results WHERE NOT pass) THEN RAISE EXCEPTION 'notification tests failed'; END IF; END $$;
ROLLBACK;
