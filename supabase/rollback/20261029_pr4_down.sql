-- Rollback for PR 4 (payment confirmation) in DISPOSABLE environments only
-- (local, empty staging). Production rolls forward (docs/database.md §6).
-- Restores the PR 3 order-status function and removes the ITN processing
-- functions. Stored payment events, fulfilments and emails are kept: they are
-- financial and audit records and are never deleted.
begin;
drop function if exists public.process_payfast_itn(text, text, text, bigint, text, boolean, jsonb, text);
drop function if exists private.confirm_payment(uuid, text);

create or replace function public.get_order_status(p_reference text, p_access_key_hash bytea)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('reference', o.reference, 'status', o.status, 'total_minor', o.total_minor, 'currency', o.currency)
  from public.orders o
  where o.reference = p_reference and o.access_key_hash = p_access_key_hash;
$$;

delete from supabase_migrations.schema_migrations where version = '20261029070000';
commit;
