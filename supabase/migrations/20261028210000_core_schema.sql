-- PR 1 / migration 1: core schema (types, tables, constraints, indexes).
-- Money is stored as bigint minor units with an explicit ISO-4217 currency
-- (spec §5). Business invariants live in CHECK and UNIQUE constraints so the
-- database stays correct even if application code is wrong.

-- ---------------------------------------------------------------------------
-- Private schema: helper functions that must never be exposed by the API.
-- (PostgREST only exposes the schemas listed in config.toml [api].schemas.)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.product_type     as enum ('course', 'book', 'guide', 'template', 'bundle');
create type public.product_status   as enum ('draft', 'published', 'archived');
create type public.asset_kind       as enum ('file', 'external');
create type public.access_mode      as enum ('instant', 'manual');
create type public.order_status     as enum ('pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded', 'disputed');
create type public.payment_provider as enum ('paystack', 'stripe');
create type public.event_status     as enum ('received', 'processed', 'ignored', 'failed');
create type public.fulfilment_status as enum ('queued', 'delivered', 'action_required', 'revoked', 'failed');
create type public.email_status     as enum ('queued', 'sent', 'failed');
create type public.admin_role       as enum ('owner', 'admin', 'support');

-- Reusable domains keep the same rule identical everywhere it applies.
create domain public.slug as text
  check (value ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(value) <= 80);
create domain public.currency_code as char(3)
  check (value ~ '^[A-Z]{3}$');
create domain public.money_minor as bigint
  check (value >= 0 and value <= 100000000000);  -- up to 1e9 major units
create domain public.email_address as text
  check (value = lower(value) and length(value) <= 254 and value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  slug       public.slug not null unique,
  name       text not null check (length(btrim(name)) between 1 and 80),
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  slug             public.slug not null unique,
  type             public.product_type not null,
  status           public.product_status not null default 'draft',
  title            text not null check (length(btrim(title)) between 1 and 200),
  subtitle         text check (length(subtitle) <= 200),
  summary          text not null default '' check (length(summary) <= 500),
  description      text[] not null default '{}',
  included         text[] not null default '{}',
  info             jsonb not null default '{}' check (jsonb_typeof(info) = 'object'),
  images           jsonb not null default '[]' check (jsonb_typeof(images) = 'array'),
  display          jsonb not null default '{}' check (jsonb_typeof(display) = 'object'), -- badge, cover colours
  price_minor      public.money_minor not null,
  compare_at_minor public.money_minor,
  currency         public.currency_code not null,
  allow_quantity   boolean not null default false,  -- ADR-0008: licences default to quantity 1
  sort             integer not null default 0,
  published_at     timestamptz,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint products_compare_at_gt_price check (compare_at_minor is null or compare_at_minor > price_minor),
  constraint products_published_complete check (
    status <> 'published' or (published_at is not null and length(btrim(summary)) > 0)
  ),
  constraint products_archived_stamp check ((status = 'archived') = (archived_at is not null))
);
create index products_status_sort_idx on public.products (status, sort);

