-- Blendy e-commerce: profiles + admin role, categories, product catalogue fields, stock,
-- shipping on orders, store settings, contact messages and product image storage.
-- Additive only: no table or row is dropped.

-- ---------------------------------------------------------------------------
-- Profiles and admin role
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

-- New sign-ups get a customer profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the profile email in step with the auth email.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Backfill profiles for anyone who signed up before this migration.
insert into public.profiles (id, email, full_name)
select u.id, u.email, nullif(u.raw_user_meta_data->>'full_name', '')
from auth.users u
on conflict (id) do nothing;

-- Only admins may change a role; users may edit their own name and phone.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- auth.uid() is null only for trusted SQL run by the project owner (e.g. the SQL editor).
  if new.role is distinct from old.role and (select auth.uid()) is not null and not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  if new.id = (select auth.uid()) and new.role <> 'admin' and old.role = 'admin' then
    raise exception 'You cannot remove your own admin role';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

alter table public.profiles enable row level security;

drop policy if exists "Profiles: read own or admin" on public.profiles;
create policy "Profiles: read own or admin" on public.profiles
  for select to authenticated using ((select auth.uid()) = id or (select public.is_admin()));
drop policy if exists "Profiles: update own or admin" on public.profiles;
create policy "Profiles: update own or admin" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()))
  with check ((select auth.uid()) = id or (select public.is_admin()));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, role) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  image_url text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;
drop policy if exists "Categories: public read active" on public.categories;
create policy "Categories: public read active" on public.categories
  for select to anon, authenticated using (active or (select public.is_admin()));
drop policy if exists "Categories: admin insert" on public.categories;
create policy "Categories: admin insert" on public.categories
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Categories: admin update" on public.categories;
create policy "Categories: admin update" on public.categories
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Categories: admin delete" on public.categories;
create policy "Categories: admin delete" on public.categories
  for delete to authenticated using ((select public.is_admin()));

revoke all on public.categories from anon, authenticated;
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;

-- ---------------------------------------------------------------------------
-- Products: catalogue fields and stock
-- ---------------------------------------------------------------------------
alter table public.products add column if not exists category_id uuid references public.categories(id) on delete set null;
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists gallery text[] not null default '{}';
alter table public.products add column if not exists stock integer not null default 0 check (stock >= 0);
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists featured boolean not null default false;
alter table public.products add column if not exists size_ml integer check (size_ml is null or size_ml > 0);
alter table public.products add column if not exists ingredients text;
alter table public.products add column if not exists compare_at_price_cents integer check (compare_at_price_cents is null or compare_at_price_cents >= 0);
alter table public.products add column if not exists bg_color text;
alter table public.products add column if not exists updated_at timestamptz not null default now();
create index if not exists products_category_idx on public.products(category_id);
create unique index if not exists products_sku_key on public.products(sku) where sku is not null;

drop policy if exists "Active products are public" on public.products;
create policy "Active products are public" on public.products
  for select to anon, authenticated using (active or (select public.is_admin()));
drop policy if exists "Products: admin insert" on public.products;
create policy "Products: admin insert" on public.products
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Products: admin update" on public.products;
create policy "Products: admin update" on public.products
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Products: admin delete" on public.products;
create policy "Products: admin delete" on public.products
  for delete to authenticated using ((select public.is_admin()));

grant insert, update, delete on public.products to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- Seed: one category for the four existing smoothies, their details and opening stock.
insert into public.categories (name, slug, description, sort_order)
values ('Smoothies', 'smoothies', 'Real fruit smoothies, blended fresh.', 1)
on conflict (slug) do nothing;

update public.products p set
  category_id = coalesce(p.category_id, (select id from public.categories where slug = 'smoothies')),
  size_ml = coalesce(p.size_ml, 250),
  bg_color = coalesce(p.bg_color, v.bg),
  ingredients = coalesce(p.ingredients, v.ing),
  sku = coalesce(p.sku, v.sku),
  stock = case when p.stock = 0 then 100 else p.stock end,
  featured = true
from (values
  ('berry', '#C2B0DC', 'Raspberry, blueberry, blackberry', 'BLD-BERRY-250'),
  ('kiwi', '#B4D58A', 'Kiwi, apple', 'BLD-KIWI-250'),
  ('banana', '#F3DA8A', 'Banana, oat milk', 'BLD-BANANA-250'),
  ('strawberry', '#F2AFC0', 'Strawberry, banana, apple', 'BLD-STRAWBERRY-250')
) as v(slug, bg, ing, sku)
where p.slug = v.slug;

