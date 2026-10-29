-- Admin access and audit (PR 8, spec §7 "Admin access", §6 audit).
begin;
\ir _helpers.psql
select no_plan();

select tests.make_user('owner@example.com', 'owner', '10000000-0000-4000-8000-0000000000a1');
select tests.make_user('support@example.com', 'support', '10000000-0000-4000-8000-0000000000a2');
select tests.make_user('nobody@example.com', null, '10000000-0000-4000-8000-0000000000a3');

-- ---------- record_admin_action ------------------------------------------
select tests.act_as('service_role');
select ok(public.record_admin_action('10000000-0000-4000-8000-0000000000a1', 'admin:owner', 'sign_in', 'admin_session', 'sess-1', '{"email": "owner@example.com"}') > 0,
  'the server records an admin action');
select tests.as_postgres();
select is((select actor::text || ' ' || actor_role || ' ' || action || ' ' || entity || ' ' || entity_id || ' ' || (after ->> 'action')
             from public.audit_log where entity_id = 'sess-1'),
  '10000000-0000-4000-8000-0000000000a1 admin:owner ACTION admin_session sess-1 sign_in', 'with the actor, role and details');
select tests.act_as('service_role');
select lives_ok($$ select public.record_admin_action(null, 'script', 'grant_admin', 'admin_profiles', 'x') $$, 'owner scripts are recorded with actor null');
select throws_ok($$ select public.record_admin_action(null, 'admin:superuser', 'sign_in', 'admin_session', 'x') $$, '23514', null, 'unknown roles are refused');
select throws_ok($$ select public.record_admin_action(null, 'script', 'Drop Table', 'admin_session', 'x') $$, '23514', null, 'action names are validated');
select throws_ok($$ insert into public.audit_log (actor_role, action, entity) values ('service_role', 'ACTION', 'forged') $$, '42501', null,
  'the service role still cannot write the audit log directly');

-- ---------- audit log is append-only (also for ACTION rows) --------------
select tests.as_postgres();
select throws_ok($$ update public.audit_log set entity_id = 'tampered' where entity_id = 'sess-1' $$, '42501', null, 'admin actions cannot be edited');
select throws_ok($$ delete from public.audit_log where entity_id = 'sess-1' $$, '42501', null, 'or deleted');

-- ---------- who can call it ----------------------------------------------
select tests.act_as('anon');
select throws_ok($$ select public.record_admin_action(null, 'script', 'sign_in', 'admin_session', 'x') $$, '42501', null, 'anon cannot write audit entries');
select tests.act_as('authenticated', '10000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok($$ select public.record_admin_action(null, 'script', 'sign_in', 'admin_session', 'x') $$, '42501', null,
  'not even the owner can call it directly (only the server, after verifying the session)');

-- ---------- reading the audit log ----------------------------------------
select tests.act_as('authenticated', '10000000-0000-4000-8000-0000000000a1', 'aal2');
select ok(tests.count_rows('audit_log') >= 1, 'owner at aal2 reads the audit log');
select tests.act_as('authenticated', '10000000-0000-4000-8000-0000000000a1', 'aal1');
select is(tests.count_rows('audit_log'), 0::bigint, 'owner without MFA (aal1) reads nothing');
select tests.act_as('authenticated', '10000000-0000-4000-8000-0000000000a2', 'aal2');
select is(tests.count_rows('audit_log'), 0::bigint, 'support reads no audit log');
select tests.act_as('authenticated', '10000000-0000-4000-8000-0000000000a3', 'aal2');
select is(tests.count_rows('audit_log'), 0::bigint, 'a non-staff account reads nothing even at aal2');

-- ---------- no route to self-assign a role --------------------------------
select tests.act_as('authenticated', '10000000-0000-4000-8000-0000000000a3', 'aal2');
select throws_ok($$ insert into public.admin_profiles (user_id, role) values ('10000000-0000-4000-8000-0000000000a3', 'owner') $$, '42501', null,
  'a signed-in user cannot grant themselves a role');
select tests.act_as('authenticated', '10000000-0000-4000-8000-0000000000a2', 'aal2');
select throws_ok($$ update public.admin_profiles set role = 'owner' where user_id = '10000000-0000-4000-8000-0000000000a2' $$, '42501', null,
  'support cannot promote themselves');
select tests.act_as('authenticated', '10000000-0000-4000-8000-0000000000a1', 'aal2');
select throws_ok($$ insert into public.admin_profiles (user_id, role) values ('10000000-0000-4000-8000-0000000000a3', 'admin') $$, '42501', null,
  'even the owner grants roles only through the owner-run script (service role)');
select is((select count(*)::int from public.admin_profiles where user_id = '10000000-0000-4000-8000-0000000000a3'), 0, 'no profile was created');

-- ---------- grants are audited automatically ------------------------------
select tests.as_postgres();
insert into public.admin_profiles (user_id, role) values ('10000000-0000-4000-8000-0000000000a3', 'admin');
select is((select action || ' ' || (after ->> 'role') from public.audit_log
             where entity = 'admin_profiles' and entity_id = '10000000-0000-4000-8000-0000000000a3' order by id desc limit 1),
  'INSERT admin', 'granting a role writes an audit entry');
delete from public.admin_profiles where user_id = '10000000-0000-4000-8000-0000000000a3';
select is((select action from public.audit_log where entity = 'admin_profiles' and entity_id = '10000000-0000-4000-8000-0000000000a3' order by id desc limit 1),
  'DELETE', 'and so does revoking it');

select * from finish();
rollback;
