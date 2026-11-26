-- Flow + security test for 007_discount_cards.sql.
-- Everything runs inside one transaction that is ALWAYS rolled back: the last step raises
-- an error whose message is the test report, so no test user, order, card or setting is kept.
-- Read the report in the error message: every line should start with PASS.
begin;
create temp table t (n serial, step text, ok boolean, detail text) on commit drop;
grant all on t to anon, authenticated;
grant usage on sequence t_n_seq to anon, authenticated;

create function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  if p_user is null then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
end $$;
create function pg_temp.anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;
create function pg_temp.ok(p_step text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into t(step, ok, detail) values (p_step, coalesce(p_ok, false), p_detail);
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;

do $$
declare
  c1 uuid := '00000000-0000-4000-a000-00000000c701';
  c2 uuid := '00000000-0000-4000-a000-00000000c702';
  a1 uuid := '00000000-0000-4000-a000-00000000a701';
  ship jsonb := '{"name":"Reward Tester","phone":"0300","address":"1 Fruit St","city":"Lahore","country":"Pakistan"}';
  pid uuid;
  o uuid;
  o_ids uuid[] := '{}';
  ord public.orders;
  card_ids uuid[];
  other_card uuid;
  j jsonb;
  n integer;
  v text;
begin
  -- Setup (as the project owner)
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (c1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reward-c1@blendy.test', '{}', now(), now()),
    (c2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reward-c2@blendy.test', '{}', now(), now()),
    (a1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reward-admin@blendy.test', '{}', now(), now());
  insert into public.profiles (id, email) values (c1, 'reward-c1@blendy.test'), (c2, 'reward-c2@blendy.test'), (a1, 'reward-admin@blendy.test')
    on conflict (id) do nothing;
  update public.profiles set role = 'admin' where id = a1;
  update public.reward_settings set discount_percent = 10, auto_issue = true, require_positive_feedback = false,
    allow_multiple_cards = true, max_cards_per_order = null, max_discount_cents = null, expiry_days = null where id;
  update public.store_settings set shipping_fee_cents = 300, free_shipping_threshold_cents = null where id;
  delete from public.reward_milestones;
  insert into public.reward_milestones (orders_required, cards_awarded) values (2, 1), (5, 2), (8, 1);
  insert into public.products (slug, name, price_cents, stock, active) values ('reward-test', 'Reward Test', 1000, 500, true) returning id into pid;

  -- 1. First milestone (2 delivered orders = 1 card)
  for n in 1..2 loop
    perform pg_temp.act(c1);
    o := (public.buy_now(pid, 1, ship)).id;
    o_ids := o_ids || o;
    perform pg_temp.act(a1);
    update public.orders set status = 'delivered' where id = o;
    perform pg_temp.act(null);
    if n = 1 then
      perform pg_temp.ok('no card after 1 completed order', (select count(*) = 0 from public.discount_cards where user_id = c1));
    end if;
  end loop;
  perform pg_temp.ok('first milestone: 1 card after 2 completed orders', (select count(*) = 1 from public.discount_cards where user_id = c1 and source = 'milestone'));
  perform pg_temp.ok('card has a unique BLD code', (select bool_and(code ~ '^BLD-[0-9A-F]{4}-[0-9A-F]{4}$') from public.discount_cards where user_id = c1));

  -- 2. Idempotent: re-running and flipping status does not duplicate
  perform pg_temp.act(a1);
  n := public.admin_run_reward_check(c1);
  update public.orders set status = 'shipped' where id = o;
  update public.orders set status = 'delivered' where id = o;
  n := n + public.admin_run_reward_check(null);
  perform pg_temp.act(null);
  perform pg_temp.ok('no duplicate cards on re-check or status flip', (select count(*) = 1 from public.discount_cards where user_id = c1) and n = 0, 'extra issued: ' || n);

  -- 3. Second milestone (5 orders = 2 cards)
  for n in 3..5 loop
    perform pg_temp.act(c1);
    o := (public.buy_now(pid, 1, ship)).id;
    perform pg_temp.act(a1);
    update public.orders set status = 'delivered' where id = o;
  end loop;
  perform pg_temp.act(null);
  perform pg_temp.ok('second milestone: 2 more cards at 5 orders (3 total)', (select count(*) = 3 from public.discount_cards where user_id = c1),
    (select count(*)::text from public.discount_cards where user_id = c1));

  -- 4. Feedback rules
  perform pg_temp.act(a1);
  perform public.admin_set_customer_feedback(c2, 'negative', 'Rude to driver');
  for n in 1..2 loop
    perform pg_temp.act(c2);
    o := (public.buy_now(pid, 1, ship)).id;
    perform pg_temp.act(a1);
    update public.orders set status = 'delivered' where id = o;
  end loop;
  perform pg_temp.act(null);
  perform pg_temp.ok('negative feedback blocks automatic cards', (select count(*) = 0 from public.discount_cards where user_id = c2));
  update public.reward_settings set require_positive_feedback = true where id;
  perform pg_temp.act(a1);
  n := public.admin_set_customer_feedback(c2, 'neutral', null);
  perform pg_temp.act(null);
  perform pg_temp.ok('positive-required rule: neutral customer gets nothing', n = 0 and (select count(*) = 0 from public.discount_cards where user_id = c2));
  perform pg_temp.act(a1);
  n := public.admin_set_customer_feedback(c2, 'positive', 'Great customer');
  perform pg_temp.act(null);
  perform pg_temp.ok('marking positive issues the earned card', n = 1 and (select count(*) = 1 from public.discount_cards where user_id = c2));
  update public.reward_settings set require_positive_feedback = false where id;

  -- 5. Manual gift
  perform pg_temp.act(a1);
  select id into other_card from public.admin_gift_cards(c2, 1, 'Sorry for the late delivery');
  perform pg_temp.act(null);
  perform pg_temp.ok('admin gift appears on the customer account', (select source = 'gift' and status = 'available' from public.discount_cards where id = other_card)
    and exists (select 1 from public.card_gifts where card_id = other_card and reason = 'Sorry for the late delivery' and admin_id = a1));

  -- 6. Customer security
  perform pg_temp.act(c1);
  perform pg_temp.ok('customer sees only own cards', (select count(*) = 3 and bool_and(user_id = c1) from public.discount_cards));
  begin update public.discount_cards set status = 'available' where user_id = c1;
    perform pg_temp.ok('customer cannot edit cards', false);
  exception when others then perform pg_temp.ok('customer cannot edit cards', true, sqlerrm); end;
  begin insert into public.discount_cards (code, user_id, source) values ('BLD-HACK-0001', c1, 'gift');
    perform pg_temp.ok('customer cannot create cards', false);
  exception when others then perform pg_temp.ok('customer cannot create cards', true, sqlerrm); end;
  begin perform public.admin_gift_cards(c1, 5, 'self');
    perform pg_temp.ok('customer cannot gift cards', false);
  exception when others then perform pg_temp.ok('customer cannot gift cards', true, sqlerrm); end;
  begin perform public.issue_milestone_cards(c1);
    perform pg_temp.ok('customer cannot call internal issuer', false);
  exception when others then perform pg_temp.ok('customer cannot call internal issuer', true, sqlerrm); end;
  begin update public.reward_settings set discount_percent = 100 where id;
    perform pg_temp.ok('customer settings edit has no effect', (select discount_percent = 10 from public.reward_settings));
  exception when others then perform pg_temp.ok('customer settings edit has no effect', true, sqlerrm); end;
  perform pg_temp.ok('customer cannot read feedback table', (select count(*) = 0 from public.reward_customers));
  begin perform public.admin_reward_stats();
    perform pg_temp.ok('customer blocked from reward analytics', false);
  exception when others then perform pg_temp.ok('customer blocked from reward analytics', true, sqlerrm); end;

  -- 7. Checkout with cards
  begin perform public.buy_now(pid, 1, ship, array[other_card]);
    perform pg_temp.ok('another customer''s card is refused', false);
  exception when others then perform pg_temp.ok('another customer''s card is refused', true, sqlerrm); end;
  select array_agg(id order by issued_at) into card_ids from public.discount_cards where user_id = c1;
  j := public.preview_card_discount(card_ids[1:2], pid, 1);
  perform pg_temp.ok('server preview: 2 cards x 10% of 10.00 = 2.00', (j->>'total_cents')::int = 200 and (j->>'payable_cents')::int = 1000 + 300 - 200, j::text);
  ord := public.buy_now(pid, 1, ship, card_ids[1:2]);
  perform pg_temp.ok('discount deducted from order total', ord.discount_cents = 200 and ord.total_cents = 1100 and ord.subtotal_cents = 1000,
    'total ' || ord.total_cents || ' discount ' || ord.discount_cents);
  perform pg_temp.ok('used cards marked used on that order', (select count(*) = 2 from public.discount_cards where id = any(card_ids[1:2]) and status = 'used' and used_order_id = ord.id));
  begin perform public.buy_now(pid, 1, ship, card_ids[1:1]);
    perform pg_temp.ok('used card cannot be reused', false);
  exception when others then perform pg_temp.ok('used card cannot be reused', true, sqlerrm); end;
  begin perform public.buy_now(pid, 1, ship, array[card_ids[3], card_ids[3]]);
    perform pg_temp.ok('same card twice in one order refused', false);
  exception when others then perform pg_temp.ok('same card twice in one order refused', true, sqlerrm); end;

  -- 8. Failed order leaves the card untouched
  begin perform public.buy_now(pid, 1, '{"name":""}'::jsonb, card_ids[3:3]);
    perform pg_temp.ok('failed order keeps card available', false);
  exception when others then
    perform pg_temp.ok('failed order keeps card available', (select status = 'available' from public.discount_cards where id = card_ids[3]), sqlerrm);
  end;

  -- 9. Cancelled order gives cards back
  perform pg_temp.act(a1);
  update public.orders set status = 'cancelled' where id = ord.id;
  perform pg_temp.act(null);
  perform pg_temp.ok('cancelled order restores its cards', (select count(*) = 2 from public.discount_cards where id = any(card_ids[1:2]) and status = 'available' and used_order_id is null)
    and (select count(*) = 2 from public.card_redemptions where order_id = ord.id and restored_at is not null)
    and (select count(*) = 2 from public.card_events where order_id = ord.id and event = 'restored'));

  -- 10. Admin limits
  update public.reward_settings set allow_multiple_cards = false where id;
  perform pg_temp.act(c1);
  begin perform public.buy_now(pid, 1, ship, card_ids[1:2]);
    perform pg_temp.ok('one-card-only setting enforced', false);
  exception when others then perform pg_temp.ok('one-card-only setting enforced', true, sqlerrm); end;
  perform pg_temp.act(null);
  update public.reward_settings set allow_multiple_cards = true, max_cards_per_order = 2 where id;
  perform pg_temp.act(c1);
  begin perform public.preview_card_discount(card_ids, pid, 1);
    perform pg_temp.ok('max cards per order enforced', false);
  exception when others then perform pg_temp.ok('max cards per order enforced', true, sqlerrm); end;
  perform pg_temp.act(null);
  update public.reward_settings set max_cards_per_order = null, max_discount_cents = 150 where id;
  perform pg_temp.act(c1);
  j := public.preview_card_discount(card_ids[1:2], pid, 1);
  perform pg_temp.ok('max discount per order caps the total', (j->>'total_cents')::int = 150, j::text);
  begin perform public.preview_card_discount(card_ids, pid, 1);
    perform pg_temp.ok('a card that adds nothing past the cap is refused', false);
  exception when others then perform pg_temp.ok('a card that adds nothing past the cap is refused', true, sqlerrm); end;
  perform pg_temp.act(null);
  update public.reward_settings set max_discount_cents = null where id;

  -- 11. Revoke and expiry
  perform pg_temp.act(a1);
  perform public.admin_revoke_card(card_ids[3], 'Test revoke');
  perform pg_temp.act(c1);
  begin perform public.buy_now(pid, 1, ship, card_ids[3:3]);
    perform pg_temp.ok('revoked card cannot be used', false);
  exception when others then perform pg_temp.ok('revoked card cannot be used', true, sqlerrm); end;
  ord := public.buy_now(pid, 1, ship, card_ids[1:1]);
  perform pg_temp.act(a1);
  begin perform public.admin_revoke_card(card_ids[1], 'x');
    perform pg_temp.ok('used card cannot be revoked', false);
  exception when others then perform pg_temp.ok('used card cannot be revoked', true, sqlerrm); end;
  perform pg_temp.act(null);
  update public.discount_cards set expires_at = now() - interval '1 day' where id = card_ids[2];
  perform pg_temp.act(c1);
  perform pg_temp.ok('expired card shows as expired', (select public.effective_status(d) = 'expired' from public.discount_cards d where id = card_ids[2]));
  begin perform public.buy_now(pid, 1, ship, card_ids[2:2]);
    perform pg_temp.ok('expired card cannot be used', false);
  exception when others then perform pg_temp.ok('expired card cannot be used', true, sqlerrm); end;
  perform pg_temp.act(null);
  begin insert into public.card_redemptions (card_id, order_id, user_id, discount_percent, amount_cents) values (card_ids[1], ord.id, c1, 10, 100);
    perform pg_temp.ok('database refuses a second live redemption of one card', false);
  exception when unique_violation then perform pg_temp.ok('database refuses a second live redemption of one card', true, sqlerrm); end;

  -- 12. Existing checkout still works with the old call (no cards)
  perform pg_temp.act(c1);
  perform public.add_to_cart(pid, 2);
  ord := public.place_order(ship);
  perform pg_temp.ok('cart checkout total = subtotal + shipping', ord.total_cents = 2300 and ord.discount_cents = 0, ord.total_cents::text);

  -- 13. Customer wallet and admin views
  j := public.my_rewards();
  perform pg_temp.ok('my_rewards: progress and cards', (j->>'completed_orders')::int = 5 and (j->'next'->>'orders_required')::int = 8
    and (j->'next'->>'remaining')::int = 3 and jsonb_array_length(j->'cards') = 3, left(j::text, 300));
  perform pg_temp.act(a1);
  j := public.admin_reward_stats();
  perform pg_temp.ok('admin analytics', (j->>'issued')::int = 5 and (j->>'gifted')::int = 1 and (j->>'revoked')::int = 1 and (j->>'redeemed_cents')::int = 100,
    (j - 'recent')::text);
  perform pg_temp.ok('admin customer list', (select completed_orders = 5 and cards_total = 3 from public.admin_reward_customers() where id = c1));

  -- 14. Visitors
  perform pg_temp.anon();
  perform pg_temp.ok('visitors can read the rules', (select count(*) = 1 from public.reward_settings) and (select count(*) = 3 from public.reward_milestones));
  begin perform count(*) from public.discount_cards;
    perform pg_temp.ok('visitors cannot read cards', false);
  exception when others then perform pg_temp.ok('visitors cannot read cards', true, sqlerrm); end;
  begin perform public.my_rewards();
    perform pg_temp.ok('visitors cannot call my_rewards', false);
  exception when others then perform pg_temp.ok('visitors cannot call my_rewards', true, sqlerrm); end;
  perform pg_temp.act(null);
end $$;

-- Report and roll everything back.
do $$
begin
  raise exception E'DISCOUNT CARD TEST (rolled back, nothing saved): % of % passed\n%',
    (select count(*) filter (where ok) from t), (select count(*) from t),
    (select string_agg(case when ok then 'PASS ' else 'FAIL ' end || step || coalesce('  [' || left(detail, 160) || ']', ''), E'\n' order by n) from t);
end $$;
