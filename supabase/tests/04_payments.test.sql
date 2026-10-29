-- Payment confirmation (PR 4): process_payfast_itn + confirm_payment.
-- Everything runs as service_role, exactly the privileges the ITN function has.
begin;
\ir _helpers.psql
select no_plan();

-- A pending order created the only way orders are created; returns its reference.
create function tests.pending(p_slugs text[], p_email text, p_livemode boolean default false)
returns text
language sql
as $$
  select public.create_pending_order(
    (select jsonb_agg(jsonb_build_object('id', s, 'qty', 1)) from unnest(p_slugs) s),
    p_email, null, false, true, extensions.digest(p_email, 'sha256'), null, p_livemode) ->> 'reference';
$$;

-- One ITN delivery with sensible defaults (checks passed, sandbox).
create function tests.itn(p_ref text, p_txn text, p_amount bigint, p_status text default 'COMPLETE',
                          p_error text default null, p_livemode boolean default false, p_key text default null)
returns jsonb
language sql
as $$
  select public.process_payfast_itn(coalesce(p_key, p_txn || ':' || p_status), p_status, p_ref, p_amount, p_txn,
                                    p_livemode, jsonb_build_object('fields', jsonb_build_array(jsonb_build_array('m_payment_id', p_ref))), p_error);
$$;

create function tests.order_of(p_ref text) returns public.orders language sql as $$
  select * from public.orders where reference = p_ref $$;
create function tests.n_fulfilments(p_ref text) returns int language sql as $$
  select count(*)::int from public.fulfilments f join public.orders o on o.id = f.order_id where o.reference = p_ref $$;
create function tests.n_emails(p_ref text) returns int language sql as $$
  select count(*)::int from public.email_events e join public.orders o on o.id = e.order_id where o.reference = p_ref $$;
create function tests.event(p_key text) returns public.payment_events language sql as $$
  select * from public.payment_events where provider = 'payfast' and provider_event_id = p_key $$;
grant execute on all functions in schema tests to service_role;

select tests.act_as('service_role');

-- ---------- happy path + mixed delivery ---------------------------------
-- signature-course: an instant external course link + a downloadable workbook.
create temp table refs (name text primary key, ref text) on commit drop;
grant all on refs to service_role;
insert into refs values ('mixed', tests.pending(array['signature-course'], 'mixed@example.com'));

select is((select tests.itn(ref, '9100001', 199700) ->> 'outcome' from refs where name = 'mixed'), 'paid',
  'a verified COMPLETE ITN for the exact amount pays the order');
select is((select (tests.order_of(ref)).status::text from refs where name = 'mixed'), 'paid', 'order is paid');
select is((select (tests.order_of(ref)).provider_txn_id from refs where name = 'mixed'), '9100001', 'Payfast transaction id recorded');
select ok((select (tests.order_of(ref)).paid_at is not null from refs where name = 'mixed'), 'paid_at stamped');
select is((select tests.n_fulfilments(ref) from refs where name = 'mixed'), 2, 'mixed product: one fulfilment per asset (link + file)');
select is((select array_agg(f.kind::text || '/' || f.status::text order by f.kind) from public.fulfilments f
             join public.orders o on o.id = f.order_id join refs r on r.ref = o.reference where r.name = 'mixed'),
  array['file/queued', 'external/queued'], 'file and instant link are queued for delivery');
select is((select tests.n_emails(ref) from refs where name = 'mixed'), 1, 'one order_paid email queued');
select is((select status::text from tests.event('9100001:COMPLETE')), 'processed', 'event processed');
select is((select attempts from tests.event('9100001:COMPLETE')), 1, 'event attempt counted');
select is((select o.reference from tests.event('9100001:COMPLETE') e join public.orders o on o.id = e.order_id),
  (select ref from refs where name = 'mixed'), 'event linked to its order');

-- ---------- spec §7 "Webhook replay" ------------------------------------
select is((select tests.itn(ref, '9100001', 199700) ->> 'outcome' from refs where name = 'mixed'), 'duplicate', 'second delivery: duplicate');
select is((select tests.itn(ref, '9100001', 199700) ->> 'outcome' from refs where name = 'mixed'), 'duplicate', 'third delivery: duplicate');
select is((select tests.n_fulfilments(ref) from refs where name = 'mixed'), 2, 'replays create no extra fulfilments');
select is((select tests.n_emails(ref) from refs where name = 'mixed'), 1, 'replays queue no extra email');
select is((select count(*)::int from public.payment_events where provider_event_id = '9100001:COMPLETE'), 1, 'one stored event');
select is((select attempts from tests.event('9100001:COMPLETE')), 1, 'duplicates are not reprocessed');

