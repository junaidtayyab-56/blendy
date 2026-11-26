-- Security + flow test for 002_ecommerce.sql. Creates two throwaway users, checks
-- what a customer, an admin and an anonymous visitor can do, then removes everything.
begin;
create temp table t (n serial, step text, ok boolean, detail text);
grant all on t to anon, authenticated;
grant usage on sequence t_n_seq to anon, authenticated;
create temp table s as select id, stock from public.products;
grant select on s to anon, authenticated;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-customer@blendy.test', '{"full_name":"Test Customer"}', now(), now()),
       ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-admin@blendy.test', '{}', now(), now());
insert into t(step, ok, detail) select 'profiles created by trigger', count(*) = 2 and bool_and(role = 'customer'), count(*)::text
  from public.profiles where id in ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-0000000000a1');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-0000000000a1';
insert into t(step, ok) select 'owner can grant admin in SQL editor', role = 'admin' from public.profiles where id = '00000000-0000-4000-a000-0000000000a1';

-- Customer
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000c1","role":"authenticated"}', true);
do $$ begin
  begin update public.profiles set role = 'admin' where id = auth.uid();
    insert into t(step, ok) values ('customer cannot make self admin', false);
  exception when others then insert into t(step, ok, detail) values ('customer cannot make self admin', true, sqlerrm); end;
  insert into t(step, ok, detail) select 'customer sees only own profile', count(*) = 1, count(*)::text from public.profiles;
  update public.profiles set full_name = 'Renamed', phone = '123' where id = auth.uid();
  insert into t(step, ok) select 'customer can edit own name/phone', full_name = 'Renamed' from public.profiles where id = auth.uid();
  begin perform public.admin_dashboard_stats();
    insert into t(step, ok) values ('customer blocked from dashboard stats', false);
  exception when others then insert into t(step, ok, detail) values ('customer blocked from dashboard stats', true, sqlerrm); end;
  begin perform public.admin_customers();
    insert into t(step, ok) values ('customer blocked from customer list', false);
  exception when others then insert into t(step, ok, detail) values ('customer blocked from customer list', true, sqlerrm); end;
  begin insert into public.products (slug, name, price_cents) values ('hack', 'Hack', 1);
    insert into t(step, ok) values ('customer cannot add products', false);
  exception when others then insert into t(step, ok, detail) values ('customer cannot add products', true, sqlerrm); end;
  begin insert into public.categories (name, slug) values ('Hack', 'hack');
    insert into t(step, ok) values ('customer cannot add categories', false);
  exception when others then insert into t(step, ok, detail) values ('customer cannot add categories', true, sqlerrm); end;
  update public.products set price_cents = 1;
  insert into t(step, ok) select 'customer price edit has no effect', bool_and(price_cents > 1) from public.products;
  begin perform public.add_to_cart((select id from public.products where slug = 'berry'), 1000);
    insert into t(step, ok) values ('add_to_cart rejects silly quantity', false);
  exception when others then insert into t(step, ok, detail) values ('add_to_cart rejects silly quantity', true, sqlerrm); end;
  perform public.add_to_cart((select id from public.products where slug = 'berry'), 2);
  perform public.add_to_cart((select id from public.products where slug = 'kiwi'), 1);
  begin perform public.place_order('{}'::jsonb);
    insert into t(step, ok) values ('checkout requires shipping details', false);
  exception when others then insert into t(step, ok, detail) values ('checkout requires shipping details', true, sqlerrm); end;
  perform public.place_order('{"name":"Test Customer","phone":"0300","address":"1 Fruit St","city":"Lahore","country":"Pakistan"}'::jsonb);
  insert into t(step, ok, detail) select 'order placed with priced lines', o.total_cents = 3 * 499 + o.shipping_cents and (select count(*) from public.order_items where order_id = o.id) = 2,
    'order #' || o.order_number || ' total ' || o.total_cents from public.orders o where o.user_id = auth.uid();
  insert into t(step, ok) select 'cart emptied after order', count(*) = 0 from public.cart_items;
  update public.orders set status = 'delivered';
  insert into t(step, ok) select 'customer cannot change order status', bool_and(status = 'pending') from public.orders;
  insert into public.contact_messages (name, email, message) values ('Test', 'test-customer@blendy.test', 'Hello from test');
  insert into t(step, ok) select 'customer cannot read contact inbox', count(*) = 0 from public.contact_messages;