create table public.product_categories (
  product_id  uuid not null references public.products (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (product_id, category_id)
);
create index product_categories_category_idx on public.product_categories (category_id);

create table public.bundle_items (
  bundle_id  uuid not null references public.products (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  primary key (bundle_id, product_id),
  constraint bundle_items_not_self check (bundle_id <> product_id)
);
create index bundle_items_product_idx on public.bundle_items (product_id);

-- Delivery data is private: no anonymous access (enforced in the security migration).
create table public.product_assets (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products (id) on delete cascade,
  kind            public.asset_kind not null,
  label           text not null check (length(btrim(label)) between 1 and 200),
  storage_path    text check (storage_path ~ '^[A-Za-z0-9._/-]+$' and storage_path !~ '\.\.'),
  external_url    text check (external_url ~ '^https://[^\s]+$'),
  instructions    text check (length(instructions) <= 4000),
  access_mode     public.access_mode not null default 'instant',
  manual_eta_text text check (length(manual_eta_text) <= 200),
  sort            integer not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint product_assets_file_shape check (
    kind <> 'file' or (storage_path is not null and external_url is null and access_mode = 'instant')
  ),
  constraint product_assets_external_shape check (
    kind <> 'external' or (external_url is not null and storage_path is null)
  ),
  constraint product_assets_manual_eta check (access_mode <> 'manual' or manual_eta_text is not null)
);
create index product_assets_product_idx on public.product_assets (product_id);

create table public.coupons (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  percent_off      integer check (percent_off between 1 and 100),
  amount_off_minor public.money_minor check (amount_off_minor > 0),
  currency         public.currency_code,
  starts_at        timestamptz,
  ends_at          timestamptz,
  max_redemptions  integer check (max_redemptions > 0),
  per_email_limit  integer check (per_email_limit > 0),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint coupons_one_discount check ((percent_off is null) <> (amount_off_minor is null)),
  constraint coupons_amount_has_currency check ((amount_off_minor is null) = (currency is null)),
  constraint coupons_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

-- ---------------------------------------------------------------------------
-- Orders and payments
-- ---------------------------------------------------------------------------
-- Human-friendly, unguessable order reference, e.g. CBW-7K2M9QX4TB.
-- Crockford base32 (no I, L, O, U) avoids ambiguous characters in support calls.
create function private.new_order_reference()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(10);
  out text := 'CBW-';
begin
  for i in 0..9 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return out;
end;
$$;

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default private.new_order_reference()
                      check (reference ~ '^CBW-[0-9A-HJKMNP-TV-Z]{10}$'),
  access_key_hash   bytea not null check (octet_length(access_key_hash) = 32), -- SHA-256 of the buyer's status-page key
  email             public.email_address not null,
  status            public.order_status not null default 'pending',
  currency          public.currency_code not null,
  subtotal_minor    public.money_minor not null,
  discount_minor    public.money_minor not null default 0,
  tax_minor         public.money_minor not null default 0,  -- tax included in total (decision D3)
  total_minor       public.money_minor not null,
  coupon_id         uuid references public.coupons (id) on delete restrict,
  coupon_code       text,
  provider          public.payment_provider not null,
  provider_txn_id   text check (length(provider_txn_id) between 1 and 200),
  livemode          boolean not null default false,
  marketing_opt_in  boolean not null default false,  -- spec §4.3: no opt-in by default
  terms_accepted_at timestamptz not null,
  expires_at        timestamptz not null default now() + interval '2 hours',
  paid_at           timestamptz,
  refunded_minor    public.money_minor not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint orders_discount_le_subtotal check (discount_minor <= subtotal_minor),
  constraint orders_total_math check (total_minor = subtotal_minor - discount_minor),
  constraint orders_tax_le_total check (tax_minor <= total_minor),
  constraint orders_refund_le_total check (refunded_minor <= total_minor),
  constraint orders_coupon_snapshot check ((coupon_id is null) = (coupon_code is null)),
  constraint orders_paid_has_proof check (
    status in ('pending', 'failed', 'expired') or (paid_at is not null and provider_txn_id is not null)
  ),
  constraint orders_provider_txn_unique unique (provider, provider_txn_id)
);
create index orders_email_idx on public.orders (email);
create index orders_status_created_idx on public.orders (status, created_at desc);
create index orders_coupon_idx on public.orders (coupon_id) where coupon_id is not null;

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete restrict,
  product_id       uuid not null references public.products (id) on delete restrict,
  title            text not null,                 -- snapshot at purchase time
  product_type     public.product_type not null,  -- snapshot
  unit_price_minor public.money_minor not null,   -- snapshot, server-calculated
  quantity         integer not null default 1 check (quantity between 1 and 99),
  line_total_minor public.money_minor not null,
  currency         public.currency_code not null,
  created_at       timestamptz not null default now(),
  constraint order_items_line_math check (line_total_minor = unit_price_minor * quantity),
  constraint order_items_one_line_per_product unique (order_id, product_id)
);
create index order_items_product_idx on public.order_items (product_id);

create table public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          public.payment_provider not null,
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  type              text not null,
  order_id          uuid references public.orders (id) on delete restrict,
  payload           jsonb not null,
  status            public.event_status not null default 'received',
  error             text,
  attempts          integer not null default 0 check (attempts >= 0),
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  updated_at        timestamptz not null default now(),
  -- Spec §4.2/§5: provider event IDs deduplicate webhook deliveries.
  constraint payment_events_dedupe unique (provider, provider_event_id)
);
create index payment_events_order_idx on public.payment_events (order_id);
create index payment_events_failed_idx on public.payment_events (received_at) where status in ('received', 'failed');

