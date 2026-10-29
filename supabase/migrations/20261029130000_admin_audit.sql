-- PR 8: admin actions in the append-only audit log (spec §4.3, §6).
--
-- Row changes are already audited by triggers (PR 1). Admin actions that are
-- not a row change (signing in, issuing links, granting access by script) are
-- recorded here as action = 'ACTION' with the actor and the details. Only the
-- server writes them, after it has verified the staff member's session.

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('INSERT', 'UPDATE', 'DELETE', 'ACTION'));

-- SECURITY DEFINER: audit_log is writable only by its owner (PR 1 revoked
-- INSERT from every API role). EXECUTE is granted to the service role alone.
create function public.record_admin_action(
  p_actor     uuid,   -- the verified staff user, or null for owner-run scripts
  p_role      text,   -- 'admin:<role>' or 'script'
  p_action    text,   -- e.g. 'sign_in', 'grant_admin', 'revoke_admin'
  p_entity    text,
  p_entity_id text,
  p_detail    jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if p_action !~ '^[a-z][a-z_]{1,40}$' or p_entity !~ '^[a-z][a-z_]{1,40}$' then
    raise exception 'record_admin_action: invalid action or entity' using errcode = 'check_violation';
  end if;
  if p_role !~ '^(admin:(owner|admin|support)|script)$' then
    raise exception 'record_admin_action: invalid role' using errcode = 'check_violation';
  end if;
  insert into public.audit_log (actor, actor_role, action, entity, entity_id, before, after)
  values (p_actor, p_role, 'ACTION', p_entity, left(p_entity_id, 200),
          null, jsonb_build_object('action', p_action) || coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_admin_action(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_admin_action(uuid, text, text, text, text, jsonb) to service_role;
