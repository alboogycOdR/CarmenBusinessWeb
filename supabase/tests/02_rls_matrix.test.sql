-- Authorization matrix (spec §7 "Admin access", database layer).
-- Personas: anon, signed-in user without a staff profile, support/admin/owner
-- with and without MFA (aal1/aal2), and the server's service role.
begin;
\ir _helpers.psql
select no_plan();

select tests.make_user('nobody@example.com',  null,      '00000000-0000-4000-8000-0000000000a1');
select tests.make_user('support@example.com', 'support', '00000000-0000-4000-8000-0000000000a2');
select tests.make_user('admin@example.com',   'admin',   '00000000-0000-4000-8000-0000000000a3');
select tests.make_user('owner@example.com',   'owner',   '00000000-0000-4000-8000-0000000000a4');
select tests.make_paid_order();

-- ===================== anon (public browser key) ==========================
select tests.act_as('anon');
select is(tests.count_rows('public_catalog'), 10::bigint, 'anon: catalogue view shows the 10 published products');
select is(tests.count_rows('products'), 10::bigint, 'anon: products table shows published rows only');
select is((select count(*) from public.products where status <> 'published'), 0::bigint, 'anon: draft/archived products are invisible');
select is(tests.count_rows('categories'), 5::bigint, 'anon: categories are public');
select is(tests.count_rows('bundle_items'), 4::bigint, 'anon: published bundle contents are public');
select throws_ok(format('select 1 from public.%I', t), '42501', null, 'anon: cannot read ' || t)
  from unnest(array['product_assets', 'coupons', 'orders', 'order_items', 'payment_events', 'fulfilments',
                    'delivery_tokens', 'email_events', 'admin_profiles', 'audit_log']) t;
select throws_ok($$ insert into public.products (slug, type, title, price_minor, currency) values ('hack', 'book', 'x', 1, 'ZAR') $$, '42501', null, 'anon: cannot insert products');
select throws_ok($$ update public.products set price_minor = 1 $$, '42501', null, 'anon: cannot update products');
select throws_ok($$ delete from public.categories $$, '42501', null, 'anon: cannot delete categories');
select throws_ok($$ truncate public.products cascade $$, '42501', null, 'anon: cannot truncate');

-- ============ signed in, no staff profile (even with MFA) =================
select tests.act_as('authenticated', '00000000-0000-4000-8000-0000000000a1', 'aal2');
select is((select count(*) from public.products where status <> 'published'), 0::bigint, 'non-staff: no draft/archived products');
select is(tests.count_rows(t), 0::bigint, 'non-staff: sees no rows in ' || t)
  from unnest(array['product_assets', 'coupons', 'orders', 'order_items', 'payment_events', 'fulfilments',
                    'delivery_tokens', 'email_events', 'admin_profiles', 'audit_log']) t;
select throws_ok($$ insert into public.products (slug, type, title, price_minor, currency) values ('hack', 'book', 'x', 1, 'ZAR') $$, '42501', null, 'non-staff: cannot insert products');
select is(tests.affected($$ update public.products set price_minor = 1 $$), 0::bigint, 'non-staff: product updates affect no rows');
select throws_ok($$ insert into public.admin_profiles (user_id, role) values ('00000000-0000-4000-8000-0000000000a1', 'owner') $$, '42501', null, 'non-staff: cannot self-assign a staff role');
select throws_ok($$ insert into public.orders (email, access_key_hash, currency, subtotal_minor, total_minor, provider, terms_accepted_at) values ('x@example.com', extensions.digest('k', 'sha256'), 'ZAR', 1, 1, 'payfast', now()) $$, '42501', null, 'non-staff: cannot create orders directly');

-- ===================== admin WITHOUT MFA (aal1) ===========================
select tests.act_as('authenticated', '00000000-0000-4000-8000-0000000000a3', 'aal1');
select is((select count(*) from public.products where status <> 'published'), 0::bigint, 'admin aal1: no staff visibility before MFA');
select is(tests.count_rows('orders'), 0::bigint, 'admin aal1: cannot read orders before MFA');
select is(tests.count_rows('product_assets'), 0::bigint, 'admin aal1: cannot read assets before MFA');
select is(tests.affected($$ update public.products set price_minor = 1 $$), 0::bigint, 'admin aal1: cannot edit products before MFA');
select is(tests.count_rows('admin_profiles'), 1::bigint, 'admin aal1: can see own profile (so the UI can prompt for MFA)');

-- ========================= support (aal2) =================================
select tests.act_as('authenticated', '00000000-0000-4000-8000-0000000000a2', 'aal2');
select is(tests.count_rows('products'), 12::bigint, 'support: sees all products incl. draft/archived');
select is(tests.count_rows(t), tests.total_rows(t), 'support: can read ' || t)
  from unnest(array['orders', 'order_items', 'payment_events', 'fulfilments', 'delivery_tokens']) t;
select ok(tests.total_rows(t) >= 1, 'non-vacuous: ' || t || ' has rows')
  from unnest(array['orders', 'order_items', 'payment_events', 'fulfilments', 'delivery_tokens']) t;
