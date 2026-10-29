-- Financial integrity, idempotency and append-only guarantees (PR 1).
-- These hold for every role, including the service role used by webhooks.
begin;
\ir _helpers.psql
select no_plan();

-- A fresh pending order to drive through the state machine.
insert into public.orders (id, email, access_key_hash, currency, subtotal_minor, total_minor, provider, terms_accepted_at)
values ('e0000000-0000-4000-8000-000000000001', 'flow@example.com', extensions.digest('k1', 'sha256'), 'ZAR', 4700, 4700, 'payfast', now());
insert into public.order_items (id, order_id, product_id, title, product_type, unit_price_minor, quantity, line_total_minor, currency)
values ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'Starter', 'course', 4700, 1, 4700, 'ZAR');

-- ---------- order state machine ------------------------------------------
select throws_ok($$ update public.orders set status = 'paid' where id = 'e0000000-0000-4000-8000-000000000001' $$, '23514', null,
  'pending -> paid without provider proof is rejected');
select throws_ok($$ update public.orders set status = 'refunded' where id = 'e0000000-0000-4000-8000-000000000001' $$, '23514', null,
  'pending -> refunded is not a valid transition');
select lives_ok($$ update public.orders set status = 'expired' where id = 'e0000000-0000-4000-8000-000000000001' $$,
  'pending -> expired');
select lives_ok($$ update public.orders set status = 'paid', paid_at = now(), provider_txn_id = 'txn_flow' where id = 'e0000000-0000-4000-8000-000000000001' $$,
  'expired -> paid: a late payment is still honoured');
select throws_ok($$ update public.orders set status = 'pending' where id = 'e0000000-0000-4000-8000-000000000001' $$, '23514', null,
  'paid -> pending is rejected');
select lives_ok($$ update public.orders set status = 'partially_refunded', refunded_minor = 1000 where id = 'e0000000-0000-4000-8000-000000000001' $$,
  'paid -> partially_refunded');
select throws_ok($$ update public.orders set refunded_minor = 500 where id = 'e0000000-0000-4000-8000-000000000001' $$, '23514', null,
  'refunded amount cannot decrease');
select throws_ok($$ update public.orders set refunded_minor = 999999 where id = 'e0000000-0000-4000-8000-000000000001' $$, '23514', null,
  'refunds cannot exceed the order total');
select lives_ok($$ update public.orders set status = 'refunded', refunded_minor = 4700 where id = 'e0000000-0000-4000-8000-000000000001' $$,
  'partially_refunded -> refunded');
select throws_ok($$ update public.orders set status = 'paid' where id = 'e0000000-0000-4000-8000-000000000001' $$, '23514', null,
  'refunded is terminal');

-- ---------- immutability --------------------------------------------------
select throws_ok($$ update public.orders set total_minor = 1, subtotal_minor = 1 where id = 'e0000000-0000-4000-8000-000000000001' $$, '42501', null,
  'order amounts are immutable (tampering)');
select throws_ok($$ update public.orders set email = 'thief@example.com' where id = 'e0000000-0000-4000-8000-000000000001' $$, '42501', null,
  'order email is immutable');
select throws_ok($$ update public.orders set currency = 'USD' where id = 'e0000000-0000-4000-8000-000000000001' $$, '42501', null,
  'order currency is immutable');
select throws_ok($$ update public.orders set provider_txn_id = 'other' where id = 'e0000000-0000-4000-8000-000000000001' $$, '42501', null,
  'provider transaction id cannot change once set');
select throws_ok($$ delete from public.orders where id = 'e0000000-0000-4000-8000-000000000001' $$, '42501', null,
  'orders cannot be deleted, even by the database owner');
select throws_ok($$ update public.order_items set unit_price_minor = 1 where id = 'f0000000-0000-4000-8000-000000000001' $$, '42501', null,
  'order items are immutable');
select throws_ok($$ delete from public.order_items where id = 'f0000000-0000-4000-8000-000000000001' $$, '42501', null,
  'order items cannot be deleted');
select throws_ok($$ insert into public.order_items (order_id, product_id, title, product_type, unit_price_minor, quantity, line_total_minor, currency)
  values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000007', 'x', 'book', 1900, 1, 1900, 'USD') $$, '23514', null,
  'order item currency must match the order');
select throws_ok($$ insert into public.order_items (order_id, product_id, title, product_type, unit_price_minor, quantity, line_total_minor, currency)
  values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000007', 'x', 'book', 1900, 2, 1900, 'ZAR') $$, '23514', null,
  'line total must equal unit price x quantity');
