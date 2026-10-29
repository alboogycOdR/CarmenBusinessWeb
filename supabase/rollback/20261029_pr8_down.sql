-- Rollback for PR 8 (admin audit) in DISPOSABLE environments only.
-- Production rolls forward (docs/database.md §6). Audit rows are never deleted;
-- if ACTION rows exist, the original constraint cannot be restored: keep it.
begin;
drop function if exists public.record_admin_action(uuid, text, text, text, text, jsonb);
do $$
begin
  if not exists (select 1 from public.audit_log where action = 'ACTION') then
    alter table public.audit_log drop constraint audit_log_action_check;
    alter table public.audit_log add constraint audit_log_action_check check (action in ('INSERT', 'UPDATE', 'DELETE'));
  end if;
end;
$$;
delete from supabase_migrations.schema_migrations where version = '20261029130000';
commit;
