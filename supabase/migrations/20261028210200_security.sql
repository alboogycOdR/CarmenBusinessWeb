-- PR 1 / migration 3: authorization.
--
-- Posture (architecture review §3.5):
--   * RLS is enabled on every table; anything not granted by a policy is denied.
--   * anon (the public key shipped to browsers) can read only published catalogue
--     data, and preferably through public.public_catalog.
--   * Staff access requires an admin_profiles row AND an MFA session (aal2).
--     owner/admin may edit the catalogue; support is read-only.
--   * Orders, payments, fulfilment and email tables are written only by server
--     functions using the service role. No authenticated write policies exist.
--   * TRUNCATE/REFERENCES/TRIGGER are revoked: RLS does not govern them.

-- ---------------------------------------------------------------------------
-- Role helpers (private schema: not callable through the REST API)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so policies can read admin_profiles without recursing into
-- its own RLS. search_path is pinned to prevent hijacking.
create function private.staff_role()
returns public.admin_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.admin_profiles where user_id = (select auth.uid());
$$;

create function private.is_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false);
$$;

-- True when the caller is staff with one of the given roles and has passed MFA.
create function private.is_staff(roles public.admin_role[] default array['owner', 'admin', 'support']::public.admin_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_aal2() and coalesce(private.staff_role() = any (roles), false);
$$;

revoke all on all functions in schema private from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.staff_role(), private.is_aal2(), private.is_staff(public.admin_role[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.categories         enable row level security;
alter table public.products           enable row level security;
alter table public.product_categories enable row level security;
alter table public.bundle_items       enable row level security;
alter table public.product_assets     enable row level security;
alter table public.coupons            enable row level security;
alter table public.orders             enable row level security;
alter table public.order_items        enable row level security;
alter table public.payment_events     enable row level security;
alter table public.fulfilments        enable row level security;
alter table public.delivery_tokens    enable row level security;
alter table public.email_events       enable row level security;
alter table public.admin_profiles     enable row level security;

-- ---------------------------------------------------------------------------
-- Grants (defence in depth beneath RLS)
-- ---------------------------------------------------------------------------
-- RLS does not apply to TRUNCATE, REFERENCES or TRIGGER: revoke them for API roles.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- anon never touches private tables at all, regardless of policies.
revoke all on public.product_assets, public.coupons, public.orders, public.order_items,
              public.payment_events, public.fulfilments, public.delivery_tokens,
              public.email_events, public.admin_profiles
  from anon;
-- anon may only read the public catalogue tables.
revoke insert, update, delete on public.categories, public.products, public.product_categories, public.bundle_items from anon;

-- authenticated users never write order/payment/delivery tables; only server
-- functions (service role) do. Revoking makes this independent of policies.
revoke insert, update, delete on public.orders, public.order_items, public.payment_events,
              public.fulfilments, public.delivery_tokens, public.email_events, public.admin_profiles
  from authenticated;

-- ---------------------------------------------------------------------------
-- Catalogue policies
-- ---------------------------------------------------------------------------
create policy categories_public_read on public.categories
  for select to anon, authenticated using (true);
create policy categories_staff_write on public.categories
  for all to authenticated
  using ((select private.is_staff(array['owner', 'admin']::public.admin_role[])))
  with check ((select private.is_staff(array['owner', 'admin']::public.admin_role[])));

create policy products_public_read on public.products
  for select to anon, authenticated using (status = 'published');
create policy products_staff_read on public.products
  for select to authenticated using ((select private.is_staff()));
create policy products_staff_write on public.products
  for all to authenticated
  using ((select private.is_staff(array['owner', 'admin']::public.admin_role[])))
  with check ((select private.is_staff(array['owner', 'admin']::public.admin_role[])));

create policy product_categories_public_read on public.product_categories
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.status = 'published'));
create policy product_categories_staff_read on public.product_categories
  for select to authenticated using ((select private.is_staff()));
create policy product_categories_staff_write on public.product_categories
  for all to authenticated
  using ((select private.is_staff(array['owner', 'admin']::public.admin_role[])))
  with check ((select private.is_staff(array['owner', 'admin']::public.admin_role[])));

create policy bundle_items_public_read on public.bundle_items
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = bundle_id and p.status = 'published'));
create policy bundle_items_staff_read on public.bundle_items
  for select to authenticated using ((select private.is_staff()));
create policy bundle_items_staff_write on public.bundle_items
  for all to authenticated
  using ((select private.is_staff(array['owner', 'admin']::public.admin_role[])))
  with check ((select private.is_staff(array['owner', 'admin']::public.admin_role[])));

create policy product_assets_staff_read on public.product_assets
  for select to authenticated using ((select private.is_staff()));
create policy product_assets_staff_write on public.product_assets
  for all to authenticated
  using ((select private.is_staff(array['owner', 'admin']::public.admin_role[])))
  with check ((select private.is_staff(array['owner', 'admin']::public.admin_role[])));

create policy coupons_staff_read on public.coupons
  for select to authenticated using ((select private.is_staff()));
create policy coupons_staff_write on public.coupons
  for all to authenticated
  using ((select private.is_staff(array['owner', 'admin']::public.admin_role[])))
  with check ((select private.is_staff(array['owner', 'admin']::public.admin_role[])));

-- ---------------------------------------------------------------------------
-- Operational tables: staff read-only (writes are service-role only)
-- ---------------------------------------------------------------------------
create policy orders_staff_read          on public.orders          for select to authenticated using ((select private.is_staff()));
create policy order_items_staff_read     on public.order_items     for select to authenticated using ((select private.is_staff()));
create policy payment_events_staff_read  on public.payment_events  for select to authenticated using ((select private.is_staff()));
create policy fulfilments_staff_read     on public.fulfilments     for select to authenticated using ((select private.is_staff()));
create policy delivery_tokens_staff_read on public.delivery_tokens for select to authenticated using ((select private.is_staff()));
create policy email_events_staff_read    on public.email_events    for select to authenticated using ((select private.is_staff()));

-- A signed-in user may see their own staff row even before MFA, so the admin UI
-- can tell them to complete MFA. Owners (aal2) may see all staff.
create policy admin_profiles_self_read on public.admin_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy admin_profiles_owner_read on public.admin_profiles
  for select to authenticated using ((select private.is_staff(array['owner']::public.admin_role[])));

-- ---------------------------------------------------------------------------
-- Public catalogue view (read model for the storefront build, ADR-0006)
-- security_invoker: the caller's RLS applies, so anon sees published rows only.
-- Contains no delivery data.
-- ---------------------------------------------------------------------------
create view public.public_catalog
with (security_invoker = true, security_barrier = true)
as
select
  p.id,
  p.slug,
  p.type,
  p.title,
  p.subtitle,
  p.summary,
  p.description,
  p.included,
  p.info,
  p.images,
  p.display,
  p.price_minor,
  p.compare_at_minor,
  p.currency,
  p.allow_quantity,
  p.sort,
  p.published_at,
  coalesce((select array_agg(c.name order by c.sort, c.name)
            from public.product_categories pc
            join public.categories c on c.id = pc.category_id
            where pc.product_id = p.id), '{}') as categories,
  coalesce((select array_agg(child.slug order by child.sort, child.slug)
            from public.bundle_items bi
            join public.products child on child.id = bi.product_id and child.status = 'published'
            where bi.bundle_id = p.id), '{}') as bundle_contents
from public.products p
where p.status = 'published';

revoke all on public.public_catalog from anon, authenticated;
grant select on public.public_catalog to anon, authenticated;