select throws_ok($$ insert into public.order_items (order_id, product_id, title, product_type, unit_price_minor, quantity, line_total_minor, currency)
  values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'dup', 'course', 4700, 1, 4700, 'ZAR') $$, '23505', null,
  'one line per product per order');
select throws_ok($$ delete from public.products where slug = 'starter-course' $$, '23503', null,
  'a product that has been ordered cannot be hard-deleted (archive it instead)');

-- ---------- payment event idempotency ------------------------------------
insert into public.payment_events (provider, provider_event_id, type, order_id, payload)
values ('payfast', 'evt_replay_1', 'charge.success', 'e0000000-0000-4000-8000-000000000001', '{"n": 1}');
select throws_ok($$ insert into public.payment_events (provider, provider_event_id, type, payload) values ('payfast', 'evt_replay_1', 'charge.success', '{"n": 2}') $$, '23505', null,
  'webhook replay: the same provider event cannot be stored twice');
select lives_ok($$ insert into public.payment_events (provider, provider_event_id, type, payload) values ('stripe', 'evt_replay_1', 'charge.success', '{}') $$,
  'event ids are scoped per provider');
select throws_ok($$ update public.payment_events set payload = '{"forged": true}' where provider_event_id = 'evt_replay_1' and provider = 'payfast' $$, '42501', null,
  'stored webhook payloads are immutable');
select lives_ok($$ update public.payment_events set status = 'failed', error = 'lookup mismatch', attempts = 1 where provider_event_id = 'evt_replay_1' and provider = 'payfast' $$,
  'event processing status can be recorded for replay');
select throws_ok($$ delete from public.payment_events $$, '42501', null, 'payment events cannot be deleted');
select throws_ok($$ insert into public.orders (email, access_key_hash, currency, subtotal_minor, total_minor, provider, provider_txn_id, terms_accepted_at)
  values ('dup@example.com', extensions.digest('k2', 'sha256'), 'ZAR', 1, 1, 'payfast', 'txn_flow', now()) $$, '23505', null,
  'one order per provider transaction');

-- ---------- fulfilment integrity -----------------------------------------
-- Bundle order: assets of bundle components are valid; foreign assets are not.
insert into public.orders (id, email, access_key_hash, currency, subtotal_minor, total_minor, provider, terms_accepted_at)
values ('e0000000-0000-4000-8000-000000000002', 'bundle@example.com', extensions.digest('k3', 'sha256'), 'ZAR', 22900, 22900, 'payfast', now());
insert into public.order_items (id, order_id, product_id, title, product_type, unit_price_minor, quantity, line_total_minor, currency)
values ('f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000010', 'Bundle', 'bundle', 22900, 1, 22900, 'ZAR');

select lives_ok($$ insert into public.fulfilments (id, order_id, order_item_id, asset_id, kind)
  values ('90000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000007', 'external') $$,
  'bundle item may deliver a component''s asset (book-one PDF)');
select is((select kind::text from public.fulfilments where id = '90000000-0000-4000-8000-000000000001'), 'file',
  'fulfilment kind is taken from the asset, not the caller');