-- ---------------------------------------------------------------------------
-- Orders: shipping details, totals, admin status updates
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists order_number bigint generated by default as identity (start with 1001);
alter table public.orders add column if not exists email text;
alter table public.orders add column if not exists shipping_name text;
alter table public.orders add column if not exists shipping_phone text;
alter table public.orders add column if not exists shipping_address text;
alter table public.orders add column if not exists shipping_city text;
alter table public.orders add column if not exists shipping_postal_code text;
alter table public.orders add column if not exists shipping_country text;
alter table public.orders add column if not exists notes text;
alter table public.orders add column if not exists payment_method text not null default 'cod' check (payment_method in ('cod'));
alter table public.orders add column if not exists subtotal_cents integer not null default 0 check (subtotal_cents >= 0);
alter table public.orders add column if not exists shipping_cents integer not null default 0 check (shipping_cents >= 0);
alter table public.orders add column if not exists updated_at timestamptz not null default now();
create unique index if not exists orders_order_number_key on public.orders(order_number);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_idx on public.orders(created_at desc);

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

drop policy if exists "Users read own orders" on public.orders;
create policy "Users read own orders" on public.orders
  for select to authenticated using ((select auth.uid()) = user_id or (select public.is_admin()));
drop policy if exists "Orders: admin update" on public.orders;
create policy "Orders: admin update" on public.orders
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant update (status, notes) on public.orders to authenticated;

drop policy if exists "Users read own order items" on public.order_items;
create policy "Users read own order items" on public.order_items
  for select to authenticated using (
    (select public.is_admin())
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Store settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.store_settings (
  id boolean primary key default true check (id),
  store_name text not null default 'Blendy',
  tagline text default 'Real fruit smoothies',
  about text,
  contact_email text,
  contact_phone text,
  address text,
  currency text not null default 'USD',
  shipping_fee_cents integer not null default 0 check (shipping_fee_cents >= 0),
  free_shipping_threshold_cents integer check (free_shipping_threshold_cents is null or free_shipping_threshold_cents >= 0),
  announcement text,
  instagram_url text,
  facebook_url text,
  tiktok_url text,
  updated_at timestamptz not null default now()
);
insert into public.store_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists store_settings_touch on public.store_settings;
create trigger store_settings_touch before update on public.store_settings
  for each row execute function public.touch_updated_at();

alter table public.store_settings enable row level security;
drop policy if exists "Settings: public read" on public.store_settings;
create policy "Settings: public read" on public.store_settings
  for select to anon, authenticated using (true);
drop policy if exists "Settings: admin update" on public.store_settings;
create policy "Settings: admin update" on public.store_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.store_settings from anon, authenticated;
grant select on public.store_settings to anon, authenticated;
grant update on public.store_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Contact messages
-- ---------------------------------------------------------------------------
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254),
  subject text check (subject is null or char_length(subject) <= 200),
  message text not null check (char_length(message) between 1 and 5000),
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contact_messages_created_idx on public.contact_messages(created_at desc);

alter table public.contact_messages enable row level security;
drop policy if exists "Contact: anyone can send" on public.contact_messages;
create policy "Contact: anyone can send" on public.contact_messages
  for insert to anon, authenticated with check (status = 'new');
drop policy if exists "Contact: admin read" on public.contact_messages;
create policy "Contact: admin read" on public.contact_messages
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Contact: admin update" on public.contact_messages;
create policy "Contact: admin update" on public.contact_messages
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Contact: admin delete" on public.contact_messages;
create policy "Contact: admin delete" on public.contact_messages
  for delete to authenticated using ((select public.is_admin()));
revoke all on public.contact_messages from anon, authenticated;
grant insert (name, email, subject, message) on public.contact_messages to anon, authenticated;
grant select, delete on public.contact_messages to authenticated;
grant update (status) on public.contact_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Cart: refuse inactive or out-of-stock products
-- ---------------------------------------------------------------------------
create or replace function public.add_to_cart(p_product_id uuid, p_quantity integer default 1)
returns public.cart_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.cart_items;
  v_stock integer;
  v_in_cart integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'Invalid quantity';
  end if;
  select stock into v_stock from public.products where id = p_product_id and active;
  if v_stock is null then
    raise exception 'This product is not available';
  end if;
  select coalesce(quantity, 0) into v_in_cart from public.cart_items
    where user_id = auth.uid() and product_id = p_product_id;
  if coalesce(v_in_cart, 0) + p_quantity > v_stock then
    raise exception 'Only % left in stock', v_stock;
  end if;
  insert into public.cart_items (user_id, product_id, quantity)
  values (auth.uid(), p_product_id, p_quantity)
  on conflict (user_id, product_id)
  do update set quantity = least(99, public.cart_items.quantity + excluded.quantity)
  returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checkout: price from the database, check and reduce stock, add shipping
