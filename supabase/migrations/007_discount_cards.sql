-- Discount cards and customer rewards. Additive only: no existing table or row is dropped.
--
-- How it fits the existing store:
--   * A "completed order" is an order whose status is 'delivered' (cash on delivery, so
--     delivered means received and paid).
--   * The store has no reviews/feedback system, so feedback is an admin-set standing per
--     customer (positive / neutral / negative) in reward_customers. Negative always blocks
--     automatic cards; the "positive feedback required" switch makes positive mandatory.
--   * There is one card type. Every card gives the discount percentage set by the admin.
--   * Cards are a discount, not a payment method: the rest is still paid cash on delivery.
--   * All card writes go through security definer functions below; customers can only read.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.reward_settings (
  id boolean primary key default true check (id),
  discount_percent numeric(5,2) not null default 10 check (discount_percent > 0 and discount_percent <= 100),
  auto_issue boolean not null default true,
  require_positive_feedback boolean not null default false,
  allow_multiple_cards boolean not null default true,
  max_cards_per_order integer check (max_cards_per_order is null or max_cards_per_order >= 1),
  max_discount_cents integer check (max_discount_cents is null or max_discount_cents >= 0),
  expiry_days integer check (expiry_days is null or expiry_days between 1 and 3650),
  updated_at timestamptz not null default now()
);
insert into public.reward_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.reward_milestones (
  id uuid primary key default gen_random_uuid(),
  orders_required integer not null unique check (orders_required between 1 and 100000),
  cards_awarded integer not null default 1 check (cards_awarded between 1 and 50),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Starting schedule (the admin can edit or delete every row in Admin > Discount cards).
insert into public.reward_milestones (orders_required, cards_awarded)
select v.o, v.c from (values (2, 1), (5, 1), (9, 1), (15, 1)) as v(o, c)
where not exists (select 1 from public.reward_milestones)
on conflict (orders_required) do nothing;

create table if not exists public.reward_customers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  feedback text not null default 'neutral' check (feedback in ('positive', 'neutral', 'negative')),
  note text check (note is null or char_length(note) <= 500),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.discount_cards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('milestone', 'gift')),
  milestone_id uuid references public.reward_milestones(id) on delete set null,
  milestone_orders integer,
  -- One card per milestone slot, ever: 'm:<milestone id>:<n>'. Null for gifts.
  issue_key text,
  status text not null default 'available' check (status in ('available', 'used', 'revoked')),
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  used_at timestamptz,
  used_order_id uuid references public.orders(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 500),
  unique (user_id, issue_key)
);
create index if not exists discount_cards_user_idx on public.discount_cards(user_id, status);
create index if not exists discount_cards_order_idx on public.discount_cards(used_order_id);

create table if not exists public.card_redemptions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.discount_cards(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  discount_percent numeric(5,2) not null,
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  restored_at timestamptz
);
-- A card can be attached to at most one live (not restored) redemption.
create unique index if not exists card_redemptions_live_key on public.card_redemptions(card_id) where restored_at is null;
create index if not exists card_redemptions_order_idx on public.card_redemptions(order_id);

