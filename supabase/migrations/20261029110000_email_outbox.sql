-- PR 6: transactional email outbox worker support (ADR-0004; spec §4.1, §4.2, §7
-- "Mixed delivery" and "Email outage").
--
-- confirm_payment() already queues one 'order_paid' email per order in the same
-- transaction as the payment. These functions let the worker send it safely:
--   claim_due_emails   leases due rows with FOR UPDATE SKIP LOCKED, so workers
--                      that overlap never take the same email;
--   email_context      everything a template needs (order, items, deliveries);
--   complete_email     marks it sent and the delivered items delivered;
--   fail_email         schedules a retry with exponential backoff, or gives up
--                      after the maximum attempts and queues an admin alert.
-- grant_manual_access is how staff confirm hand-granted access (J5), which
-- queues the "your access is ready" email.

create function private.email_max_attempts()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10 $$;   -- backoff 1, 2, 4 … 256 min: about 8.5 hours of retries

-- Lease up to p_limit due emails (optionally only one order's, by id or
-- reference: the ITN sends a just-paid order's email straight away). The lease
-- (next_attempt_at pushed 5 minutes out) outlives any worker run; a crashed
-- worker's emails come back after it. attempts counts every send attempt.
create function public.claim_due_emails(p_limit integer, p_order_id uuid default null, p_reference text default null)
returns jsonb
language sql
set search_path = ''
as $$
  with due as (
    select id from public.email_events
     where status = 'queued' and next_attempt_at <= now()
       and (p_order_id is null or order_id = p_order_id)
       and (p_reference is null or order_id = (select o.id from public.orders o where o.reference = p_reference))
     order by next_attempt_at
     limit greatest(least(p_limit, 50), 0)
     for update skip locked
  ), claimed as (
    update public.email_events e
       set attempts = e.attempts + 1, next_attempt_at = now() + interval '5 minutes'
      from due where e.id = due.id
    returning e.id, e.template, e.to_email, e.order_id, e.dedupe_key, e.attempts
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by claimed.attempts), '[]'::jsonb) from claimed;
$$;

-- What the templates render. Text comes from the database snapshot (order
-- items) and the product assets; nothing here is trusted as HTML.
create function public.email_context(p_email_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'email', jsonb_build_object('id', e.id, 'template', e.template, 'to', e.to_email, 'dedupe_key', e.dedupe_key, 'attempts', e.attempts),
    'order', case when o.id is null then null else jsonb_build_object(
      'id', o.id, 'reference', o.reference, 'status', o.status, 'email', o.email, 'currency', o.currency,
      'subtotal_minor', o.subtotal_minor, 'discount_minor', o.discount_minor, 'total_minor', o.total_minor,
      'tax_minor', o.tax_minor, 'coupon_code', o.coupon_code, 'paid_at', o.paid_at, 'created_at', o.created_at,
      'provider_txn_id', o.provider_txn_id) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', oi.title, 'type', oi.product_type, 'quantity', oi.quantity, 'line_total_minor', oi.line_total_minor,
               'deliveries', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'fulfilment_id', f.id, 'kind', f.kind, 'status', f.status, 'label', a.label,
                          'external_url', a.external_url, 'instructions', a.instructions,
                          'access_mode', a.access_mode, 'manual_eta_text', a.manual_eta_text)
                        order by a.sort, a.label)
                   from public.fulfilments f join public.product_assets a on a.id = f.asset_id
                  where f.order_item_id = oi.id), '[]'::jsonb))
             order by oi.created_at, oi.title)
        from public.order_items oi where oi.order_id = o.id), '[]'::jsonb),
    -- admin_alert: the email that failed (dedupe_key = 'email_failed:<id>')
    'failed_email', (
      select jsonb_build_object('id', x.id, 'template', x.template, 'to', x.to_email, 'attempts', x.attempts, 'last_error', x.last_error)
        from public.email_events x
       where e.template = 'admin_alert' and e.dedupe_key = 'email_failed:' || x.id::text))
  from public.email_events e
  left join public.orders o on o.id = e.order_id
  where e.id = p_email_id;
$$;