-- ---------------------------------------------------------------------------
-- Fulfilment and delivery
-- ---------------------------------------------------------------------------
create table public.fulfilments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete restrict,
  order_item_id   uuid not null references public.order_items (id) on delete restrict,
  asset_id        uuid not null references public.product_assets (id) on delete restrict,
  kind            public.asset_kind not null,  -- copied from the asset by trigger
  status          public.fulfilment_status not null default 'queued',
  status_reason   text,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Spec §7 "Webhook replay": one fulfilment per item and asset, however often confirmed.
  constraint fulfilments_once unique (order_item_id, asset_id)
);
create index fulfilments_order_idx on public.fulfilments (order_id);
create index fulfilments_asset_idx on public.fulfilments (asset_id);
create index fulfilments_attention_idx on public.fulfilments (created_at) where status in ('action_required', 'failed');

create table public.delivery_tokens (
  id             uuid primary key default gen_random_uuid(),
  fulfilment_id  uuid not null references public.fulfilments (id) on delete restrict,
  token_hash     bytea not null unique check (octet_length(token_hash) = 32), -- SHA-256; raw token never stored (ADR-0005)
  expires_at     timestamptz not null,
  max_downloads  integer not null check (max_downloads between 1 and 1000),
  download_count integer not null default 0,
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint delivery_tokens_count_range check (download_count between 0 and max_downloads),
  constraint delivery_tokens_revoke_reason check ((revoked_at is null) = (revoked_reason is null))
);
create index delivery_tokens_fulfilment_idx on public.delivery_tokens (fulfilment_id);

-- Transactional email outbox (ADR-0004).
create table public.email_events (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid references public.orders (id) on delete restrict,
  template            text not null check (template in ('order_paid', 'delivery', 'manual_access_pending', 'manual_access_ready', 'refund', 'support', 'admin_alert')),
  dedupe_key          text not null default '',
  to_email            public.email_address not null,
  status              public.email_status not null default 'queued',
  attempts            integer not null default 0 check (attempts >= 0),
  next_attempt_at     timestamptz not null default now(),
  provider_message_id text,
  last_error          text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint email_events_once unique nulls not distinct (order_id, template, dedupe_key),
  constraint email_events_sent_stamp check ((status = 'sent') = (sent_at is not null))
);
create index email_events_due_idx on public.email_events (next_attempt_at) where status = 'queued';

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
-- No sign-up route grants a role: rows are created only by an owner-run script
-- using the service role (spec §4.3).
create table public.admin_profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         public.admin_role not null,
  display_name text check (length(display_name) <= 120),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index admin_profiles_created_by_idx on public.admin_profiles (created_by);

comment on table public.product_assets is 'Private delivery data (files, external links, instructions). Never exposed to anon.';
comment on table public.orders is 'Financial record. Never hard-deleted; amounts immutable after insert.';
comment on table public.admin_profiles is 'Staff roles. Granted only by an owner via service-role script; no self-service.';