create table if not exists public.card_gifts (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null unique references public.discount_cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  admin_id uuid references public.profiles(id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists public.card_events (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.discount_cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (event in ('issued', 'gifted', 'used', 'restored', 'revoked')),
  order_id uuid references public.orders(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists card_events_card_idx on public.card_events(card_id);
create index if not exists card_events_user_idx on public.card_events(user_id, created_at desc);

alter table public.orders add column if not exists discount_cents integer not null default 0 check (discount_cents >= 0);

drop trigger if exists reward_settings_touch on public.reward_settings;
create trigger reward_settings_touch before update on public.reward_settings
  for each row execute function public.touch_updated_at();
drop trigger if exists reward_milestones_touch on public.reward_milestones;
create trigger reward_milestones_touch before update on public.reward_milestones
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: customers read their own; only admins change settings.
-- ---------------------------------------------------------------------------
alter table public.reward_settings enable row level security;
alter table public.reward_milestones enable row level security;
alter table public.reward_customers enable row level security;
alter table public.discount_cards enable row level security;
alter table public.card_redemptions enable row level security;
alter table public.card_gifts enable row level security;
alter table public.card_events enable row level security;

drop policy if exists "Reward settings: public read" on public.reward_settings;
create policy "Reward settings: public read" on public.reward_settings for select to anon, authenticated using (true);
drop policy if exists "Reward settings: admin update" on public.reward_settings;
create policy "Reward settings: admin update" on public.reward_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Milestones: public read active" on public.reward_milestones;
create policy "Milestones: public read active" on public.reward_milestones for select to anon, authenticated
  using (active or (select public.is_admin()));
drop policy if exists "Milestones: admin insert" on public.reward_milestones;
create policy "Milestones: admin insert" on public.reward_milestones for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Milestones: admin update" on public.reward_milestones;
create policy "Milestones: admin update" on public.reward_milestones for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Milestones: admin delete" on public.reward_milestones;
create policy "Milestones: admin delete" on public.reward_milestones for delete to authenticated using ((select public.is_admin()));

drop policy if exists "Reward customers: admin read" on public.reward_customers;
create policy "Reward customers: admin read" on public.reward_customers for select to authenticated using ((select public.is_admin()));

drop policy if exists "Cards: read own or admin" on public.discount_cards;
create policy "Cards: read own or admin" on public.discount_cards for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));
drop policy if exists "Redemptions: read own or admin" on public.card_redemptions;
create policy "Redemptions: read own or admin" on public.card_redemptions for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));
drop policy if exists "Gifts: admin read" on public.card_gifts;
create policy "Gifts: admin read" on public.card_gifts for select to authenticated using ((select public.is_admin()));
drop policy if exists "Card events: read own or admin" on public.card_events;
create policy "Card events: read own or admin" on public.card_events for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()));

revoke all on public.reward_settings, public.reward_milestones, public.reward_customers, public.discount_cards,
  public.card_redemptions, public.card_gifts, public.card_events from anon, authenticated;
grant select on public.reward_settings, public.reward_milestones to anon, authenticated;
grant update (discount_percent, auto_issue, require_positive_feedback, allow_multiple_cards, max_cards_per_order, max_discount_cents, expiry_days)
  on public.reward_settings to authenticated;
grant insert (orders_required, cards_awarded, active), update (orders_required, cards_awarded, active), delete
  on public.reward_milestones to authenticated;
grant select on public.reward_customers, public.discount_cards, public.card_redemptions, public.card_gifts, public.card_events to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Status as customers see it: an available card past its expiry date shows as expired.
-- PostgREST exposes this as a computed column: select=*,effective_status
create or replace function public.effective_status(c public.discount_cards)
returns text
language sql
stable
set search_path = ''
as $$
  select case when c.status = 'available' and c.expires_at is not null and c.expires_at <= now() then 'expired' else c.status end;
$$;