end $$;
reset role;
insert into t(step, ok, detail) select 'stock reduced by order', (select stock from public.products where slug = 'berry') = (select s.stock - 2 from s join public.products p using (id) where p.slug = 'berry'),
  (select stock from public.products where slug = 'berry')::text;

-- Anonymous visitor
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  insert into t(step, ok, detail) select 'anon can read active products', count(*) >= 4, count(*)::text from public.products;
  insert into t(step, ok) select 'anon can read settings', count(*) = 1 from public.store_settings;
  insert into t(step, ok) select 'anon can read categories', count(*) >= 1 from public.categories;
  insert into public.contact_messages (name, email, message) values ('Anon', 'anon@blendy.test', 'Hello from anon');
  insert into t(step, ok) values ('anon can send contact message', true);
  begin perform 1 from public.orders;
    insert into t(step, ok) values ('anon cannot read orders', false);
  exception when others then insert into t(step, ok, detail) values ('anon cannot read orders', true, sqlerrm); end;
  begin perform 1 from public.profiles;
    insert into t(step, ok) values ('anon cannot read profiles', false);
  exception when others then insert into t(step, ok, detail) values ('anon cannot read profiles', true, sqlerrm); end;
end $$;
reset role;

-- Admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}', true);
do $$ declare v jsonb; oid uuid; pid uuid; cid uuid; begin
  v := public.admin_dashboard_stats();
  insert into t(step, ok, detail) values ('admin dashboard stats', (v->>'orders_total')::int >= 1, left(v::text, 120));
  insert into t(step, ok, detail) select 'admin customer list', count(*) >= 2, count(*)::text from public.admin_customers();
  insert into t(step, ok, detail) select 'admin sees all profiles', count(*) >= 2, count(*)::text from public.profiles;
  select id into oid from public.orders where user_id = '00000000-0000-4000-a000-0000000000c1';
  update public.orders set status = 'preparing', notes = 'packed' where id = oid;
  insert into t(step, ok) select 'admin can update order status', status = 'preparing' from public.orders where id = oid;
  update public.orders set status = 'cancelled' where id = oid;
  insert into t(step, ok) select 'cancel puts stock back', bool_and(p.stock = s.stock) from public.products p join s using (id);
  begin update public.orders set status = 'pending' where id = oid;
    insert into t(step, ok) values ('cancelled order cannot reopen', false);
  exception when others then insert into t(step, ok, detail) values ('cancelled order cannot reopen', true, sqlerrm); end;
  begin update public.orders set total_cents = 1 where id = oid;
    insert into t(step, ok) values ('admin cannot rewrite order totals', false);
  exception when others then insert into t(step, ok, detail) values ('admin cannot rewrite order totals', true, sqlerrm); end;
  insert into public.categories (name, slug) values ('Test cat', 'test-cat') returning id into cid;
  insert into public.products (slug, name, price_cents, category_id, stock) values ('test-prod', 'Test product', 650, cid, 5) returning id into pid;
  update public.products set price_cents = 700, stock = 3 where id = pid;
  insert into t(step, ok) select 'admin product create + update', price_cents = 700 and stock = 3 from public.products where id = pid;
  delete from public.products where id = pid;
  delete from public.categories where id = cid;
  insert into t(step, ok) select 'admin product + category delete', not exists (select 1 from public.products where id = pid) and not exists (select 1 from public.categories where id = cid);
  update public.store_settings set announcement = 'test' where id;
  insert into t(step, ok) select 'admin can edit settings', announcement = 'test' from public.store_settings;
  update public.store_settings set announcement = null where id;
  insert into t(step, ok, detail) select 'admin reads contact inbox', count(*) >= 2, count(*)::text from public.contact_messages;
  delete from public.contact_messages where email in ('test-customer@blendy.test', 'anon@blendy.test');
  begin update public.profiles set role = 'customer' where id = auth.uid();
    insert into t(step, ok) values ('admin cannot demote self', false);
  exception when others then insert into t(step, ok, detail) values ('admin cannot demote self', true, sqlerrm); end;
end $$;
reset role;

-- Clean up
delete from auth.users where id in ('00000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-0000000000a1');
update public.products p set stock = s.stock from s where s.id = p.id and p.stock <> s.stock;
insert into t(step, ok) select 'cleanup: test users and orders gone', not exists (select 1 from public.orders where email like '%@blendy.test') and not exists (select 1 from public.profiles where email like '%@blendy.test');
commit;
select n, step, ok, detail from t order by n;