select is(tests.count_rows('product_assets'), 12::bigint, 'support: can read delivery assets (for support cases)');
select is(tests.count_rows('coupons'), tests.total_rows('coupons'), 'support: can read coupons');
select is(tests.count_rows('audit_log'), 0::bigint, 'support: cannot read the audit log');
select is(tests.count_rows('admin_profiles'), 1::bigint, 'support: sees only own staff profile');
select throws_ok($$ insert into public.products (slug, type, title, price_minor, currency) values ('sup', 'book', 'x', 1, 'ZAR') $$, '42501', null, 'support: cannot create products');
select is(tests.affected($$ update public.products set price_minor = 1 $$), 0::bigint, 'support: cannot edit products');
select is(tests.affected($$ update public.coupons set active = false $$), 0::bigint, 'support: cannot edit coupons');
select is(tests.affected($$ delete from public.product_assets $$), 0::bigint, 'support: cannot delete assets');

-- ========================== admin (aal2) ==================================
select tests.act_as('authenticated', '00000000-0000-4000-8000-0000000000a3', 'aal2');
select lives_ok($$ insert into public.products (slug, type, title, price_minor, currency) values ('admin-new', 'guide', 'New guide', 500, 'ZAR') $$, 'admin: can create a product');
select is(tests.affected($$ update public.products set price_minor = 2500 where slug = 'book-one' $$), 1::bigint, 'admin: can edit a product');
select lives_ok($$ insert into public.product_assets (product_id, kind, label, storage_path) select id, 'file', 'Guide PDF', 'admin-new/guide.pdf' from public.products where slug = 'admin-new' $$, 'admin: can attach a delivery asset');
select lives_ok($$ insert into public.coupons (code, percent_off) values ('ADMIN15', 15) $$, 'admin: can create a coupon');
select is(tests.count_rows('orders'), tests.total_rows('orders'), 'admin: can read orders');
select throws_ok($$ insert into public.orders (email, access_key_hash, currency, subtotal_minor, total_minor, provider, terms_accepted_at) values ('x@example.com', extensions.digest('k', 'sha256'), 'ZAR', 1, 1, 'payfast', now()) $$, '42501', null, 'admin: orders are created only by the server');
select throws_ok($$ update public.orders set status = 'refunded' $$, '42501', null, 'admin: order state changes go through server functions only');
select throws_ok($$ update public.delivery_tokens set revoked_at = now(), revoked_reason = 'x' $$, '42501', null, 'admin: token revocation goes through server functions only');
select throws_ok($$ delete from public.payment_events $$, '42501', null, 'admin: cannot delete payment events');
select throws_ok($$ update public.admin_profiles set role = 'owner' $$, '42501', null, 'admin: cannot escalate own role');
select ok(tests.count_rows('audit_log') > 0, 'admin: can read the audit log');
select is((select actor from public.audit_log where entity = 'products' and action = 'UPDATE' order by id desc limit 1),
          '00000000-0000-4000-8000-0000000000a3'::uuid, 'audit log attributes the product edit to the admin');
select is(tests.count_rows('admin_profiles'), 1::bigint, 'admin: sees only own staff profile');

-- ========================== owner =========================================
select tests.act_as('authenticated', '00000000-0000-4000-8000-0000000000a4', 'aal2');
select is(tests.count_rows('admin_profiles'), 3::bigint, 'owner aal2: sees all staff');
select throws_ok($$ insert into public.admin_profiles (user_id, role) values ('00000000-0000-4000-8000-0000000000a1', 'admin') $$, '42501', null, 'owner: staff are granted by script, not via the API');
select tests.act_as('authenticated', '00000000-0000-4000-8000-0000000000a4', 'aal1');
select is(tests.count_rows('admin_profiles'), 1::bigint, 'owner aal1: only own profile before MFA');

-- ======================= service role (server) ============================
select tests.act_as('service_role');
select is(tests.count_rows('orders'), tests.total_rows('orders'), 'service role: reads orders (bypasses RLS)');
select lives_ok($$ insert into public.orders (email, access_key_hash, currency, subtotal_minor, total_minor, provider, terms_accepted_at)
  values ('svc@example.com', extensions.digest('svc', 'sha256'), 'ZAR', 500, 500, 'payfast', now()) $$,
  'service role: can create an order (reference default is executable)');
select lives_ok($$ select public.create_pending_order('[{"id": "planner", "qty": 1}]', 'svc2@example.com', null, false, true, extensions.digest('svc2', 'sha256'), null, false) $$,
  'service role: can call create_pending_order');
select throws_ok($$ insert into public.audit_log (actor_role, action, entity) values ('x', 'INSERT', 'x') $$, '42501', null, 'service role: cannot forge audit entries');
select throws_ok($$ update public.audit_log set entity = 'x' $$, '42501', null, 'service role: cannot alter the audit log');
select throws_ok($$ delete from public.orders $$, '42501', null, 'service role: orders are never deleted');

select * from finish();
rollback;