create or replace function public.completed_orders(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.orders where user_id = p_user and status = 'delivered';
$$;

-- 'eligible', 'negative_feedback' or 'needs_approval' (positive feedback required but not given).
create or replace function public.reward_eligibility(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(rc.feedback, 'neutral') = 'negative' then 'negative_feedback'
    when s.require_positive_feedback and coalesce(rc.feedback, 'neutral') <> 'positive' then 'needs_approval'
    else 'eligible' end
  from public.reward_settings s
  left join public.reward_customers rc on rc.user_id = p_user
  where s.id;
$$;

-- Issue one card. Returns the new card, or an empty row when issue_key was already used.
create or replace function public.issue_card(p_user uuid, p_source text, p_milestone uuid, p_milestone_orders integer,
                                             p_key text, p_actor uuid, p_note text)
returns public.discount_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_days integer;
  c public.discount_cards;
begin
  select expiry_days into v_days from public.reward_settings where id;
  loop
    v_code := 'BLD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-'
                     || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    exit when not exists (select 1 from public.discount_cards where code = v_code);
  end loop;

  insert into public.discount_cards (code, user_id, source, milestone_id, milestone_orders, issue_key, issued_by, expires_at)
  values (v_code, p_user, p_source, p_milestone, p_milestone_orders, p_key, p_actor,
          case when v_days is null then null else now() + make_interval(days => v_days) end)
  on conflict (user_id, issue_key) do nothing
  returning * into c;

  if c.id is not null then
    insert into public.card_events (card_id, user_id, event, actor_id, note)
    values (c.id, p_user, case when p_source = 'gift' then 'gifted' else 'issued' end, p_actor,
            coalesce(p_note, case when p_milestone_orders is not null then 'Reached ' || p_milestone_orders || ' completed orders' end));
  end if;
  return c;
end;
$$;

-- Give a customer every milestone card they have earned and not yet received.
-- Safe to run any number of times: the (user_id, issue_key) unique key means a slot is
-- only ever filled once, and an advisory lock serialises runs for the same customer.
create or replace function public.issue_milestone_cards(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auto boolean;
  v_done integer;
  v_issued integer := 0;
  m record;
  i integer;
  c public.discount_cards;
begin
  if p_user is null then return 0; end if;
  select auto_issue into v_auto from public.reward_settings where id;
  if not coalesce(v_auto, false) then return 0; end if;
  if public.reward_eligibility(p_user) <> 'eligible' then return 0; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return 0; end if;

  perform pg_advisory_xact_lock(hashtextextended('blendy-rewards:' || p_user::text, 0));
  v_done := public.completed_orders(p_user);

  for m in select * from public.reward_milestones where active and orders_required <= v_done order by orders_required loop
    for i in 1..m.cards_awarded loop
      c := public.issue_card(p_user, 'milestone', m.id, m.orders_required, 'm:' || m.id || ':' || i, null, null);
      if c.id is not null then v_issued := v_issued + 1; end if;
    end loop;
  end loop;
  return v_issued;
end;
$$;

-- Work out the discount for a set of cards on a subtotal. Raises a friendly error when a
-- card can't be used. With p_lock the cards are locked until the transaction ends, so two
-- checkouts cannot redeem the same card.
create or replace function public.compute_card_discount(p_user uuid, p_card_ids uuid[], p_subtotal integer, p_lock boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reward_settings;
  v_n integer := coalesce(cardinality(p_card_ids), 0);
  v_ok integer;
  v_per integer;
  v_cap integer;
  v_total integer := 0;
  v_amt integer;
  v_cards jsonb := '[]'::jsonb;
  c record;
begin
  if v_n = 0 then
    return jsonb_build_object('total_cents', 0, 'percent', 0, 'cards', '[]'::jsonb);
  end if;
  if (select count(distinct x) from unnest(p_card_ids) x) <> v_n or array_position(p_card_ids, null) is not null then
    raise exception 'Each card can only be selected once';
  end if;
  select * into s from public.reward_settings where id;
  if v_n > 1 and not s.allow_multiple_cards then
    raise exception 'Only one discount card can be used per order';
  end if;
  if s.max_cards_per_order is not null and v_n > s.max_cards_per_order then
    raise exception 'You can use up to % discount cards per order', s.max_cards_per_order;
  end if;

  if p_lock then
    perform 1 from public.discount_cards where id = any(p_card_ids) order by id for update;
  end if;

  select count(*) into v_ok from public.discount_cards
  where id = any(p_card_ids) and user_id = p_user and status = 'available'
    and (expires_at is null or expires_at > now());
  if v_ok <> v_n then
    raise exception 'One of the selected discount cards is not available any more. Please refresh and try again.';
  end if;

  v_per := round(p_subtotal * s.discount_percent / 100.0)::integer;
  v_cap := least(p_subtotal, coalesce(s.max_discount_cents, p_subtotal));
  for c in select id, code from public.discount_cards where id = any(p_card_ids) order by issued_at, id loop
    v_amt := least(v_per, v_cap - v_total);
    if v_amt <= 0 then
      raise exception 'The maximum discount for this order is reached with fewer cards. Please remove a card.';
    end if;
    v_total := v_total + v_amt;
    v_cards := v_cards || jsonb_build_object('id', c.id, 'code', c.code, 'amount_cents', v_amt);
  end loop;

  return jsonb_build_object('total_cents', v_total, 'percent', s.discount_percent, 'cards', v_cards,
                            'capped', v_total < v_per * v_n);
end;
$$;

-- Mark the cards in a discount plan as used on an order (call inside the checkout transaction).
create or replace function public.redeem_cards(p_user uuid, p_order uuid, p_plan jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_rows integer;
begin
  select array_agg((e->>'id')::uuid) into v_ids from jsonb_array_elements(p_plan->'cards') e;
  if v_ids is null then return; end if;

  update public.discount_cards set status = 'used', used_at = now(), used_order_id = p_order
  where id = any(v_ids) and user_id = p_user and status = 'available';
  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_ids) then
    raise exception 'One of the selected discount cards is not available any more. Please refresh and try again.';
  end if;

  insert into public.card_redemptions (card_id, order_id, user_id, discount_percent, amount_cents)
  select (e->>'id')::uuid, p_order, p_user, (p_plan->>'percent')::numeric, (e->>'amount_cents')::integer
  from jsonb_array_elements(p_plan->'cards') e;

  insert into public.card_events (card_id, user_id, event, order_id, actor_id)
  select unnest(v_ids), p_user, 'used', p_order, p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checkout: same as before, plus optional discount cards. The old one-argument calls
-- still work because p_card_ids defaults to no cards.
-- ---------------------------------------------------------------------------
drop function if exists public.place_order(jsonb);
create or replace function public.place_order(p_shipping jsonb, p_card_ids uuid[] default '{}')
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_email text;
  v_subtotal integer;
  v_shipping integer;
  v_settings public.store_settings;
  v_short text;
  v_plan jsonb;
  v_discount integer;
  new_order public.orders;
  v_name text := btrim(coalesce(p_shipping->>'name', ''));
  v_phone text := btrim(coalesce(p_shipping->>'phone', ''));
  v_address text := btrim(coalesce(p_shipping->>'address', ''));
  v_city text := btrim(coalesce(p_shipping->>'city', ''));
  v_postal text := btrim(coalesce(p_shipping->>'postal_code', ''));
  v_country text := btrim(coalesce(p_shipping->>'country', ''));
  v_notes text := nullif(btrim(coalesce(p_shipping->>'notes', '')), '');
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if v_name = '' or v_phone = '' or v_address = '' or v_city = '' or v_country = '' then
    raise exception 'Please fill in your name, phone, address, city and country';
  end if;
  if char_length(v_name) > 120 or char_length(v_phone) > 40 or char_length(v_address) > 300
     or char_length(v_city) > 120 or char_length(v_postal) > 20 or char_length(v_country) > 80
     or char_length(coalesce(v_notes, '')) > 1000 then
    raise exception 'One of the shipping fields is too long';
  end if;

  -- Lock the products in this cart so two checkouts cannot oversell.
  perform 1 from public.products p
    join public.cart_items c on c.product_id = p.id
    where c.user_id = uid
    for update of p;

  select string_agg(p.name, ', ') into v_short
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.user_id = uid and (not p.active or p.stock < c.quantity);
  if v_short is not null then
    raise exception 'Not enough stock for: %', v_short;
  end if;

  select coalesce(sum(c.quantity * p.price_cents), 0) into v_subtotal
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.user_id = uid;
  if v_subtotal = 0 then
    raise exception 'Your cart is empty';
  end if;

  select * into v_settings from public.store_settings where id;
  v_shipping := coalesce(v_settings.shipping_fee_cents, 0);
  if v_settings.free_shipping_threshold_cents is not null and v_subtotal >= v_settings.free_shipping_threshold_cents then
    v_shipping := 0;
  end if;

  v_plan := public.compute_card_discount(uid, p_card_ids, v_subtotal, true);
  v_discount := (v_plan->>'total_cents')::integer;

  select email into v_email from auth.users where id = uid;

  insert into public.orders (
    user_id, email, total_cents, subtotal_cents, shipping_cents, discount_cents, currency,
    shipping_name, shipping_phone, shipping_address, shipping_city, shipping_postal_code, shipping_country, notes
  ) values (
    uid, v_email, v_subtotal + v_shipping - v_discount, v_subtotal, v_shipping, v_discount, coalesce(v_settings.currency, 'USD'),
    v_name, v_phone, v_address, v_city, nullif(v_postal, ''), v_country, v_notes
  ) returning * into new_order;

  insert into public.order_items (order_id, product_id, product_name, unit_price_cents, quantity)
  select new_order.id, p.id, p.name, p.price_cents, c.quantity
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.user_id = uid;

  if v_discount > 0 then
    perform public.redeem_cards(uid, new_order.id, v_plan);
  end if;

  update public.products p set stock = p.stock - c.quantity
  from public.cart_items c
  where c.user_id = uid and c.product_id = p.id;

  delete from public.cart_items where user_id = uid;
  return new_order;
end;
$$;

drop function if exists public.buy_now(uuid, integer, jsonb);
create or replace function public.buy_now(p_product_id uuid, p_quantity integer, p_shipping jsonb, p_card_ids uuid[] default '{}')
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_product public.products;
  v_email text;
  v_subtotal integer;
  v_shipping integer;
  v_settings public.store_settings;
  v_plan jsonb;
  v_discount integer;
  new_order public.orders;
  v_name text := btrim(coalesce(p_shipping->>'name', ''));
  v_phone text := btrim(coalesce(p_shipping->>'phone', ''));
  v_address text := btrim(coalesce(p_shipping->>'address', ''));
  v_city text := btrim(coalesce(p_shipping->>'city', ''));
  v_postal text := btrim(coalesce(p_shipping->>'postal_code', ''));
  v_country text := btrim(coalesce(p_shipping->>'country', ''));
  v_notes text := nullif(btrim(coalesce(p_shipping->>'notes', '')), '');
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'Invalid quantity';
  end if;
  if v_name = '' or v_phone = '' or v_address = '' or v_city = '' or v_country = '' then
    raise exception 'Please fill in your name, phone, address, city and country';
  end if;
  if char_length(v_name) > 120 or char_length(v_phone) > 40 or char_length(v_address) > 300
     or char_length(v_city) > 120 or char_length(v_postal) > 20 or char_length(v_country) > 80
     or char_length(coalesce(v_notes, '')) > 1000 then
    raise exception 'One of the shipping fields is too long';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if v_product.id is null or not v_product.active then
    raise exception 'This product is not available';
  end if;
  if v_product.stock < p_quantity then
    raise exception 'Only % left in stock', v_product.stock;
  end if;

  v_subtotal := v_product.price_cents * p_quantity;
  select * into v_settings from public.store_settings where id;
  v_shipping := coalesce(v_settings.shipping_fee_cents, 0);
  if v_settings.free_shipping_threshold_cents is not null and v_subtotal >= v_settings.free_shipping_threshold_cents then
    v_shipping := 0;
  end if;

  v_plan := public.compute_card_discount(uid, p_card_ids, v_subtotal, true);
  v_discount := (v_plan->>'total_cents')::integer;

  select email into v_email from auth.users where id = uid;

  insert into public.orders (
    user_id, email, total_cents, subtotal_cents, shipping_cents, discount_cents, currency,
    shipping_name, shipping_phone, shipping_address, shipping_city, shipping_postal_code, shipping_country, notes
  ) values (
    uid, v_email, v_subtotal + v_shipping - v_discount, v_subtotal, v_shipping, v_discount, coalesce(v_settings.currency, 'USD'),
    v_name, v_phone, v_address, v_city, nullif(v_postal, ''), v_country, v_notes
  ) returning * into new_order;

  insert into public.order_items (order_id, product_id, product_name, unit_price_cents, quantity)
  values (new_order.id, v_product.id, v_product.name, v_product.price_cents, p_quantity);

  if v_discount > 0 then
    perform public.redeem_cards(uid, new_order.id, v_plan);
  end if;

  update public.products set stock = stock - p_quantity where id = v_product.id;
  return new_order;
end;
$$;

-- Checkout preview: the discount the server would give right now for these cards, priced
-- from the database (the cart, or one Buy Now product). Nothing is locked or changed.
create or replace function public.preview_card_discount(p_card_ids uuid[], p_buy_product uuid default null, p_buy_qty integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_subtotal integer;
  v_shipping integer;
  v_settings public.store_settings;
  v_plan jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if p_buy_product is not null then
    select price_cents * least(99, greatest(1, coalesce(p_buy_qty, 1))) into v_subtotal
    from public.products where id = p_buy_product and active;
  else
    select sum(c.quantity * p.price_cents) into v_subtotal
    from public.cart_items c join public.products p on p.id = c.product_id
    where c.user_id = uid;
  end if;
  v_subtotal := coalesce(v_subtotal, 0);
  select * into v_settings from public.store_settings where id;
  v_shipping := case when v_subtotal = 0 then 0 else coalesce(v_settings.shipping_fee_cents, 0) end;
  if v_settings.free_shipping_threshold_cents is not null and v_subtotal >= v_settings.free_shipping_threshold_cents then
    v_shipping := 0;
  end if;
  v_plan := public.compute_card_discount(uid, p_card_ids, v_subtotal, false);
  return v_plan || jsonb_build_object('subtotal_cents', v_subtotal, 'shipping_cents', v_shipping,
    'payable_cents', v_subtotal + v_shipping - (v_plan->>'total_cents')::integer);
end;
$$;

-- ---------------------------------------------------------------------------
-- Order status changes: delivered -> check milestones; cancelled -> give cards back.
-- ---------------------------------------------------------------------------
create or replace function public.orders_reward_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    perform public.issue_milestone_cards(new.user_id);
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.card_events (card_id, user_id, event, order_id, actor_id, note)
    select d.id, d.user_id, 'restored', new.id, auth.uid(), 'Order #' || new.order_number || ' was cancelled'
    from public.discount_cards d
    join public.card_redemptions r on r.card_id = d.id and r.order_id = new.id and r.restored_at is null
    where d.status = 'used' and d.used_order_id = new.id;

    update public.discount_cards d set status = 'available', used_at = null, used_order_id = null
    from public.card_redemptions r
    where r.order_id = new.id and r.restored_at is null and r.card_id = d.id
      and d.status = 'used' and d.used_order_id = new.id;

    update public.card_redemptions set restored_at = now() where order_id = new.id and restored_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_reward_status on public.orders;
create trigger orders_reward_status after update of status on public.orders
  for each row execute function public.orders_reward_status();

-- ---------------------------------------------------------------------------
-- Customer: my cards, progress and history in one call.
-- ---------------------------------------------------------------------------
create or replace function public.my_rewards()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.reward_settings;
  v_done integer;
  v_elig text;
  v_next record;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into s from public.reward_settings where id;
  v_done := public.completed_orders(uid);
  v_elig := public.reward_eligibility(uid);
  select orders_required, cards_awarded into v_next from public.reward_milestones
  where active and orders_required > v_done order by orders_required limit 1;

  return jsonb_build_object(
    'completed_orders', v_done,
    'eligibility', case v_elig when 'negative_feedback' then 'paused' when 'needs_approval' then 'pending_approval' else 'eligible' end,
    'auto_issue', s.auto_issue,
    'discount_percent', s.discount_percent,
    'allow_multiple_cards', s.allow_multiple_cards,
    'max_cards_per_order', s.max_cards_per_order,
    'max_discount_cents', s.max_discount_cents,
    'expiry_days', s.expiry_days,
    'next', case when v_next.orders_required is null then null else jsonb_build_object(
      'orders_required', v_next.orders_required, 'cards_awarded', v_next.cards_awarded,
      'remaining', v_next.orders_required - v_done) end,
    'milestones', (select coalesce(jsonb_agg(jsonb_build_object('orders_required', orders_required, 'cards_awarded', cards_awarded,
                     'reached', orders_required <= v_done) order by orders_required), '[]'::jsonb)
                   from public.reward_milestones where active),
    'cards', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', d.id, 'code', d.code, 'source', d.source, 'milestone_orders', d.milestone_orders,
                'status', public.effective_status(d), 'issued_at', d.issued_at, 'expires_at', d.expires_at,
                'used_at', d.used_at, 'revoked_at', d.revoked_at,
                'used_order', case when o.id is null then null else jsonb_build_object('id', o.id, 'order_number', o.order_number) end,
                'used_percent', r.discount_percent, 'used_amount_cents', r.amount_cents,
                'history', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'at', e.created_at,
                              'order_number', eo.order_number) order by e.created_at), '[]'::jsonb)
                            from public.card_events e left join public.orders eo on eo.id = e.order_id where e.card_id = d.id)
              ) order by d.issued_at desc), '[]'::jsonb)
              from public.discount_cards d
              left join public.orders o on o.id = d.used_order_id
              left join public.card_redemptions r on r.card_id = d.id and r.restored_at is null
              where d.user_id = uid)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
