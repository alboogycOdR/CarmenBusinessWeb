-- PR 4: Payfast ITN processing and idempotent payment confirmation (spec §4.1, §4.2, §7).
--
-- The Netlify function runs Payfast's transport checks (signature, source IP,
-- merchant, server validation) and then calls process_payfast_itn() exactly
-- once per delivery. Everything that touches money or access happens here, in
-- one transaction (ADR-0003):
--
--   * the event is stored, deduplicated on (provider, provider_event_id) where
--     provider_event_id = '<pf_payment_id>:<payment_status>';
--   * a delivery of an already processed/ignored event is a no-op ("duplicate");
--   * a delivery of a FAILED event is processed again, which is what makes
--     Payfast's own retries and the replay tool recover from transient faults;
--   * the amount and live/sandbox mode are checked against the order;
--   * confirm_payment() moves the order to paid and creates its fulfilments
--     and outbox row exactly once.
--
-- Unauthenticated deliveries (bad signature) are stored under 'rejected:<uuid>'
-- and never linked to an order, so a forged ITN cannot claim a real event key
-- and block the genuine notification.

-- ---------------------------------------------------------------------------
-- confirm_payment: pending/expired -> paid, fulfilments, outbox. Idempotent.
-- ---------------------------------------------------------------------------
create function private.confirm_payment(p_order_id uuid, p_txn_id text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_fulfilments integer;
  v_unfulfilled jsonb;
begin
  if p_txn_id is null or length(p_txn_id) = 0 then
    raise exception 'confirm_payment: transaction id is required' using errcode = 'check_violation';
  end if;

  -- Row lock: concurrent confirmations of one order are serialised.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'confirm_payment: order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.provider_txn_id = p_txn_id then
    -- Same transaction confirmed again (replay or retry): nothing more to do.
    return jsonb_build_object('outcome', 'already_paid', 'reference', v_order.reference);
  end if;
  if v_order.status not in ('pending', 'expired') then
    -- Paid by a different transaction (double payment) or not payable: needs a person.
    return jsonb_build_object('outcome', case when v_order.status = 'failed' then 'order_not_payable' else 'paid_by_other_transaction' end,
                              'reference', v_order.reference, 'status', v_order.status);
  end if;

  -- expired -> paid is allowed by the state machine: a late payment is honoured.
  update public.orders set status = 'paid', paid_at = now(), provider_txn_id = p_txn_id where id = p_order_id;

  -- One fulfilment per purchased item and active asset; a bundle delivers the
  -- assets of its component products. Manual access is flagged for staff.
  insert into public.fulfilments (order_id, order_item_id, asset_id, kind, status, status_reason)
  select oi.order_id, oi.id, a.id, a.kind,
         case when a.access_mode = 'manual' then 'action_required'::public.fulfilment_status else 'queued'::public.fulfilment_status end,
         case when a.access_mode = 'manual' then 'manual access promised ' || a.manual_eta_text end
    from public.order_items oi
    join public.product_assets a
      on a.active
     and (a.product_id = oi.product_id
          or a.product_id in (select bi.product_id from public.bundle_items bi where bi.bundle_id = oi.product_id))
   where oi.order_id = p_order_id
   order by oi.created_at, a.sort
  on conflict on constraint fulfilments_once do nothing;
  get diagnostics v_fulfilments = row_count;

  -- Items with nothing to deliver must be visible to staff, never silent.
  select coalesce(jsonb_agg(oi.title order by oi.created_at), '[]'::jsonb) into v_unfulfilled
    from public.order_items oi
   where oi.order_id = p_order_id
     and not exists (select 1 from public.fulfilments f where f.order_item_id = oi.id);

  -- Delivery email, sent by the outbox worker (ADR-0004, PR 6). Once per order.
  insert into public.email_events (order_id, template, to_email)
  values (p_order_id, 'order_paid', v_order.email)
  on conflict on constraint email_events_once do nothing;

  return jsonb_build_object('outcome', 'paid', 'reference', v_order.reference,
                            'fulfilments', v_fulfilments, 'unfulfilled_items', v_unfulfilled);
end;
$$;

-- ---------------------------------------------------------------------------
-- process_payfast_itn: store + dedupe + order checks + confirm, one transaction.
-- ---------------------------------------------------------------------------
create function public.process_payfast_itn(
  p_event_key      text,     -- '<pf_payment_id>:<payment_status>', or 'rejected:<uuid>'
  p_payment_status text,     -- COMPLETE, CANCELLED, ...
  p_reference      text,     -- m_payment_id (our order reference)
  p_amount_minor   bigint,   -- amount_gross in cents; null if it could not be parsed
  p_txn_id         text,     -- pf_payment_id
  p_livemode       boolean,  -- the deployment's mode (PAYFAST_MODE = live)
  p_payload        jsonb,    -- the delivery as received (ordered fields, source IP)
  p_check_error    text      -- first failed transport check, or null when they all passed
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_event public.payment_events%rowtype;
  v_order public.orders%rowtype;
  v_has_order boolean;
  v_rejected boolean := p_event_key like 'rejected:%';
  v_error text;
  v_confirm jsonb;
begin
  if p_event_key is null or p_event_key !~ '^([0-9]{1,20}:[A-Z_]{1,20}|rejected:[0-9a-f-]{36})$' then
    raise exception 'process_payfast_itn: invalid event key' using errcode = 'check_violation';
  end if;
  if v_rejected and p_check_error is null then
    raise exception 'process_payfast_itn: a rejected delivery must carry its error' using errcode = 'check_violation';
  end if;

  insert into public.payment_events (provider, provider_event_id, type, payload)
  values ('payfast', p_event_key, 'itn:' || coalesce(nullif(p_payment_status, ''), 'unknown'), p_payload)
  on conflict on constraint payment_events_dedupe do nothing;

  -- Lock the event: concurrent deliveries of one event are serialised here.
  select * into v_event from public.payment_events
   where provider = 'payfast' and provider_event_id = p_event_key
   for update;

  if v_event.status in ('processed', 'ignored') then
    return jsonb_build_object('outcome', 'duplicate', 'event_id', v_event.id, 'status', v_event.status);
  end if;

  select * into v_order from public.orders where reference = p_reference;
  v_has_order := found;

  -- Decide. The first problem wins; anything but success leaves the event
  -- 'failed' with its reason, available to Payfast's retries and the replay tool.
  if p_check_error is not null then
    v_error := p_check_error;
  elsif not v_has_order then
    v_error := 'unknown_order';
  elsif v_order.livemode is distinct from p_livemode then
    v_error := 'mode_mismatch';      -- a sandbox ITN never pays a live order, and vice versa
  elsif upper(coalesce(p_payment_status, '')) <> 'COMPLETE' then
    update public.payment_events
       set status = 'ignored', error = null, attempts = attempts + 1, processed_at = now(),
           order_id = coalesce(order_id, v_order.id)
     where id = v_event.id;
    return jsonb_build_object('outcome', 'ignored', 'event_id', v_event.id, 'reference', v_order.reference);
  elsif p_amount_minor is distinct from v_order.total_minor then
    v_error := 'amount_mismatch';    -- exact cents, never "within R0.01"
  else
    v_confirm := private.confirm_payment(v_order.id, p_txn_id);
    if v_confirm ->> 'outcome' in ('paid', 'already_paid') then
      update public.payment_events
         set status = 'processed', error = null, attempts = attempts + 1, processed_at = now(),
             order_id = coalesce(order_id, v_order.id)
       where id = v_event.id;
      return v_confirm || jsonb_build_object('event_id', v_event.id);
    end if;
    v_error := v_confirm ->> 'outcome';
  end if;

  update public.payment_events
     set status = 'failed', error = v_error, attempts = attempts + 1,
         -- a forged delivery is never linked to a real order
         order_id = case when v_rejected or not v_has_order then order_id else coalesce(order_id, v_order.id) end
   where id = v_event.id;
  return jsonb_build_object('outcome', 'failed', 'error', v_error, 'event_id', v_event.id,
                            'reference', case when v_has_order and not v_rejected then v_order.reference end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Order status for the buyer's success page: now with items and what is coming.
-- Same signature and grants as PR 3; reference AND key hash are still required.
-- ---------------------------------------------------------------------------
create or replace function public.get_order_status(p_reference text, p_access_key_hash bytea)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'reference', o.reference, 'status', o.status, 'total_minor', o.total_minor, 'currency', o.currency,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', oi.title,
               'type', oi.product_type,
               'downloads', (select count(*) from public.fulfilments f where f.order_item_id = oi.id and f.kind = 'file'),
               'links', (select count(*) from public.fulfilments f join public.product_assets a on a.id = f.asset_id
                          where f.order_item_id = oi.id and f.kind = 'external' and a.access_mode = 'instant'),
               'manual', (select count(*) from public.fulfilments f join public.product_assets a on a.id = f.asset_id
                           where f.order_item_id = oi.id and a.access_mode = 'manual'))
             order by oi.created_at, oi.title)
        from public.order_items oi where oi.order_id = o.id), '[]'::jsonb))
  from public.orders o
  where o.reference = p_reference and o.access_key_hash = p_access_key_hash;
$$;

revoke all on function private.confirm_payment(uuid, text) from public;
grant execute on function private.confirm_payment(uuid, text) to service_role;
revoke all on function public.process_payfast_itn(text, text, text, bigint, text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.process_payfast_itn(text, text, text, bigint, text, boolean, jsonb, text) to service_role;
