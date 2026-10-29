-- Download tokens (PR 5): issue_delivery_tokens, download_token_status, consume_download.
-- Runs as service_role, the privileges the download function has.
begin;
\ir _helpers.psql
select no_plan();

-- A paid order (through the real ITN path) for the given products; returns its id.
create function tests.paid(p_slugs text[], p_email text)
returns uuid
language plpgsql
as $$
declare r jsonb; ref text; total bigint;
begin
  r := public.create_pending_order((select jsonb_agg(jsonb_build_object('id', s, 'qty', 1)) from unnest(p_slugs) s),
                                   p_email, null, false, true, extensions.digest(p_email, 'sha256'), null, false);
  ref := r ->> 'reference'; total := (r ->> 'total_minor')::bigint;
  perform public.process_payfast_itn((900000000 + (random() * 99999999)::int)::text || ':COMPLETE', 'COMPLETE', ref, total,
                                     (900000000 + (random() * 99999999)::int)::text, false, '{}'::jsonb, null);
  return (r ->> 'order_id')::uuid;
end;
$$;
-- base64url (as sent in links) -> the stored hash
create function tests.h(p_token text) returns bytea language sql as $$
  select extensions.digest(decode(translate(p_token, '-_', '+/') || '=', 'base64'), 'sha256') $$;
grant execute on all functions in schema tests to service_role;

create temp table t (name text primary key, order_id uuid, links jsonb, newlinks jsonb) on commit drop;
grant all on t to service_role;

-- ---------- storage posture ---------------------------------------------
select is((select public from storage.buckets where id = 'product-files'), false, 'product-files bucket is private');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and (qual ilike '%product-files%' or with_check ilike '%product-files%')), 0,
  'no storage policy opens product-files to anyone (only the service role can read it)');
select is(public.download_policy(), '{"valid_days": 7, "max_downloads": 5}'::jsonb, 'D5: 7 days, 5 downloads');

select tests.act_as('service_role');

-- ---------- issuing ------------------------------------------------------
select throws_ok($$ select public.issue_delivery_tokens((public.create_pending_order('[{"id": "book-one", "qty": 1}]', 'unpaid@example.com', null, false, true,
                      extensions.digest('u', 'sha256'), null, false) ->> 'order_id')::uuid) $$,
  'P0001', 'delivery:order_not_paid', 'no links for an unpaid order');
select throws_ok($$ select public.issue_delivery_tokens(gen_random_uuid()) $$, 'P0001', 'delivery:order_not_found', 'unknown order');

-- signature-course: an external link + a workbook file -> one token (files only).
insert into t (name, order_id) values ('mixed', tests.paid(array['signature-course'], 'mixed-dl@example.com'));
update t set links = public.issue_delivery_tokens(order_id) -> 'links' where name = 'mixed';
select is((select jsonb_array_length(links) from t where name = 'mixed'), 1, 'mixed product: a token for the file only (links go by email)');
select is((select links -> 0 ->> 'label' || ' / ' || (links -> 0 ->> 'filename') from t where name = 'mixed'),
  'Signature workbook (PDF) / workbook.pdf', 'label and filename returned for the email');
select ok((select (links -> 0 ->> 'token') ~ '^[A-Za-z0-9_-]{43}$' from t where name = 'mixed'), 'token is 32 bytes, base64url');
select is((select count(*)::int from public.delivery_tokens d join t on true where t.name = 'mixed' and d.token_hash = tests.h(t.links -> 0 ->> 'token')), 1,
  'only the SHA-256 of the token is stored');
select is((select count(*)::int from public.delivery_tokens d, t where t.name = 'mixed'
             and position(convert_to(t.links -> 0 ->> 'token', 'UTF8') in d.token_hash) > 0), 0, 'the raw token is not stored');
select ok((select abs(extract(epoch from (d.expires_at - (now() + interval '7 days')))) < 5 and d.max_downloads = 5
             from public.delivery_tokens d, t where t.name = 'mixed' and d.token_hash = tests.h(t.links -> 0 ->> 'token')),
  'link valid for 7 days and 5 downloads');

insert into t (name, order_id) values ('bundle', tests.paid(array['bundle'], 'bundle-dl@example.com'));
update t set links = public.issue_delivery_tokens(order_id) -> 'links' where name = 'bundle';
select is((select jsonb_array_length(links) from t where name = 'bundle'), 5, 'bundle: one token per component file (4 files + workbook)');

