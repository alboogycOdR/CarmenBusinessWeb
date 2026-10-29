-- Structural security posture + constraint behaviour (PR 1).
begin;
\ir _helpers.psql
select no_plan();

-- ---------- posture -------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'RLS is enabled on every table in public');

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0, 'anon/authenticated hold no TRUNCATE, REFERENCES or TRIGGER privileges (RLS does not cover them)');

select is(
  (select array_agg(distinct table_name::text order by table_name::text) from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'anon'),
  array['bundle_items', 'categories', 'product_categories', 'products', 'public_catalog'],
  'anon holds privileges only on public catalogue relations');

select is(
  (select array_agg(distinct privilege_type::text) from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'anon'),
  array['SELECT'], 'anon privileges are SELECT only');

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and table_name in ('orders', 'order_items', 'payment_events', 'fulfilments', 'delivery_tokens', 'email_events', 'admin_profiles', 'audit_log')),
  0, 'authenticated cannot write order, payment, delivery, staff or audit tables');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  0, 'every SECURITY DEFINER function pins search_path');

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  null, 'no public function is callable by anon or authenticated (RPC surface is server-only)');

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  array['create_pending_order', 'expire_stale_orders', 'get_order_status', 'payfast_minimum_minor'],
  'the server RPC surface is exactly the checkout functions');

-- ---------- ZAR only (ADR-0009) ------------------------------------------
select throws_ok($$ insert into public.products (slug, type, title, price_minor, currency) values ('usd', 'book', 'x', 100, 'USD') $$, '23514', null, 'products must be priced in ZAR');
select throws_ok($$ insert into public.coupons (code, amount_off_minor, currency) values ('USDOFF', 100, 'USD') $$, '23514', null, 'amount coupons must be in ZAR');
select is((select count(*)::int from public.products where currency <> 'ZAR'), 0, 'seed catalogue is ZAR');
select is(public.payfast_minimum_minor(), 500::bigint, 'Payfast minimum is R5.00');

select ok(
  (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.public_catalog'::regclass),
  'public_catalog runs with the caller''s RLS (security_invoker)');

select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns
    where table_schema = 'public' and table_name = 'public_catalog'
      and column_name in ('storage_path', 'external_url', 'instructions', 'status', 'manual_eta_text')),
  null, 'public_catalog exposes no delivery data or status');

select ok(not exists (select 1 from pg_namespace n
  where n.nspname = 'private' and has_schema_privilege('anon', n.oid, 'USAGE')),
  'anon cannot use the private schema');

-- ---------- constraints ---------------------------------------------------
select throws_ok($$ insert into public.categories (slug, name) values ('Bad Slug', 'x') $$, '23514', null, 'slug format enforced');
select throws_ok($$ insert into public.products (slug, type, title, price_minor, currency) values ('neg', 'book', 'x', -1, 'ZAR') $$, '23514', null, 'negative price rejected');
select throws_ok($$ insert into public.products (slug, type, title, price_minor, currency) values ('cur', 'book', 'x', 1, 'usd') $$, '23514', null, 'currency must be ISO uppercase');
select throws_ok($$ insert into public.products (slug, type, title, price_minor, compare_at_minor, currency) values ('cmp', 'book', 'x', 100, 100, 'ZAR') $$, '23514', null, 'compare-at must exceed price');
select throws_ok($$ insert into public.products (slug, type, status, title, price_minor, currency, summary) values ('pub', 'book', 'published', 'x', 100, 'ZAR', 's') $$, '23514', null, 'published requires published_at');
select throws_ok($$ insert into public.products (slug, type, status, title, price_minor, currency) values ('arc', 'book', 'archived', 'x', 100, 'ZAR') $$, '23514', null, 'archived requires archived_at');