create function public.complete_email(p_email_id uuid, p_provider_message_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare v_email public.email_events%rowtype;
begin
  update public.email_events
     set status = 'sent', sent_at = now(), provider_message_id = left(p_provider_message_id, 200), last_error = null
   where id = p_email_id and status = 'queued'
  returning * into v_email;
  if not found then
    return;  -- already completed by an earlier attempt: nothing to do
  end if;
  -- The delivery email carried the links: those items are now delivered.
  -- Manual access stays action_required until staff grant it.
  if v_email.template = 'order_paid' then
    update public.fulfilments f
       set status = 'delivered', delivered_at = now()
      from public.product_assets a
     where f.order_id = v_email.order_id and a.id = f.asset_id
       and f.status = 'queued' and a.access_mode = 'instant';
  end if;
end;
$$;

-- p_permanent: the provider rejected the message (it will never succeed).
-- p_retry_after_seconds: the provider's Retry-After, if it gave one.
create function public.fail_email(p_email_id uuid, p_error text, p_permanent boolean, p_alert_to text default null,
                                  p_retry_after_seconds integer default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_email public.email_events%rowtype;
  v_delay interval;
begin
  select * into v_email from public.email_events where id = p_email_id and status = 'queued' for update;
  if not found then
    return jsonb_build_object('outcome', 'not_queued');
  end if;

  if p_permanent or v_email.attempts >= private.email_max_attempts() then
    update public.email_events set status = 'failed', last_error = left(p_error, 1000) where id = p_email_id;
    -- Tell a person, once per failed email. An alert about an alert is not sent.
    if v_email.template <> 'admin_alert' and nullif(btrim(p_alert_to), '') is not null then
      insert into public.email_events (order_id, template, dedupe_key, to_email)
      values (v_email.order_id, 'admin_alert', 'email_failed:' || v_email.id::text, lower(btrim(p_alert_to)))
      on conflict on constraint email_events_once do nothing;
    end if;
    return jsonb_build_object('outcome', 'failed', 'attempts', v_email.attempts);
  end if;

  v_delay := greatest(make_interval(mins => least(power(2, greatest(v_email.attempts - 1, 0))::int, 360)),
                      make_interval(secs => coalesce(p_retry_after_seconds, 0)));
  update public.email_events
     set next_attempt_at = now() + v_delay, last_error = left(p_error, 1000)
   where id = p_email_id;
  return jsonb_build_object('outcome', 'retry', 'attempts', v_email.attempts, 'retry_in_seconds', extract(epoch from v_delay)::int);
end;
$$;

-- Staff have granted manual access (J5): mark it delivered and queue the email.
create function public.grant_manual_access(p_fulfilment_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_f public.fulfilments%rowtype;
  v_order public.orders%rowtype;
  v_label text;
begin
  select * into v_f from public.fulfilments where id = p_fulfilment_id for update;
  if not found then
    perform private.delivery_error('fulfilment_not_found');
  end if;
  select * into v_order from public.orders where id = v_f.order_id;
  if not private.order_grants_access(v_order.status) then
    perform private.delivery_error('order_not_paid');
  end if;
  select label into v_label from public.product_assets where id = v_f.asset_id;
  if v_f.status = 'delivered' then
    return jsonb_build_object('outcome', 'already_granted', 'reference', v_order.reference, 'label', v_label);
  end if;
  if v_f.status <> 'action_required' then
    perform private.delivery_error('not_awaiting_access');
  end if;

  update public.fulfilments set status = 'delivered', delivered_at = now(), status_reason = 'access granted by staff'
   where id = p_fulfilment_id;
  insert into public.email_events (order_id, template, dedupe_key, to_email)
  values (v_order.id, 'manual_access_ready', p_fulfilment_id::text, v_order.email)
  on conflict on constraint email_events_once do nothing;
  return jsonb_build_object('outcome', 'granted', 'reference', v_order.reference, 'label', v_label);
end;
$$;

revoke all on function private.email_max_attempts() from public;
revoke all on function public.claim_due_emails(integer, uuid, text) from public, anon, authenticated;
revoke all on function public.email_context(uuid) from public, anon, authenticated;
revoke all on function public.complete_email(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_email(uuid, text, boolean, text, integer) from public, anon, authenticated;
revoke all on function public.grant_manual_access(uuid) from public, anon, authenticated;
grant execute on function private.email_max_attempts() to service_role;
grant execute on function public.claim_due_emails(integer, uuid, text) to service_role;
grant execute on function public.email_context(uuid) to service_role;
grant execute on function public.complete_email(uuid, text) to service_role;
grant execute on function public.fail_email(uuid, text, boolean, text, integer) to service_role;
grant execute on function public.grant_manual_access(uuid) to service_role;