-- ---------------------------------------------------------------------------
create or replace function public.place_order(p_shipping jsonb)
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

  select email into v_email from auth.users where id = uid;

  insert into public.orders (
    user_id, email, total_cents, subtotal_cents, shipping_cents, currency,
    shipping_name, shipping_phone, shipping_address, shipping_city, shipping_postal_code, shipping_country, notes
  ) values (
    uid, v_email, v_subtotal + v_shipping, v_subtotal, v_shipping, coalesce(v_settings.currency, 'USD'),
    v_name, v_phone, v_address, v_city, nullif(v_postal, ''), v_country, v_notes
  ) returning * into new_order;

  insert into public.order_items (order_id, product_id, product_name, unit_price_cents, quantity)
  select new_order.id, p.id, p.name, p.price_cents, c.quantity
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.user_id = uid;

  update public.products p set stock = p.stock - c.quantity
  from public.cart_items c
  where c.user_id = uid and c.product_id = p.id;

  delete from public.cart_items where user_id = uid;
  return new_order;
end;
$$;

revoke all on function public.place_order(jsonb) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: put stock back when an order is cancelled
-- ---------------------------------------------------------------------------
create or replace function public.restock_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.products p set stock = p.stock + oi.quantity
    from public.order_items oi
    where oi.order_id = new.id and oi.product_id = p.id;
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'A cancelled order cannot be reopened';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_restock on public.orders;
create trigger orders_restock after update of status on public.orders
  for each row execute function public.restock_cancelled_order();

-- ---------------------------------------------------------------------------
-- Admin: dashboard numbers and customer list
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  select jsonb_build_object(
    'revenue_cents', (select coalesce(sum(total_cents), 0) from public.orders where status <> 'cancelled'),
    'revenue_30d_cents', (select coalesce(sum(total_cents), 0) from public.orders where status <> 'cancelled' and created_at > now() - interval '30 days'),
    'orders_total', (select count(*) from public.orders),
    'orders_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.orders group by status) s),
    'customers_total', (select count(*) from public.profiles where role = 'customer'),
    'customers_30d', (select count(*) from public.profiles where role = 'customer' and created_at > now() - interval '30 days'),
    'products_total', (select count(*) from public.products),
    'products_active', (select count(*) from public.products where active),
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', stock) order by stock), '[]'::jsonb)
                  from (select id, name, stock from public.products where active and stock <= 10 order by stock limit 10) l),
    'messages_new', (select count(*) from public.contact_messages where status = 'new'),
    'sales_14d', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'cents', coalesce(t.cents, 0), 'orders', coalesce(t.n, 0)) order by d), '[]'::jsonb)
                  from generate_series((now() - interval '13 days')::date, now()::date, interval '1 day') d
                  left join (select created_at::date as day, sum(total_cents) as cents, count(*) as n from public.orders
                             where status <> 'cancelled' and created_at > now() - interval '14 days' group by 1) t on t.day = d::date),
    'recent_orders', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
                        select id, order_number, status, total_cents, currency, created_at, shipping_name, email
                        from public.orders order by created_at desc limit 8) r)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_customers()
returns table (
  id uuid, email text, full_name text, phone text, role text, created_at timestamptz,
  orders_count bigint, total_spent_cents bigint, last_order_at timestamptz
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
    select p.id, p.email, p.full_name, p.phone, p.role, p.created_at,
           count(o.id), coalesce(sum(o.total_cents) filter (where o.status <> 'cancelled'), 0)::bigint, max(o.created_at)
    from public.profiles p
    left join public.orders o on o.user_id = p.id
    group by p.id
    order by p.created_at desc;
end;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon;
revoke all on function public.admin_customers() from public, anon;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_customers() to authenticated;
-- Row policies readable by anonymous visitors call is_admin(), so anon keeps execute (it returns false).
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Product image storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Product images: admin upload" on storage.objects;
create policy "Product images: admin upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and (select public.is_admin()));
drop policy if exists "Product images: admin update" on storage.objects;
create policy "Product images: admin update" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and (select public.is_admin()));
drop policy if exists "Product images: admin delete" on storage.objects;
create policy "Product images: admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and (select public.is_admin()));
