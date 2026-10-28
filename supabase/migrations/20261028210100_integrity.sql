-- PR 1 / migration 2: integrity triggers. These enforce rules that CHECK
-- constraints cannot express (cross-row/cross-table rules, state machines,
-- immutability). They apply to every role, including the service role.

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['categories', 'products', 'product_assets', 'coupons', 'orders',
                           'payment_events', 'fulfilments', 'delivery_tokens', 'email_events', 'admin_profiles']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
                   t || '_touch_updated_at', t);
  end loop;
end;
$$;

-- Reject a statement outright (used for append-only/financial tables).
create function private.forbid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% on %.% is not allowed (%)', tg_op, tg_table_schema, tg_table_name, tg_argv[0]
    using errcode = 'insufficient_privilege';
end;
$$;

-- ---------------------------------------------------------------------------
-- Bundles: a bundle contains only non-bundle products.
-- ---------------------------------------------------------------------------
create function private.check_bundle_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select type from public.products where id = new.bundle_id) <> 'bundle' then
    raise exception 'bundle_items.bundle_id must reference a product of type bundle' using errcode = 'check_violation';
  end if;
  if (select type from public.products where id = new.product_id) = 'bundle' then
    raise exception 'bundles cannot contain other bundles' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger bundle_items_check before insert or update on public.bundle_items
  for each row execute function private.check_bundle_item();

-- A product that is a bundle component cannot stop being a bundle while it has items.
create function private.check_product_type_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type <> old.type then
    if old.type = 'bundle' and exists (select 1 from public.bundle_items where bundle_id = old.id) then
      raise exception 'cannot change type of a bundle that has items' using errcode = 'check_violation';
    end if;
    if new.type = 'bundle' and exists (select 1 from public.bundle_items where product_id = old.id) then
      raise exception 'a product inside a bundle cannot become a bundle' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger products_type_change before update of type on public.products
  for each row execute function private.check_product_type_change();

-- ---------------------------------------------------------------------------
-- Orders: state machine + immutable financial fields + no deletes.
-- ---------------------------------------------------------------------------
create function private.check_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed public.order_status[];
begin
  if (new.reference, new.access_key_hash, new.email, new.currency, new.subtotal_minor, new.discount_minor,
      new.tax_minor, new.total_minor, new.coupon_id, new.coupon_code, new.provider, new.livemode,
      new.terms_accepted_at, new.created_at)
     is distinct from
     (old.reference, old.access_key_hash, old.email, old.currency, old.subtotal_minor, old.discount_minor,
      old.tax_minor, old.total_minor, old.coupon_id, old.coupon_code, old.provider, old.livemode,
      old.terms_accepted_at, old.created_at) then
    raise exception 'order % financial/identity fields are immutable', old.reference using errcode = 'insufficient_privilege';
  end if;

  if old.provider_txn_id is not null and new.provider_txn_id is distinct from old.provider_txn_id then
    raise exception 'order % provider_txn_id cannot change once set', old.reference using errcode = 'insufficient_privilege';
  end if;

  if new.refunded_minor < old.refunded_minor then
    raise exception 'order % refunded amount cannot decrease', old.reference using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    allowed := case old.status
      when 'pending'            then array['paid', 'failed', 'expired']::public.order_status[]
      when 'expired'            then array['paid']::public.order_status[]  -- late payment must still be honoured
      when 'failed'             then array[]::public.order_status[]
      when 'paid'               then array['refunded', 'partially_refunded', 'disputed']::public.order_status[]
      when 'partially_refunded' then array['refunded', 'disputed']::public.order_status[]
      when 'disputed'           then array['paid', 'refunded', 'partially_refunded']::public.order_status[]
      when 'refunded'           then array[]::public.order_status[]
    end;
    if not (new.status = any (allowed)) then
      raise exception 'order % cannot move from % to %', old.reference, old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger orders_check_update before update on public.orders
  for each row execute function private.check_order_update();
create trigger orders_no_delete before delete on public.orders
  for each row execute function private.forbid('financial record');

-- Order items: currency must match the order; rows are immutable.
create function private.check_order_item_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.currency <> (select currency from public.orders where id = new.order_id) then
    raise exception 'order item currency must match order currency' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger order_items_check_insert before insert on public.order_items
  for each row execute function private.check_order_item_insert();
create trigger order_items_immutable before update or delete on public.order_items
  for each row execute function private.forbid('financial record');

-- Payment events: the received payload and identity never change; never deleted.
create function private.check_payment_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.provider, new.provider_event_id, new.type, new.payload, new.received_at)
     is distinct from (old.provider, old.provider_event_id, old.type, old.payload, old.received_at) then
    raise exception 'payment event payload is immutable' using errcode = 'insufficient_privilege';
  end if;
  if old.order_id is not null and new.order_id is distinct from old.order_id then
    raise exception 'payment event order link cannot change' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger payment_events_check_update before update on public.payment_events
  for each row execute function private.check_payment_event_update();
create trigger payment_events_no_delete before delete on public.payment_events
  for each row execute function private.forbid('audit record');

-- ---------------------------------------------------------------------------
-- Fulfilments: the asset must belong to the purchased product (or to a
-- product inside a purchased bundle); kind is copied from the asset.
-- ---------------------------------------------------------------------------
create function private.check_fulfilment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item_product uuid;
  item_order uuid;
  asset_product uuid;
  asset_kind public.asset_kind;
begin
  select product_id, order_id into item_product, item_order from public.order_items where id = new.order_item_id;
  select product_id, kind into asset_product, asset_kind from public.product_assets where id = new.asset_id;

  if item_order is distinct from new.order_id then
    raise exception 'fulfilment order_id does not match its order item' using errcode = 'check_violation';
  end if;
  if asset_product <> item_product and not exists (
       select 1 from public.bundle_items where bundle_id = item_product and product_id = asset_product) then
    raise exception 'asset does not belong to the purchased product or bundle' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.order_id, new.order_item_id, new.asset_id) is distinct from (old.order_id, old.order_item_id, old.asset_id) then
    raise exception 'fulfilment target is immutable' using errcode = 'insufficient_privilege';
  end if;
  new.kind := asset_kind;
  return new;
end;
$$;
create trigger fulfilments_check before insert or update on public.fulfilments
  for each row execute function private.check_fulfilment();
create trigger fulfilments_no_delete before delete on public.fulfilments
  for each row execute function private.forbid('delivery record');

-- Delivery tokens only exist for file fulfilments; revocation is permanent.
create function private.check_delivery_token()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select kind from public.fulfilments where id = new.fulfilment_id) <> 'file' then
      raise exception 'delivery tokens are only issued for file fulfilments' using errcode = 'check_violation';
    end if;
  else
    if (new.fulfilment_id, new.token_hash, new.max_downloads, new.created_at)
       is distinct from (old.fulfilment_id, old.token_hash, old.max_downloads, old.created_at) then
      raise exception 'delivery token identity is immutable' using errcode = 'insufficient_privilege';
    end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'a revoked token cannot be reinstated; issue a new one' using errcode = 'check_violation';
    end if;
    if new.download_count < old.download_count then
      raise exception 'download count cannot decrease' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger delivery_tokens_check before insert or update on public.delivery_tokens
  for each row execute function private.check_delivery_token();
create trigger delivery_tokens_no_delete before delete on public.delivery_tokens
  for each row execute function private.forbid('delivery record');
