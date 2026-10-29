-- Rollback for PR 6 (email outbox) in DISPOSABLE environments only
-- (local, empty staging). Production rolls forward (docs/database.md §6).
-- Removes the outbox functions; email_events rows (audit records) are kept.
begin;
drop function if exists public.grant_manual_access(uuid);
drop function if exists public.fail_email(uuid, text, boolean, text, integer);
drop function if exists public.complete_email(uuid, text);
drop function if exists public.email_context(uuid);
drop function if exists public.claim_due_emails(integer, uuid, text);
drop function if exists private.email_max_attempts();
delete from supabase_migrations.schema_migrations where version = '20261029110000';
commit;
