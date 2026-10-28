-- Rollback for PR 1 (migrations 20261028210000 .. 20261028210300).
--
-- USE ONLY on a disposable environment (local or a staging project with no
-- real orders). It destroys every order, payment and audit record created by
-- this schema. Production databases are never rolled back; they roll forward
-- with a corrective migration (see docs/database.md §6).
--
-- Usage (staging):  psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/20261028_pr1_down.sql
-- then remove the four rows from supabase_migrations.schema_migrations (done below).

begin;

drop view if exists public.public_catalog;

drop table if exists
  public.audit_log,
  public.email_events,
  public.delivery_tokens,
  public.fulfilments,
  public.payment_events,
  public.order_items,
  public.orders,
  public.coupons,
  public.product_assets,
  public.bundle_items,
  public.product_categories,
  public.products,
  public.categories,
  public.admin_profiles
  cascade;

drop domain if exists public.slug, public.currency_code, public.money_minor, public.email_address cascade;

drop type if exists
  public.product_type, public.product_status, public.asset_kind, public.access_mode,
  public.order_status, public.payment_provider, public.event_status, public.fulfilment_status,
  public.email_status, public.admin_role
  cascade;

drop schema if exists private cascade;

-- Restore the default privileges the security migration narrowed.
alter default privileges in schema public grant truncate, references, trigger on tables to anon, authenticated;

delete from supabase_migrations.schema_migrations
where version in ('20261028210000', '20261028210100', '20261028210200', '20261028210300');

commit;