select throws_ok($$ insert into public.coupons (code, percent_off, amount_off_minor, currency) values ('BOTH', 10, 100, 'ZAR') $$, '23514', null, 'coupon has exactly one discount type');
select throws_ok($$ insert into public.coupons (code, amount_off_minor) values ('NOCUR', 100) $$, '23514', null, 'amount coupon needs a currency');
select throws_ok($$ insert into public.coupons (code, percent_off) values ('lower', 10) $$, '23514', null, 'coupon codes are uppercase');
select throws_ok($$ insert into public.coupons (code, percent_off) values ('PCT0', 0) $$, '23514', null, 'percent must be 1..100');

select throws_ok($$ insert into public.product_assets (product_id, kind, label, storage_path, external_url) values ('a0000000-0000-4000-8000-000000000006', 'file', 'x', 'a/b.pdf', 'https://x.example') $$, '23514', null, 'file asset cannot carry an external URL');
select throws_ok($$ insert into public.product_assets (product_id, kind, label, external_url) values ('a0000000-0000-4000-8000-000000000001', 'external', 'x', 'http://insecure.example') $$, '23514', null, 'external URLs must be https');
select throws_ok($$ insert into public.product_assets (product_id, kind, label, external_url, access_mode) values ('a0000000-0000-4000-8000-000000000001', 'external', 'x', 'https://x.example', 'manual') $$, '23514', null, 'manual access requires truthful ETA text');
select throws_ok($$ insert into public.product_assets (product_id, kind, label, storage_path) values ('a0000000-0000-4000-8000-000000000006', 'file', 'x', '../etc/passwd') $$, '23514', null, 'storage path traversal rejected');

select throws_ok($$ insert into public.orders (email, access_key_hash, currency, subtotal_minor, total_minor, provider, terms_accepted_at) values ('Buyer@Example.com', extensions.digest('k', 'sha256'), 'ZAR', 100, 100, 'payfast', now()) $$, '23514', null, 'order email must be lower-case normalised');
select throws_ok($$ insert into public.orders (email, access_key_hash, currency, subtotal_minor, discount_minor, total_minor, provider, terms_accepted_at) values ('b@example.com', extensions.digest('k', 'sha256'), 'ZAR', 1000, 100, 1000, 'payfast', now()) $$, '23514', null, 'order total must equal subtotal minus discount');
select throws_ok($$ insert into public.orders (email, access_key_hash, currency, subtotal_minor, total_minor, provider) values ('b@example.com', extensions.digest('k', 'sha256'), 'ZAR', 100, 100, 'payfast') $$, '23502', null, 'terms acceptance is mandatory');
select throws_ok($$ insert into public.orders (email, access_key_hash, currency, subtotal_minor, total_minor, provider, terms_accepted_at, status) values ('b@example.com', extensions.digest('k', 'sha256'), 'ZAR', 100, 100, 'payfast', now(), 'paid') $$, '23514', null, 'an order cannot be paid without paid_at and provider transaction');
select tests.make_paid_order('optin@example.com');
select is((select marketing_opt_in from public.orders where email = 'optin@example.com'), false, 'marketing opt-in defaults to false (spec 4.3)');
select matches((select reference from public.orders where email = 'optin@example.com'), '^CBW-[0-9A-HJKMNP-TV-Z]{10}$', 'order reference is generated in Crockford base32');

select throws_ok($$ insert into public.bundle_items (bundle_id, product_id) values ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006') $$, '23514', null, 'bundle_id must be a bundle');
select throws_ok($$
  with b as (insert into public.products (slug, type, title, price_minor, currency) values ('b2', 'bundle', 'b2', 100, 'ZAR') returning id)
  insert into public.bundle_items (bundle_id, product_id) select 'a0000000-0000-4000-8000-000000000010', id from b $$,
  '23514', null, 'bundles cannot contain bundles');
select throws_ok($$ update public.products set type = 'bundle' where slug = 'book-one' $$, '23514', null, 'a bundle component cannot become a bundle');
select throws_ok($$ update public.products set type = 'course' where slug = 'bundle' $$, '23514', null, 'a bundle with items cannot change type');

select * from finish();
rollback;