-- ---------- status and consumption --------------------------------------
select is((select public.download_token_status(tests.h(links -> 0 ->> 'token')) ->> 'state' from t where name = 'mixed'), 'ok', 'fresh token: ok');
select is((select (public.download_token_status(tests.h(links -> 0 ->> 'token')) ->> 'remaining')::int from t where name = 'mixed'), 5, '5 left');
select is((select public.consume_download(tests.h(links -> 0 ->> 'token')) ->> 'remaining' from t where name = 'mixed'), '4', 'download 1 → 4 left');
select is((select public.consume_download(tests.h(links -> 0 ->> 'token')) ->> 'remaining' from t where name = 'mixed'), '3', 'download 2');
select is((select public.consume_download(tests.h(links -> 0 ->> 'token')) ->> 'remaining' from t where name = 'mixed'), '2', 'download 3');
select is((select public.consume_download(tests.h(links -> 0 ->> 'token')) ->> 'remaining' from t where name = 'mixed'), '1', 'download 4');
select is((select public.consume_download(tests.h(links -> 0 ->> 'token')) - 'expires_at' - 'reference'
             from t where name = 'mixed'),
  jsonb_build_object('state', 'ok', 'consumed', true, 'remaining', 0, 'label', 'Signature workbook (PDF)', 'filename', 'workbook.pdf',
                     'storage_path', 'signature-course/workbook.pdf', 'max_downloads', 5), 'download 5: the last one');
select is((select public.consume_download(tests.h(links -> 0 ->> 'token')) ->> 'state' from t where name = 'mixed'), 'used_up', 'download 6 is refused');
select is((select d.download_count from public.delivery_tokens d, t where t.name = 'mixed' and d.token_hash = tests.h(t.links -> 0 ->> 'token')), 5,
  'count never exceeds the limit');
select ok((select (public.consume_download(tests.h(links -> 0 ->> 'token')) -> 'consumed') is null from t where name = 'mixed'), 'a refusal consumes nothing');

select is(public.download_token_status(extensions.digest('nope', 'sha256')), '{"state": "unknown"}'::jsonb, 'unknown token: nothing else revealed');
select is(public.consume_download(extensions.digest('nope', 'sha256')), '{"state": "unknown"}'::jsonb, 'unknown token cannot be consumed');

-- expired
select tests.as_postgres();
update public.delivery_tokens d set expires_at = now() - interval '1 second'
  from t where t.name = 'bundle' and d.token_hash = tests.h(t.links -> 0 ->> 'token');
select tests.act_as('service_role');
select is((select public.consume_download(tests.h(links -> 0 ->> 'token')) ->> 'state' from t where name = 'bundle'), 'expired', 'expired token refused');

-- replaced (revoked)
update t set newlinks = public.issue_delivery_tokens(order_id, true) -> 'links' where name = 'bundle';
select is((select public.consume_download(tests.h(links -> 1 ->> 'token')) ->> 'state' from t where name = 'bundle'), 'revoked',
  '"send new links" revokes the old ones');
select is((select revoked_reason from public.delivery_tokens d, t where t.name = 'bundle' and d.token_hash = tests.h(t.links -> 1 ->> 'token')),
  'replaced by a new link', 'with a reason');
select is((select public.consume_download(tests.h(newlinks -> 1 ->> 'token')) ->> 'state' from t where name = 'bundle'), 'ok', 'the new link works');

-- refunded / disputed orders
insert into t (name, order_id) values ('refund', tests.paid(array['book-two'], 'refund-dl@example.com'));
update t set links = public.issue_delivery_tokens(order_id) -> 'links' where name = 'refund';
select tests.as_postgres();
update public.orders set status = 'disputed' where id = (select order_id from t where name = 'refund');
select tests.act_as('service_role');
select is((select public.consume_download(tests.h(links -> 0 ->> 'token')) ->> 'state' from t where name = 'refund'), 'unpaid', 'disputed order: no downloads');
select throws_ok($$ select public.issue_delivery_tokens((select order_id from t where name = 'refund')) $$, 'P0001', 'delivery:order_not_paid',
  'and no new links');

-- ---------- access -------------------------------------------------------
select tests.act_as('anon');
select throws_ok($$ select public.consume_download('\x00') $$, '42501', null, 'anon cannot consume downloads');
select throws_ok($$ select public.issue_delivery_tokens(gen_random_uuid()) $$, '42501', null, 'anon cannot issue links');
select is((select count(*)::int from storage.objects where bucket_id = 'product-files'), 0, 'anon sees no product files');
select tests.act_as('authenticated', gen_random_uuid(), 'aal2');
select throws_ok($$ select public.download_token_status('\x00') $$, '42501', null, 'signed-in users cannot query tokens');
select is((select count(*)::int from storage.objects where bucket_id = 'product-files'), 0, 'signed-in users see no product files');

select * from finish();
rollback;
