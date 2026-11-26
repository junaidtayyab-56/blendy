-- Blendy shop schema: products, carts and orders, all protected by row level security.

-- Products: public catalogue, read-only for visitors.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Cart: one row per user and product.
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);
create index if not exists cart_items_user_idx on public.cart_items(user_id);

-- Orders and their lines; written only by place_order().
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','paid','preparing','shipped','delivered','cancelled')),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);
create index if not exists orders_user_idx on public.orders(user_id);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price_cents integer not null,
  quantity integer not null check (quantity between 1 and 99)
);
create index if not exists order_items_order_idx on public.order_items(order_id);

-- Row level security
alter table public.products enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Active products are public" on public.products;
create policy "Active products are public" on public.products
  for select to anon, authenticated using (active);

drop policy if exists "Users read own cart" on public.cart_items;
create policy "Users read own cart" on public.cart_items
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users add to own cart" on public.cart_items;
create policy "Users add to own cart" on public.cart_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users update own cart" on public.cart_items;
create policy "Users update own cart" on public.cart_items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete from own cart" on public.cart_items;
create policy "Users delete from own cart" on public.cart_items
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own orders" on public.orders;
create policy "Users read own orders" on public.orders
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own order items" on public.order_items;
create policy "Users read own order items" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
  );

-- Table privileges: visitors only read products; signed-in users manage their cart and read their orders.
revoke all on public.products, public.cart_items, public.orders, public.order_items from anon, authenticated;
grant select on public.products to anon, authenticated;
grant select, insert, update, delete on public.cart_items to authenticated;
grant select on public.orders, public.order_items to authenticated;

-- Add a product to the signed-in user's cart, or bump its quantity.
create or replace function public.add_to_cart(p_product_id uuid, p_quantity integer default 1)
returns public.cart_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.cart_items;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'Invalid quantity';
  end if;
  insert into public.cart_items (user_id, product_id, quantity)
  values (auth.uid(), p_product_id, p_quantity)
  on conflict (user_id, product_id)
  do update set quantity = least(99, public.cart_items.quantity + excluded.quantity)
  returning * into result;
  return result;
end;
$$;

-- Turn the signed-in user's cart into an order using current prices, then empty the cart.
create or replace function public.place_order()
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_order public.orders;
  cart_total integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  select coalesce(sum(c.quantity * p.price_cents), 0) into cart_total
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.user_id = uid and p.active;

  if cart_total = 0 then
    raise exception 'Your cart is empty';
  end if;

  insert into public.orders (user_id, total_cents, currency)
  values (uid, cart_total, 'USD')
  returning * into new_order;

  insert into public.order_items (order_id, product_id, product_name, unit_price_cents, quantity)
  select new_order.id, p.id, p.name, p.price_cents, c.quantity
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.user_id = uid and p.active;

  delete from public.cart_items where user_id = uid;
  return new_order;
end;
$$;

revoke all on function public.add_to_cart(uuid, integer) from public, anon;
revoke all on function public.place_order() from public, anon;
grant execute on function public.add_to_cart(uuid, integer) to authenticated;
grant execute on function public.place_order() to authenticated;

-- Catalogue: the four flavours shown on the site. Edit prices in the Table Editor any time.
insert into public.products (slug, name, description, price_cents, sort_order) values
  ('berry', 'Berry', 'Raspberry, blueberry and blackberry smoothie', 499, 1),
  ('kiwi', 'Kiwi', 'Fresh kiwi smoothie', 499, 2),
  ('banana', 'Banana', 'Creamy banana smoothie', 499, 3),
  ('strawberry', 'Strawberry', 'Sweet strawberry smoothie', 499, 4)
on conflict (slug) do nothing;
