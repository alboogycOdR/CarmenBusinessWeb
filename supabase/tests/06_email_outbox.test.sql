-- Email outbox (PR 6): claim, backoff, give-up + alert, completion, manual access.
-- Runs as service_role, the privileges the worker has.
begin;
\ir _helpers.psql
select no_plan();

create function tests.paid(p_slugs text[], p_email text)
returns uuid
language plpgsql
as $$
declare r jsonb;
begin
  r := public.create_pending_order((select jsonb_agg(jsonb_build_object('id', s, 'qty', 1)) from unnest(p_slugs) s),
                                   p_email, null, false, true, extensions.digest(p_email, 'sha256'), null, false);
  perform public.process_payfast_itn((800000000 + (random() * 99999999)::int)::text || ':COMPLETE', 'COMPLETE', r ->> 'reference',
                                     (r ->> 'total_minor')::bigint, (800000000 + (random() * 99999999)::int)::text, false, '{}'::jsonb, null);
  return (r ->> 'order_id')::uuid;
end;
$$;
create function tests.mail(p_order uuid, p_template text default 'order_paid') returns public.email_events language sql as $$
  select * from public.email_events where order_id = p_order and template = p_template $$;
grant execute on all functions in schema tests to service_role;

create temp table t (name text primary key, order_id uuid, email_id uuid) on commit drop;
grant all on t to service_role;
select tests.act_as('service_role');

-- Older leftovers in a local database must not be claimed by these tests.
select tests.as_postgres();
update public.email_events set next_attempt_at = now() + interval '1 day' where status = 'queued';
select tests.act_as('service_role');

-- ---------- claim --------------------------------------------------------
insert into t (name, order_id) values ('mixed', tests.paid(array['book-one', 'starter-course'], 'mixed-mail@example.com'));
update t set email_id = (tests.mail(order_id)).id where name = 'mixed';
select is((select (tests.mail(order_id)).status::text from t where name = 'mixed'), 'queued', 'payment queued the delivery email');

select is((select jsonb_array_length(public.claim_due_emails(10, order_id)) from t where name = 'mixed'), 1, 'one due email claimed');
select is((select (tests.mail(order_id)).attempts from t where name = 'mixed'), 1, 'claiming counts an attempt');
select ok((select (tests.mail(order_id)).next_attempt_at > now() + interval '4 minutes' from t where name = 'mixed'), 'and leases it for 5 minutes');
select is((select jsonb_array_length(public.claim_due_emails(10, order_id)) from t where name = 'mixed'), 0,
  'a leased email is not claimed again (overlapping workers never double-send)');
select is((select public.claim_due_emails(0, order_id) from t where name = 'mixed'), '[]'::jsonb, 'limit 0 claims nothing');
select is(public.claim_due_emails(10, null, 'CBW-0000000000'), '[]'::jsonb, 'claiming by an unknown reference claims nothing');

-- ---------- context ------------------------------------------------------
select is((select jsonb_array_length(public.email_context(email_id) -> 'items') from t where name = 'mixed'), 2, 'context lists both items');
select is((select (public.email_context(email_id) -> 'items') @? '$[*].deliveries[*] ? (@.kind == "file")' from t where name = 'mixed'), true,
  'mixed delivery: the book''s files are in the context');
select is((select (public.email_context(email_id) -> 'items') @? '$[*].deliveries[*] ? (@.kind == "external" && @.access_mode == "instant")' from t where name = 'mixed'), true,
  'and the course link');

-- ---------- retry with backoff ------------------------------------------
select is((select public.fail_email(email_id, 'resend 500', false) ->> 'retry_in_seconds' from t where name = 'mixed'), '60', 'attempt 1 failed: retry in 1 minute');
select is((select (tests.mail(order_id)).status::text || ' / ' || (tests.mail(order_id)).last_error from t where name = 'mixed'), 'queued / resend 500',
  'the order''s email stays queued with the error');
select is((select status::text from public.orders where id = (select order_id from t where name = 'mixed')), 'paid', 'the order stays paid (spec §7 Email outage)');
select tests.as_postgres();
update public.email_events set attempts = 3 where id = (select email_id from t where name = 'mixed');
select tests.act_as('service_role');
select is((select public.fail_email(email_id, 'resend 503', false) ->> 'retry_in_seconds' from t where name = 'mixed'), '240', 'attempt 3 failed: 4 minutes (exponential)');
select is((select public.fail_email(email_id, 'resend 429', false, null, 900) ->> 'retry_in_seconds' from t where name = 'mixed'), '900',
  'Retry-After is honoured when longer');

-- ---------- complete -----------------------------------------------------
select lives_ok($$ select public.complete_email((select email_id from t where name = 'mixed'), 'msg_123') $$, 'complete');
select is((select (tests.mail(order_id)).status::text || ' / ' || (tests.mail(order_id)).provider_message_id from t where name = 'mixed'), 'sent / msg_123', 'marked sent with the provider id');
select is((select array_agg(distinct f.status::text) from public.fulfilments f where f.order_id = (select order_id from t where name = 'mixed')),
  array['delivered'], 'every instant delivery (files and course link) is now delivered');
