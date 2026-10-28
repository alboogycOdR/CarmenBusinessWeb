-- PR 1 / migration 4: append-only audit log (spec §6 "audit sensitive actions").
-- Every change to catalogue, staff and order-state tables is recorded with the
-- acting user (auth.uid()) or 'system' for server functions.

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,           -- auth.uid(); null for service role / maintenance
  actor_role text not null,  -- JWT role or database role
  action     text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor, at desc);

alter table public.audit_log enable row level security;

create policy audit_log_staff_read on public.audit_log
  for select to authenticated
  using ((select private.is_staff(array['owner', 'admin']::public.admin_role[])));

-- Only the trigger below writes, as the table owner. No API role may write.
revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate, references, trigger on public.audit_log from authenticated, service_role;

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.forbid('append-only audit log');
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.forbid('append-only audit log');

create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  row_id  text;
begin
  if tg_op = 'UPDATE' and old_row = new_row then
    return new;  -- no-op update: nothing to record
  end if;
  row_id := coalesce(new_row, old_row) ->> 'id';
  if row_id is null then
    -- composite keys (join tables) and admin_profiles
    row_id := coalesce(
      (coalesce(new_row, old_row) ->> 'user_id'),
      concat_ws(':', coalesce(new_row, old_row) ->> 'product_id', coalesce(new_row, old_row) ->> 'category_id',
                     coalesce(new_row, old_row) ->> 'bundle_id'));
  end if;

  insert into public.audit_log (actor, actor_role, action, entity, entity_id, before, after)
  values ((select auth.uid()),
          coalesce((select auth.jwt() ->> 'role'), session_user::text),
          tg_op, tg_table_name, row_id, old_row, new_row);
  return coalesce(new, old);
end;
$$;
revoke all on function private.audit_row() from public;

do $$
declare t text;
begin
  foreach t in array array['categories', 'products', 'product_categories', 'bundle_items', 'product_assets',
                           'coupons', 'orders', 'fulfilments', 'delivery_tokens', 'admin_profiles']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()',
                   t || '_audit', t);
  end loop;
end;
$$;