select lives_ok($$ insert into public.fulfilments (id, order_id, order_item_id, asset_id, kind)
  values ('90000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'external') $$,
  'mixed delivery: the same bundle item also delivers the external course');
select throws_ok($$ insert into public.fulfilments (order_id, order_item_id, asset_id, kind)
  values ('e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000007', 'file') $$, '23505', null,
  'webhook replay: one fulfilment per item and asset');
select throws_ok($$ insert into public.fulfilments (order_id, order_item_id, asset_id, kind)
  values ('e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000011', 'file') $$, '23514', null,
  'cannot deliver an asset the buyer did not purchase');
select throws_ok($$ insert into public.fulfilments (order_id, order_item_id, asset_id, kind)
  values ('e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000007', 'file') $$, '23514', null,
  'fulfilment order must match its order item');
select throws_ok($$ delete from public.fulfilments $$, '42501', null, 'fulfilments cannot be deleted');

-- ---------- delivery tokens ----------------------------------------------
select throws_ok($$ insert into public.delivery_tokens (fulfilment_id, token_hash, expires_at, max_downloads)
  values ('90000000-0000-4000-8000-000000000002', extensions.digest('t-ext', 'sha256'), now() + interval '7 days', 5) $$, '23514', null,
  'download tokens are only issued for file deliveries');
insert into public.delivery_tokens (id, fulfilment_id, token_hash, expires_at, max_downloads)
values ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', extensions.digest('t-1', 'sha256'), now() + interval '7 days', 2);
select throws_ok($$ insert into public.delivery_tokens (fulfilment_id, token_hash, expires_at, max_downloads)
  values ('90000000-0000-4000-8000-000000000001', extensions.digest('t-1', 'sha256'), now() + interval '7 days', 2) $$, '23505', null,
  'token hashes are unique');
select throws_ok($$ insert into public.delivery_tokens (fulfilment_id, token_hash, expires_at, max_downloads)
  values ('90000000-0000-4000-8000-000000000001', 'raw-token', now() + interval '7 days', 2) $$, '23514', null,
  'only 32-byte SHA-256 hashes are stored, never raw tokens');
select throws_ok($$ update public.delivery_tokens set download_count = 3 where id = '91000000-0000-4000-8000-000000000001' $$, '23514', null,
  'download count cannot exceed the limit');
select lives_ok($$ update public.delivery_tokens set download_count = 1 where id = '91000000-0000-4000-8000-000000000001' $$, 'download counted');
select throws_ok($$ update public.delivery_tokens set download_count = 0 where id = '91000000-0000-4000-8000-000000000001' $$, '23514', null,
  'download count cannot be reset');
select throws_ok($$ update public.delivery_tokens set revoked_at = now() where id = '91000000-0000-4000-8000-000000000001' $$, '23514', null,
  'revocation requires a reason');
select lives_ok($$ update public.delivery_tokens set revoked_at = now(), revoked_reason = 'refund' where id = '91000000-0000-4000-8000-000000000001' $$, 'token revoked');
select throws_ok($$ update public.delivery_tokens set revoked_at = null, revoked_reason = null where id = '91000000-0000-4000-8000-000000000001' $$, '23514', null,
  'a revoked token cannot be reinstated');
select throws_ok($$ update public.delivery_tokens set max_downloads = 100 where id = '91000000-0000-4000-8000-000000000001' $$, '42501', null,
  'token limits are immutable (renewal issues a new token)');
select throws_ok($$ delete from public.delivery_tokens $$, '42501', null, 'delivery tokens cannot be deleted');

-- ---------- email outbox idempotency -------------------------------------
insert into public.email_events (order_id, template, to_email) values ('e0000000-0000-4000-8000-000000000002', 'delivery', 'bundle@example.com');
select throws_ok($$ insert into public.email_events (order_id, template, to_email) values ('e0000000-0000-4000-8000-000000000002', 'delivery', 'bundle@example.com') $$, '23505', null,
  'webhook replay: the delivery email is queued once');
select lives_ok($$ insert into public.email_events (order_id, template, dedupe_key, to_email) values ('e0000000-0000-4000-8000-000000000002', 'delivery', 'resend-1', 'bundle@example.com') $$,
  'an explicit resend uses a new dedupe key');
insert into public.email_events (order_id, template, dedupe_key, to_email) values (null, 'admin_alert', 'failed-fulfilment-1', 'owner@example.com');
select throws_ok($$ insert into public.email_events (order_id, template, dedupe_key, to_email) values (null, 'admin_alert', 'failed-fulfilment-1', 'owner@example.com') $$, '23505', null,
  'dedupe also applies to emails without an order (NULLS NOT DISTINCT)');
select throws_ok($$ update public.email_events set status = 'sent' where template = 'admin_alert' $$, '23514', null,
  'a sent email must record when it was sent');

-- ---------- audit log -----------------------------------------------------
select ok((select count(*) from public.audit_log where entity = 'orders' and entity_id = 'e0000000-0000-4000-8000-000000000001') >= 5,
  'every order state change is audited');
select is((select after ->> 'status' from public.audit_log where entity = 'orders' and entity_id = 'e0000000-0000-4000-8000-000000000001' order by id desc limit 1),
  'refunded', 'audit captures the after-image');
select is((select actor_role from public.audit_log order by id desc limit 1), 'postgres', 'maintenance changes are attributed to the database role');
select throws_ok($$ update public.audit_log set entity = 'x' $$, '42501', null, 'audit log rows cannot be altered, even by the database owner');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'audit log rows cannot be deleted, even by the database owner');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'audit log cannot be truncated');

select * from finish();
rollback;
