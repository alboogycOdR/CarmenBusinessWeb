-- PR 3 / migration 2: ZAR-only store (ADR-0009) and server-side checkout.
--
-- create_pending_order() is the ONLY way an order comes into existence. It
-- prices the cart from published products, validates the coupon under a row
-- lock, enforces Payfast's R5.00 minimum (D14) and inserts the pending order and
-- its items, all in one transaction (ADR-0003). The browser's own idea of the
-- price is used only to detect a stale page (price_changed), never to charge.
--
-- These functions live in `public` so the server can call them through
-- PostgREST, but EXECUTE is granted to service_role only: anon and
-- authenticated cannot call them (tested in 01_schema_security).

-- ---------------------------------------------------------------------------
-- ZAR only (D2). No real data exists yet; seed data is ZAR from this PR on.
-- ---------------------------------------------------------------------------
alter table public.products    add constraint products_currency_zar    check (currency = 'ZAR');
alter table public.orders      add constraint orders_currency_zar      check (currency = 'ZAR');
alter table public.order_items add constraint order_items_currency_zar check (currency = 'ZAR');
alter table public.coupons     add constraint coupons_currency_zar     check (currency is null or currency = 'ZAR');

-- Payfast refuses transactions under R5.00 (D14).
create function public.payfast_minimum_minor()
returns bigint
language sql
immutable
set search_path = ''
as $$ select 500::bigint $$;

-- Raise a checkout error the server maps to an HTTP response.
-- message = 'checkout:<code>', detail = JSON with context.
create function private.checkout_error(p_code text, p_detail jsonb default '{}')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'checkout:' || p_code, detail = p_detail::text;
end;
$$;

create function public.create_pending_order(
  p_items jsonb,               -- [{"id": "<slug>", "qty": 1}, ...]
  p_email text,
  p_coupon_code text,          -- null or '' for none
  p_marketing_opt_in boolean,
  p_terms_accepted boolean,
  p_access_key_hash bytea,     -- SHA-256 of the buyer's status-page key
  p_expected_total bigint,     -- what the page showed; only for detecting stale prices
  p_livemode boolean
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text := upper(btrim(coalesce(p_coupon_code, '')));
  v_item jsonb;
  v_slug text;
  v_qty integer;
  v_seen text[] := '{}'::text[];
  v_product public.products%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_discount bigint := 0;
  v_total bigint;
  v_coupon public.coupons%rowtype;
  v_used integer;
  v_order public.orders%rowtype;
  v_line jsonb;
begin
  -- ---- shape --------------------------------------------------------------
  if p_terms_accepted is distinct from true then
    perform private.checkout_error('terms_required');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    perform private.checkout_error('invalid_email');
  end if;
  if p_access_key_hash is null or octet_length(p_access_key_hash) <> 32 then
    perform private.checkout_error('invalid_request');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    perform private.checkout_error('empty_cart');
  end if;
  if jsonb_array_length(p_items) > 30 then
    perform private.checkout_error('too_many_items');
  end if;

  -- ---- price every line from the database ---------------------------------
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_slug := v_item ->> 'id';
    if jsonb_typeof(v_item -> 'qty') is distinct from 'number' or (v_item ->> 'qty') !~ '^[0-9]{1,2}$' then
      perform private.checkout_error('invalid_quantity', jsonb_build_object('id', v_slug));
    end if;
    v_qty := (v_item ->> 'qty')::integer;
    if v_slug is null or v_slug = any (v_seen) then
      perform private.checkout_error('invalid_cart');
    end if;
    v_seen := v_seen || v_slug;

    select * into v_product from public.products where slug = v_slug and status = 'published';
    if not found then
      perform private.checkout_error('unknown_product', jsonb_build_object('id', v_slug));
    end if;
    -- ADR-0008: one licence unless the product allows quantity.
    if v_qty < 1 or v_qty > (case when v_product.allow_quantity then 99 else 1 end) then
      perform private.checkout_error('invalid_quantity', jsonb_build_object('id', v_slug));
    end if;

    v_subtotal := v_subtotal + v_product.price_minor * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id, 'title', v_product.title, 'type', v_product.type,
      'unit', v_product.price_minor, 'qty', v_qty, 'currency', v_product.currency);
  end loop;

  -- ---- coupon (locked: concurrent checkouts cannot over-redeem) ------------
  if v_code <> '' then
    select * into v_coupon from public.coupons where code = v_code for update;
    if not found or not v_coupon.active
       or (v_coupon.starts_at is not null and v_coupon.starts_at > now())
       or (v_coupon.ends_at is not null and v_coupon.ends_at <= now()) then
      perform private.checkout_error('coupon_invalid');
    end if;
    -- A redemption is any order that holds the coupon: paid (incl. later refunded
    -- or disputed) or still pending and not expired.
    if v_coupon.max_redemptions is not null then
      select count(*) into v_used from public.orders o
       where o.coupon_id = v_coupon.id
         and (o.status in ('paid', 'refunded', 'partially_refunded', 'disputed')
              or (o.status = 'pending' and o.expires_at > now()));
      if v_used >= v_coupon.max_redemptions then
        perform private.checkout_error('coupon_exhausted');
      end if;
    end if;
    if v_coupon.per_email_limit is not null then
      select count(*) into v_used from public.orders o
       where o.coupon_id = v_coupon.id and o.email = v_email
         and (o.status in ('paid', 'refunded', 'partially_refunded', 'disputed')
              or (o.status = 'pending' and o.expires_at > now()));
      if v_used >= v_coupon.per_email_limit then
        perform private.checkout_error('coupon_already_used');
      end if;
    end if;
    if v_coupon.percent_off is not null then
      v_discount := (v_subtotal * v_coupon.percent_off + 50) / 100;  -- round half up, as the cart preview does
    else
      v_discount := least(v_coupon.amount_off_minor, v_subtotal);
    end if;
  end if;

  v_total := v_subtotal - v_discount;
  if v_total < public.payfast_minimum_minor() then
    perform private.checkout_error('below_minimum', jsonb_build_object('minimum_minor', public.payfast_minimum_minor(), 'total_minor', v_total));
  end if;
  if p_expected_total is not null and p_expected_total <> v_total then
    perform private.checkout_error('price_changed', jsonb_build_object('total_minor', v_total));
  end if;

  -- ---- persist (pending) --------------------------------------------------
  insert into public.orders (email, access_key_hash, currency, subtotal_minor, discount_minor, total_minor,
                             coupon_id, coupon_code, provider, livemode, marketing_opt_in, terms_accepted_at)
  values (v_email, p_access_key_hash, 'ZAR', v_subtotal, v_discount, v_total,
          case when v_code <> '' then v_coupon.id end, nullif(v_code, ''), 'payfast',
          coalesce(p_livemode, false), coalesce(p_marketing_opt_in, false), now())
  returning * into v_order;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    insert into public.order_items (order_id, product_id, title, product_type, unit_price_minor, quantity, line_total_minor, currency)
    values (v_order.id, (v_line ->> 'product_id')::uuid, v_line ->> 'title', (v_line ->> 'type')::public.product_type,
            (v_line ->> 'unit')::bigint, (v_line ->> 'qty')::integer,
            (v_line ->> 'unit')::bigint * (v_line ->> 'qty')::integer, v_line ->> 'currency');
  end loop;

  return jsonb_build_object(
    'order_id', v_order.id,
    'reference', v_order.reference,
    'currency', v_order.currency,
    'subtotal_minor', v_order.subtotal_minor,
    'discount_minor', v_order.discount_minor,
    'total_minor', v_order.total_minor,
    'titles', (select jsonb_agg(l ->> 'title') from jsonb_array_elements(v_lines) l)
  );