-- confirm_payment itself is idempotent for the same transaction.
select is((select private.confirm_payment((tests.order_of(ref)).id, '9100001') ->> 'outcome' from refs where name = 'mixed'),
  'already_paid', 'confirming the same transaction again is a no-op');
select is((select tests.n_fulfilments(ref) from refs where name = 'mixed'), 2, 'still two fulfilments');

-- A second, different payment for an already paid order needs a person (refund).
select is((select tests.itn(ref, '9100002', 199700) from refs where name = 'mixed') - 'event_id' - 'reference',
  '{"outcome": "failed", "error": "paid_by_other_transaction"}'::jsonb, 'double payment is flagged, not applied');
select is((select (tests.order_of(ref)).provider_txn_id from refs where name = 'mixed'), '9100001', 'original transaction kept');

-- ---------- bundles and manual access ------------------------------------
insert into refs values ('bundle', tests.pending(array['bundle'], 'bundle@example.com'));
select is((select tests.itn(ref, '9100010', 229700) ->> 'outcome' from refs where name = 'bundle'), 'paid', 'bundle paid');
select is((select tests.n_fulfilments(ref) from refs where name = 'bundle'), 6,
  'bundle delivers every component asset (course link + workbook, 2 book formats, book two, companion workbook)');

insert into refs values ('manual', tests.pending(array['masterclass'], 'manual@example.com'));
select is((select tests.itn(ref, '9100020', 79700) ->> 'outcome' from refs where name = 'manual'), 'paid', 'manual-access product paid');
select is((select f.status::text || ' / ' || f.status_reason from public.fulfilments f join public.orders o on o.id = f.order_id
             join refs r on r.ref = o.reference where r.name = 'manual'),
  'action_required / manual access promised within 1 business day', 'manual access is flagged for staff with the promised timing');

-- ---------- each failure leaves no paid order ---------------------------
insert into refs values ('amount', tests.pending(array['book-one'], 'amount@example.com'));
select is((select tests.itn(ref, '9100030', 24899) ->> 'error' from refs where name = 'amount'), 'amount_mismatch', 'R0.01 short: rejected');
select is((select tests.itn(ref, '9100031', 24901) ->> 'error' from refs where name = 'amount'), 'amount_mismatch', 'R0.01 over: rejected');
select is((select tests.itn(ref, '9100032', null) ->> 'error' from refs where name = 'amount'), 'amount_mismatch', 'missing amount: rejected');
select is((select (tests.order_of(ref)).status::text from refs where name = 'amount'), 'pending', 'order still pending');
select is((select tests.n_fulfilments(ref) + tests.n_emails(ref) from refs where name = 'amount'), 0, 'no fulfilment, no email');
select is((select status::text || ':' || error from tests.event('9100030:COMPLETE')), 'failed:amount_mismatch', 'failure stored for investigation');

select is((tests.itn('CBW-0000000000', '9100040', 500) - 'event_id'), '{"outcome": "failed", "error": "unknown_order", "reference": null}'::jsonb,
  'unknown reference: stored as failed');

insert into refs values ('mode', tests.pending(array['book-two'], 'mode@example.com'));
select is((select tests.itn(ref, '9100050', 19900, p_livemode => true) ->> 'error' from refs where name = 'mode'), 'mode_mismatch',
  'a live deployment never pays a sandbox order');
insert into refs values ('live', tests.pending(array['book-two'], 'live@example.com', true));
select is((select tests.itn(ref, '9100051', 19900, p_livemode => false) ->> 'error' from refs where name = 'live'), 'mode_mismatch',
  'a sandbox deployment never pays a live order');

select is((select tests.itn(ref, '9100060', 19900, p_error => 'server_validation_invalid') ->> 'error' from refs where name = 'mode'),
  'server_validation_invalid', 'a failed transport check is stored, not applied');
