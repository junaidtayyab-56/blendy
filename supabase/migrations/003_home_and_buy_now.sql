-- Homepage picker and Buy Now. Additive only.

-- Which products appear in the homepage slider. The four original flavours stay on.
alter table public.products add column if not exists show_on_home boolean not null default false;
update public.products set show_on_home = true
where slug in ('berry', 'kiwi', 'banana', 'strawberry') and not show_on_home;

-- Buy Now: order one product straight away without touching the customer's cart.
create or replace function public.buy_now(p_product_id uuid, p_quantity integer, p_shipping jsonb)
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

  select email into v_email from auth.users where id = uid;

  insert into public.orders (
    user_id, email, total_cents, subtotal_cents, shipping_cents, currency,
    shipping_name, shipping_phone, shipping_address, shipping_city, shipping_postal_code, shipping_country, notes
  ) values (
    uid, v_email, v_subtotal + v_shipping, v_subtotal, v_shipping, coalesce(v_settings.currency, 'USD'),
    v_name, v_phone, v_address, v_city, nullif(v_postal, ''), v_country, v_notes
  ) returning * into new_order;

  insert into public.order_items (order_id, product_id, product_name, unit_price_cents, quantity)
  values (new_order.id, v_product.id, v_product.name, v_product.price_cents, p_quantity);

  update public.products set stock = stock - p_quantity where id = v_product.id;
  return new_order;
end;
$$;

revoke all on function public.buy_now(uuid, integer, jsonb) from public, anon;
grant execute on function public.buy_now(uuid, integer, jsonb) to authenticated;