select lives_ok($$ select public.complete_email((select email_id from t where name = 'mixed'), 'msg_other') $$, 'completing twice is harmless');
select is((select (tests.mail(order_id)).provider_message_id from t where name = 'mixed'), 'msg_123', 'and changes nothing');
select is((select public.fail_email(email_id, 'late failure', true) ->> 'outcome' from t where name = 'mixed'), 'not_queued', 'a sent email cannot be failed');

-- ---------- give up + admin alert ---------------------------------------
insert into t (name, order_id) values ('bad', tests.paid(array['book-two'], 'bad-mail@example.com'));
update t set email_id = (tests.mail(order_id)).id where name = 'bad';
select is((select public.fail_email(email_id, 'resend 422 validation_error', true, 'Owner@Example.com') ->> 'outcome' from t where name = 'bad'), 'failed',
  'a permanent rejection fails at once');
select is((select m.to_email::text || ' / ' || m.dedupe_key from t, tests.mail(t.order_id, 'admin_alert') m where t.name = 'bad'),
  'owner@example.com / email_failed:' || (select email_id from t where name = 'bad'), 'and queues one alert to the owner');
select is((select public.email_context((tests.mail(order_id, 'admin_alert')).id) -> 'failed_email' ->> 'last_error' from t where name = 'bad'),
  'resend 422 validation_error', 'the alert knows what failed');
select is((select public.fail_email((tests.mail(order_id, 'admin_alert')).id, 'alert bounced', true, 'owner@example.com') ->> 'outcome' from t where name = 'bad'), 'failed', 'alert fails');
select is((select count(*)::int from public.email_events where template = 'admin_alert' and order_id = (select order_id from t where name = 'bad')), 1,
  'no alert about an alert');

insert into t (name, order_id) values ('tired', tests.paid(array['planner'], 'tired-mail@example.com'));
update t set email_id = (tests.mail(order_id)).id where name = 'tired';
select tests.as_postgres();
update public.email_events set attempts = 10 where id = (select email_id from t where name = 'tired');
select tests.act_as('service_role');
select is((select public.fail_email(email_id, 'resend 500', false, null) ->> 'outcome' from t where name = 'tired'), 'failed',
  'after 10 attempts even a transient error gives up');
select is((select count(*)::int from public.email_events where template = 'admin_alert' and order_id = (select order_id from t where name = 'tired')), 0,
  'no alert without ALERT_EMAIL_TO (the worker logs it instead)');

-- ---------- manual access (J5) -----------------------------------------
insert into t (name, order_id) values ('manual', tests.paid(array['masterclass'], 'manual-mail@example.com'));
select public.complete_email((tests.mail(order_id)).id, 'msg_m') from t where name = 'manual';
select is((select f.status::text from public.fulfilments f where f.order_id = (select order_id from t where name = 'manual')), 'action_required',
  'sending the delivery email does not pretend manual access is done');
select is((select public.grant_manual_access(f.id) - 'reference' from public.fulfilments f where f.order_id = (select order_id from t where name = 'manual')),
  '{"label": "Masterclass replay access", "outcome": "granted"}'::jsonb, 'staff grant access');
select is((select f.status::text || ' / ' || f.status_reason from public.fulfilments f where f.order_id = (select order_id from t where name = 'manual')),
  'delivered / access granted by staff', 'delivery marked done');
select is((select (tests.mail(order_id, 'manual_access_ready')).dedupe_key from t where name = 'manual'),
  (select f.id::text from public.fulfilments f where f.order_id = (select order_id from t where name = 'manual')), '"access is ready" email queued for that delivery');
select is((select public.grant_manual_access(f.id) ->> 'outcome' from public.fulfilments f where f.order_id = (select order_id from t where name = 'manual')),
  'already_granted', 'granting twice is harmless');
select is((select count(*)::int from public.email_events where template = 'manual_access_ready' and order_id = (select order_id from t where name = 'manual')), 1, 'one email');
select throws_ok($$ select public.grant_manual_access(f.id) from public.fulfilments f
                     where f.order_id = (select order_id from t where name = 'bad') limit 1 $$,
  'P0001', 'delivery:not_awaiting_access', 'only deliveries waiting for staff can be granted');
select throws_ok($$ select public.grant_manual_access(gen_random_uuid()) $$, 'P0001', 'delivery:fulfilment_not_found', 'unknown delivery');

-- ---------- access -------------------------------------------------------
select tests.act_as('anon');
select throws_ok($$ select public.claim_due_emails(10) $$, '42501', null, 'anon cannot claim emails');
select tests.act_as('authenticated', gen_random_uuid(), 'aal2');
select throws_ok($$ select public.email_context(gen_random_uuid()) $$, '42501', null, 'signed-in users cannot read email context');

select * from finish();
rollback;