end;
$$;

-- Buyer-facing status lookup: needs the reference AND the private access key
-- hash; anything else looks identical to "not found" (no oracle).
create function public.get_order_status(p_reference text, p_access_key_hash bytea)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('reference', o.reference, 'status', o.status, 'total_minor', o.total_minor, 'currency', o.currency)
  from public.orders o
  where o.reference = p_reference and o.access_key_hash = p_access_key_hash;
$$;

-- Abandoned checkouts never produce an ITN: expire them (scheduled function).
create function public.expire_stale_orders()
returns integer
language plpgsql
set search_path = ''
as $$
declare n integer;
begin
  update public.orders set status = 'expired' where status = 'pending' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Server-only RPC surface. Supabase's default privileges grant EXECUTE on new
-- public functions to anon/authenticated, so revoke explicitly.
revoke all on function public.payfast_minimum_minor() from public, anon, authenticated;
revoke all on function public.create_pending_order(jsonb, text, text, boolean, boolean, bytea, bigint, boolean) from public, anon, authenticated;
revoke all on function public.get_order_status(text, bytea) from public, anon, authenticated;
revoke all on function public.expire_stale_orders() from public, anon, authenticated;
revoke all on function private.checkout_error(text, jsonb) from public;
grant execute on function public.payfast_minimum_minor() to service_role;
grant execute on function public.create_pending_order(jsonb, text, text, boolean, boolean, bytea, bigint, boolean) to service_role;
grant execute on function public.get_order_status(text, bytea) to service_role;
grant execute on function public.expire_stale_orders() to service_role;
grant execute on function private.checkout_error(text, jsonb) to service_role;

-- Fix (latent since PR 1): orders.reference defaults to private.new_order_reference(),
-- and column defaults run with the INSERTING role's privileges. The security
-- migration revoked EXECUTE on private functions from everyone, so the service
-- role (the only role allowed to create orders) could not insert one.
-- Regression test: 02_rls_matrix "service role: can create an order".
grant execute on function private.new_order_reference() to service_role;
