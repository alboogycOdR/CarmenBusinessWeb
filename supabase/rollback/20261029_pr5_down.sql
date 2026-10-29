-- Rollback for PR 5 (secure downloads) in DISPOSABLE environments only
-- (local, empty staging). Production rolls forward (docs/database.md §6).
-- Removes the download functions. Delivery tokens (financial/audit records)
-- and the bucket are kept: remove stored files in the Storage UI if needed.
begin;
drop function if exists public.consume_download(bytea);
drop function if exists public.download_token_status(bytea);
drop function if exists public.issue_delivery_tokens(uuid, boolean);
drop function if exists public.download_policy();
drop function if exists private.delivery_error(text);
drop function if exists private.order_grants_access(public.order_status);
delete from supabase_migrations.schema_migrations where version = '20261029090000';
commit;
