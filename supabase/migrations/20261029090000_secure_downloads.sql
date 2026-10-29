-- PR 5: private file storage and download tokens (spec §4.2, §7 "Download security", ADR-0005).
--
-- Files live in the PRIVATE bucket `product-files`. Nothing can read it except
-- the service role: there are no storage policies for it, so anon and signed-in
-- users are denied by storage's own RLS. Buyers get a file only through
-- /api/download, which exchanges a valid delivery token for a 60-second signed URL.
--
-- Tokens: 32 random bytes from pgcrypto, handed to the caller ONCE as base64url
-- and stored only as their SHA-256 (delivery_tokens.token_hash). Decision D5
-- (owner, 29 Oct 2026): a link works for 7 days and 5 downloads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-files', 'product-files', false, null,
        array['application/pdf', 'application/epub+zip', 'application/zip', 'audio/mpeg', 'audio/mp4', 'video/mp4',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'image/png', 'image/jpeg'])
on conflict (id) do update set public = false;

-- D5 in one place.
create function public.download_policy()
returns jsonb
language sql
immutable
set search_path = ''
as $$ select jsonb_build_object('valid_days', 7, 'max_downloads', 5) $$;

-- Raise a delivery error the server maps to a response ('delivery:<code>').
create function private.delivery_error(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'delivery:' || p_code;
end;
$$;

-- Orders whose files may be downloaded. Disputed and refunded orders may not;
-- PR 7 revokes the tokens of items refunded from a partially refunded order.
create function private.order_grants_access(p_status public.order_status)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_status in ('paid', 'partially_refunded') $$;

-- ---------------------------------------------------------------------------
-- issue_delivery_tokens: one new token per file fulfilment of a paid order.
-- Returns the raw tokens; they are never stored and cannot be recovered.
-- p_replace revokes the order's earlier, still-active tokens ("send new links").
-- ---------------------------------------------------------------------------
create function public.issue_delivery_tokens(p_order_id uuid, p_replace boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_policy jsonb := public.download_policy();
  v_f record;
  v_raw bytea;
  v_expires timestamptz := now() + make_interval(days => (public.download_policy() ->> 'valid_days')::int);
  v_out jsonb := '[]'::jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    perform private.delivery_error('order_not_found');
  end if;
  if not private.order_grants_access(v_order.status) then
    perform private.delivery_error('order_not_paid');
  end if;

  for v_f in
    select f.id, a.label, a.storage_path
      from public.fulfilments f
      join public.product_assets a on a.id = f.asset_id
      join public.order_items oi on oi.id = f.order_item_id
     where f.order_id = p_order_id and f.kind = 'file' and f.status not in ('revoked', 'failed')
     order by oi.created_at, a.sort, a.label
  loop
    if p_replace then
      update public.delivery_tokens
         set revoked_at = now(), revoked_reason = 'replaced by a new link'
       where fulfilment_id = v_f.id and revoked_at is null;
    end if;
    v_raw := extensions.gen_random_bytes(32);
    insert into public.delivery_tokens (fulfilment_id, token_hash, expires_at, max_downloads)
    values (v_f.id, extensions.digest(v_raw, 'sha256'), v_expires, (v_policy ->> 'max_downloads')::int);
    v_out := v_out || jsonb_build_object(
      'fulfilment_id', v_f.id,
      'label', v_f.label,
      'filename', regexp_replace(v_f.storage_path, '^.*/', ''),
      -- base64url without padding: what goes in the link
      'token', translate(encode(v_raw, 'base64'), '+/=', '-_'),
      'expires_at', v_expires,
      'max_downloads', (v_policy ->> 'max_downloads')::int);
  end loop;

  return jsonb_build_object('reference', v_order.reference, 'email', v_order.email, 'links', v_out);
end;
$$;

-- ---------------------------------------------------------------------------
-- download_token_status: what a token allows right now (no side effects).
-- state: ok | unknown | unpaid | revoked | expired | used_up
-- ---------------------------------------------------------------------------
create function public.download_token_status(p_token_hash bytea)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'state', case
        when not private.order_grants_access(o.status) then 'unpaid'
        when t.revoked_at is not null or f.status = 'revoked' then 'revoked'
        when t.expires_at <= now() then 'expired'
        when t.download_count >= t.max_downloads then 'used_up'
        else 'ok' end,
      'label', a.label,
      'filename', regexp_replace(a.storage_path, '^.*/', ''),
      'storage_path', a.storage_path,
      'remaining', greatest(t.max_downloads - t.download_count, 0),
      'max_downloads', t.max_downloads,
      'expires_at', t.expires_at,
      'reference', o.reference)
      from public.delivery_tokens t
      join public.fulfilments f on f.id = t.fulfilment_id
      join public.orders o on o.id = f.order_id
      join public.product_assets a on a.id = f.asset_id
     where t.token_hash = p_token_hash
  ), jsonb_build_object('state', 'unknown'));
$$;

-- ---------------------------------------------------------------------------
-- consume_download: count one download, atomically. The WHERE clause is
-- re-checked under the row lock, so concurrent requests can never exceed
-- max_downloads (and the CHECK constraint backs it up).
-- ---------------------------------------------------------------------------
create function public.consume_download(p_token_hash bytea)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  update public.delivery_tokens t
     set download_count = t.download_count + 1, last_used_at = now()
    from public.fulfilments f, public.orders o
   where t.token_hash = p_token_hash
     and f.id = t.fulfilment_id and o.id = f.order_id
     and private.order_grants_access(o.status)
     and f.status <> 'revoked'
     and t.revoked_at is null
     and t.expires_at > now()
     and t.download_count < t.max_downloads
  returning t.max_downloads - t.download_count into v_remaining;

  if v_remaining is null then
    return public.download_token_status(p_token_hash);  -- tells the caller why not
  end if;
  return public.download_token_status(p_token_hash) || jsonb_build_object('state', 'ok', 'consumed', true, 'remaining', v_remaining);
end;
$$;

revoke all on function public.download_policy() from public, anon, authenticated;
revoke all on function public.issue_delivery_tokens(uuid, boolean) from public, anon, authenticated;
revoke all on function public.download_token_status(bytea) from public, anon, authenticated;
revoke all on function public.consume_download(bytea) from public, anon, authenticated;
revoke all on function private.delivery_error(text) from public;
revoke all on function private.order_grants_access(public.order_status) from public;
grant execute on function public.download_policy() to service_role;
grant execute on function public.issue_delivery_tokens(uuid, boolean) to service_role;
grant execute on function public.download_token_status(bytea) to service_role;
grant execute on function public.consume_download(bytea) to service_role;
grant execute on function private.delivery_error(text) to service_role;
grant execute on function private.order_grants_access(public.order_status) to service_role;