select is((select (tests.order_of(ref)).status::text from refs where name = 'mode'), 'pending', 'order still pending');

-- ---------- recovery: a failed event is reprocessed exactly once --------
select is((select tests.itn(ref, '9100060', 19900) ->> 'outcome' from refs where name = 'mode'), 'paid',
  'redelivery after the cause is fixed pays the order');
select is((select status::text || ':' || coalesce(error, '-') || ':' || attempts from tests.event('9100060:COMPLETE')), 'processed:-:2',
  'the same event row is reused, error cleared, both attempts counted');
select is((select tests.itn(ref, '9100060', 19900) ->> 'outcome' from refs where name = 'mode'), 'duplicate', 'and only once');
select is((select tests.n_emails(ref) from refs where name = 'mode'), 1, 'one email after recovery');

-- ---------- non-COMPLETE statuses ---------------------------------------
insert into refs values ('cancel', tests.pending(array['planner'], 'cancel@example.com'));
select is((select tests.itn(ref, '9100070', 14900, 'CANCELLED') ->> 'outcome' from refs where name = 'cancel'), 'ignored', 'CANCELLED is recorded and ignored');
select is((select (tests.order_of(ref)).status::text from refs where name = 'cancel'), 'pending',
  'order stays pending: a later COMPLETE for it can still be honoured');
select is((select tests.itn(ref, '9100071', 14900) ->> 'outcome' from refs where name = 'cancel'), 'paid', 'a later COMPLETE pays it');

-- ---------- late payment after expiry ----------------------------------
insert into refs values ('late', tests.pending(array['workbook'], 'late@example.com'));
select tests.as_postgres();
update public.orders set status = 'expired', expires_at = now() - interval '1 minute' where reference = (select ref from refs where name = 'late');
select tests.act_as('service_role');
select is((select tests.itn(ref, '9100080', 12900) ->> 'outcome' from refs where name = 'late'), 'paid', 'a late payment on an expired order is honoured');

-- ---------- forged deliveries -------------------------------------------
insert into refs values ('forged', tests.pending(array['book-one'], 'forged@example.com'));
select is((select tests.itn(ref, '9100090', 24900, p_error => 'signature_mismatch', p_key => 'rejected:' || gen_random_uuid()) ->> 'outcome'
             from refs where name = 'forged'), 'failed', 'a bad-signature delivery is stored as failed');
select is((select count(*)::int from public.payment_events e join public.orders o on o.id = e.order_id join refs r on r.ref = o.reference
             where r.name = 'forged'), 0, 'and never linked to the order it names');
select is((select tests.itn(ref, '9100090', 24900) ->> 'outcome' from refs where name = 'forged'), 'paid',
  'the genuine ITN for the same payment is not blocked by the forgery');
select throws_ok($$ select public.process_payfast_itn('rejected:' || gen_random_uuid(), 'COMPLETE', 'CBW-0000000000', 1, '1', false, '{}', null) $$,
  '23514', null, 'a rejected key must carry its error');
select throws_ok($$ select public.process_payfast_itn('anything goes', 'COMPLETE', 'CBW-0000000000', 1, '1', false, '{}', null) $$,
  '23514', null, 'event keys are validated');

-- ---------- access -------------------------------------------------------
select tests.act_as('anon');
select throws_ok($$ select public.process_payfast_itn('1:COMPLETE', 'COMPLETE', 'CBW-0000000000', 1, '1', false, '{}', null) $$,
  '42501', null, 'anon cannot call process_payfast_itn');
select tests.act_as('authenticated', gen_random_uuid(), 'aal2');
select throws_ok($$ select private.confirm_payment(gen_random_uuid(), '1') $$, '42501', null, 'authenticated cannot call confirm_payment');

-- ---------- order status with items -------------------------------------
select tests.act_as('service_role');
select is((select public.get_order_status(ref, extensions.digest('mixed@example.com', 'sha256')) -> 'items' from refs where name = 'mixed'),
  '[{"type": "course", "links": 1, "title": "The Signature Course: Your Complete Programme", "manual": 0, "downloads": 1}]'::jsonb,
  'order status lists items and what is being delivered');
select is((select public.get_order_status(ref, extensions.digest('wrong', 'sha256')) from refs where name = 'mixed'), null,
  'still nothing without the right key');

select * from finish();
rollback;