create or replace function public.admin_reward_customers()
returns table (
  id uuid, email text, full_name text, role text, created_at timestamptz,
  completed_orders integer, orders_count bigint, feedback text, feedback_note text, eligibility text,
  cards_available bigint, cards_used bigint, cards_revoked bigint, cards_expired bigint, cards_gifted bigint, cards_total bigint,
  next_orders_required integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  return query
    select p.id, p.email, p.full_name, p.role, p.created_at,
           coalesce(o.done, 0)::integer, coalesce(o.n, 0)::bigint,
           coalesce(rc.feedback, 'neutral'), rc.note, public.reward_eligibility(p.id),
           coalesce(c.avail, 0), coalesce(c.used, 0), coalesce(c.revoked, 0), coalesce(c.expired, 0), coalesce(c.gifted, 0), coalesce(c.total, 0),
           (select m.orders_required from public.reward_milestones m where m.active and m.orders_required > coalesce(o.done, 0) order by m.orders_required limit 1)
    from public.profiles p
    left join (select user_id, count(*) n, count(*) filter (where status = 'delivered') done from public.orders group by user_id) o on o.user_id = p.id
    left join public.reward_customers rc on rc.user_id = p.id
    left join (select d.user_id,
                      count(*) filter (where public.effective_status(d) = 'available') avail,
                      count(*) filter (where d.status = 'used') used,
                      count(*) filter (where d.status = 'revoked') revoked,
                      count(*) filter (where public.effective_status(d) = 'expired') expired,
                      count(*) filter (where d.source = 'gift') gifted,
                      count(*) total
               from public.discount_cards d group by d.user_id) c on c.user_id = p.id
    order by coalesce(o.done, 0) desc, p.created_at desc;
end;
$$;

create or replace function public.admin_set_customer_feedback(p_user uuid, p_feedback text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  if p_feedback not in ('positive', 'neutral', 'negative') then
    raise exception 'Feedback must be positive, neutral or negative';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Customer not found';
  end if;
  insert into public.reward_customers (user_id, feedback, note, updated_by, updated_at)
  values (p_user, p_feedback, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (user_id) do update set feedback = excluded.feedback, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = now();
  -- A customer who becomes eligible gets any milestone cards they have already earned.
  return public.issue_milestone_cards(p_user);
end;
$$;

create or replace function public.admin_gift_cards(p_user uuid, p_count integer default 1, p_reason text default null)
returns setof public.discount_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  i integer;
  c public.discount_cards;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  if p_count is null or p_count < 1 or p_count > 20 then
    raise exception 'You can gift between 1 and 20 cards at a time';
  end if;
  if char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'The note is too long';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Customer not found';
  end if;
  for i in 1..p_count loop
    c := public.issue_card(p_user, 'gift', null, null, null, auth.uid(), v_reason);
    insert into public.card_gifts (card_id, user_id, admin_id, reason) values (c.id, p_user, auth.uid(), v_reason);
    return next c;
  end loop;
end;
$$;

create or replace function public.admin_revoke_card(p_card uuid, p_reason text default null)
returns public.discount_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.discount_cards;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  update public.discount_cards set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(v_reason, 500)
  where id = p_card and status = 'available'
  returning * into c;
  if c.id is null then
    raise exception 'Only unused cards can be revoked';
  end if;
  insert into public.card_events (card_id, user_id, event, actor_id, note) values (c.id, c.user_id, 'revoked', auth.uid(), v_reason);
  return c;
end;
$$;

-- Run the milestone check for one customer, or everyone when p_user is null.
create or replace function public.admin_run_reward_check(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  r record;
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  for r in select p.id from public.profiles p where p_user is null or p.id = p_user loop
    v_total := v_total + public.issue_milestone_cards(r.id);
  end loop;
  return v_total;
end;
$$;

create or replace function public.admin_reward_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  return jsonb_build_object(
    'issued', (select count(*) from public.discount_cards),
    'used', (select count(*) from public.discount_cards where status = 'used'),
    'active', (select count(*) from public.discount_cards d where public.effective_status(d) = 'available'),
    'gifted', (select count(*) from public.discount_cards where source = 'gift'),
    'revoked', (select count(*) from public.discount_cards where status = 'revoked'),
    'expired', (select count(*) from public.discount_cards d where public.effective_status(d) = 'expired'),
    'redeemed_cents', (select coalesce(sum(r.amount_cents), 0) from public.card_redemptions r
                       join public.orders o on o.id = r.order_id where r.restored_at is null and o.status <> 'cancelled'),
    'customers_with_cards', (select count(distinct user_id) from public.discount_cards),
    'recent', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                 select e.id, e.event, e.created_at, e.note, d.code, p.email, p.full_name, e.user_id, o.order_number, o.id as order_id
                 from public.card_events e
                 join public.discount_cards d on d.id = e.card_id
                 left join public.profiles p on p.id = e.user_id
                 left join public.orders o on o.id = e.order_id
                 order by e.created_at desc, e.id desc limit 40) x)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges. Supabase grants execute on new functions to anon and
-- authenticated by default, so internal helpers are revoked from both explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.completed_orders(uuid) from public, anon, authenticated;
revoke all on function public.reward_eligibility(uuid) from public, anon, authenticated;
revoke all on function public.issue_card(uuid, text, uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.issue_milestone_cards(uuid) from public, anon, authenticated;
revoke all on function public.compute_card_discount(uuid, uuid[], integer, boolean) from public, anon, authenticated;
revoke all on function public.redeem_cards(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.orders_reward_status() from public, anon, authenticated;

revoke all on function public.effective_status(public.discount_cards) from public, anon;
revoke all on function public.place_order(jsonb, uuid[]) from public, anon;
revoke all on function public.buy_now(uuid, integer, jsonb, uuid[]) from public, anon;
revoke all on function public.preview_card_discount(uuid[], uuid, integer) from public, anon;
revoke all on function public.my_rewards() from public, anon;
revoke all on function public.admin_reward_customers() from public, anon;
revoke all on function public.admin_set_customer_feedback(uuid, text, text) from public, anon;
revoke all on function public.admin_gift_cards(uuid, integer, text) from public, anon;
revoke all on function public.admin_revoke_card(uuid, text) from public, anon;
revoke all on function public.admin_run_reward_check(uuid) from public, anon;
revoke all on function public.admin_reward_stats() from public, anon;

grant execute on function public.effective_status(public.discount_cards) to authenticated;
grant execute on function public.place_order(jsonb, uuid[]) to authenticated;
grant execute on function public.buy_now(uuid, integer, jsonb, uuid[]) to authenticated;
grant execute on function public.preview_card_discount(uuid[], uuid, integer) to authenticated;
grant execute on function public.my_rewards() to authenticated;
grant execute on function public.admin_reward_customers() to authenticated;
grant execute on function public.admin_set_customer_feedback(uuid, text, text) to authenticated;
grant execute on function public.admin_gift_cards(uuid, integer, text) to authenticated;
grant execute on function public.admin_revoke_card(uuid, text) to authenticated;
grant execute on function public.admin_run_reward_check(uuid) to authenticated;
grant execute on function public.admin_reward_stats() to authenticated;
