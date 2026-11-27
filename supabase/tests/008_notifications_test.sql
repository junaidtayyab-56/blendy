-- Flow + security test for 008_notifications.sql.
-- Everything runs inside one transaction that is ALWAYS rolled back: the last step raises
-- an error whose message is the test report, so no test user, order, card, notification or
-- email request is kept (pg_net's request queue is a normal table, so queued test requests
-- are rolled back too and no real email is sent).
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
-- Email requests queued for one order (pg_net request queue).
create function pg_temp.calls(p_order uuid) returns integer language sql security definer as $$
  select count(*)::int from net.http_request_queue
  where url like '%/functions/v1/order-email' and convert_from(body, 'utf8')::jsonb->>'order_id' = p_order::text;
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;

do $$
declare
  c1 uuid := '00000000-0000-4000-a000-00000000c801';
  c2 uuid := '00000000-0000-4000-a000-00000000c802';
  a1 uuid := '00000000-0000-4000-a000-00000000a801';
  ship jsonb := '{"name":"Notify Tester","phone":"0300 1234567","address":"1 Fruit St","city":"Lahore","country":"Pakistan"}';
  pid uuid;
  o uuid;
  o2 uuid;
  card uuid;
  nid uuid;
  ev bigint;
  n integer;
  v text;
  r record;
begin
  -- Setup (as the project owner)
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (c1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notify-c1@blendy.test', '{}', now(), now()),
    (c2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notify-c2@blendy.test', '{}', now(), now()),
    (a1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notify-admin@blendy.test', '{}', now(), now());
  insert into public.profiles (id, email) values (c1, 'notify-c1@blendy.test'), (c2, 'notify-c2@blendy.test'), (a1, 'notify-admin@blendy.test')
    on conflict (id) do nothing;
  update public.profiles set role = 'admin' where id = a1;
  update public.reward_settings set discount_percent = 10, auto_issue = true, require_positive_feedback = false, expiry_days = null where id;
  delete from public.reward_milestones;
  insert into public.reward_milestones (orders_required, cards_awarded) values (1, 1);
  insert into public.products (slug, name, price_cents, stock, active) values ('notify-test', 'Notify Test', 1000, 500, true) returning id into pid;

  -- 1. Settings are admin-only
  perform pg_temp.act(a1);
  update public.notification_settings set admin_email = 'owner@blendy.test', order_emails_enabled = true where id;
  perform pg_temp.ok('admin can set the notification email', (select admin_email = 'owner@blendy.test' from public.notification_settings));
  begin update public.notification_settings set function_url = 'https://evil.test' where id;
    perform pg_temp.ok('admin cannot change the function address', false);
  exception when others then perform pg_temp.ok('admin cannot change the function address', true, sqlerrm); end;
  begin update public.notification_settings set admin_email = 'not an email' where id;
    perform pg_temp.ok('invalid email rejected', false);
  exception when others then perform pg_temp.ok('invalid email rejected', true, sqlerrm); end;
  perform pg_temp.act(c1);
  perform pg_temp.ok('customer cannot read notification settings', (select count(*) = 0 from public.notification_settings));
  update public.notification_settings set admin_email = 'thief@blendy.test' where id;
  perform pg_temp.act(null);
  perform pg_temp.ok('customer cannot change the notification email', (select admin_email = 'owner@blendy.test' from public.notification_settings));

  -- 2. Order email queued once per order, for cart checkout and buy now
  perform pg_temp.act(c1);
  perform public.add_to_cart(pid, 2);
  o := (public.place_order(ship)).id;
  perform pg_temp.act(null);
  perform pg_temp.ok('checkout queues one admin email', (select count(*) = 1 and bool_and(status = 'pending' and recipient = 'owner@blendy.test')
    from public.admin_order_emails where order_id = o) and pg_temp.calls(o) = 1, 'requests: ' || pg_temp.calls(o));
  perform pg_temp.act(c1);
  o2 := (public.buy_now(pid, 1, ship)).id;
  perform pg_temp.act(null);
  perform pg_temp.ok('buy now queues one admin email', (select count(*) = 1 from public.admin_order_emails where order_id = o2 and status = 'pending') and pg_temp.calls(o2) = 1);

  -- 3. Duplicate prevention
  perform pg_temp.act(a1);
  update public.orders set status = 'preparing' where id = o;
  perform pg_temp.act(null);
  perform pg_temp.ok('updating an order does not queue another email', pg_temp.calls(o) = 1 and (select count(*) = 1 from public.admin_order_emails where order_id = o));
  begin
    insert into public.admin_order_emails (order_id) values (o);
    perform pg_temp.ok('second email row for an order is impossible', false);
  exception when unique_violation then perform pg_temp.ok('second email row for an order is impossible', true, sqlerrm); end;
  perform pg_temp.act(a1);
  v := public.admin_retry_order_email(o);
  perform pg_temp.ok('retry while pending does nothing', v = 'pending' and pg_temp.calls(o) = 1, v);
  perform pg_temp.act(null);
  -- What the Edge Function does: claim, then finish
  perform set_config('role', 'service_role', true);
  v := (public.claim_order_email(o)).status;
  n := coalesce((public.claim_order_email(o)).attempts, -1);
  perform public.finish_order_email(o, true, 'owner@blendy.test');
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('email can be claimed once', v = 'sending' and n = -1, v || ' / ' || n);
  perform pg_temp.ok('finished email marked sent', (select status = 'sent' and sent_at is not null and attempts = 1 from public.admin_order_emails where order_id = o));
  perform pg_temp.act(a1);
  v := public.admin_retry_order_email(o);
  perform pg_temp.ok('retry after sent does not resend', v = 'sent' and pg_temp.calls(o) = 1, v);
  v := public.admin_retry_order_email(o, true);
  perform pg_temp.ok('admin can force a resend', v = 'pending' and pg_temp.calls(o) = 2, v);
  perform pg_temp.act(null);
  update public.admin_order_emails set status = 'failed', last_error = 'test' where order_id = o2;
  perform pg_temp.act(a1);
  v := public.admin_retry_order_email(o2);
  perform pg_temp.ok('failed email can be retried', v = 'pending' and pg_temp.calls(o2) = 2 and (select last_error is null from public.admin_order_emails where order_id = o2), v);
  perform pg_temp.ok('admin email log lists orders', (select count(*) = 2 from public.admin_order_email_log(50) l where l.order_id in (o, o2) and l.email_status = 'pending'));

  -- 4. Emails turned off -> skipped, nothing sent
  update public.notification_settings set order_emails_enabled = false where id;
  perform pg_temp.act(c1);
  o2 := (public.buy_now(pid, 1, ship)).id;
  perform pg_temp.act(null);
  perform pg_temp.ok('emails off: order saved, email skipped, nothing sent', (select status = 'skipped' from public.admin_order_emails where order_id = o2) and pg_temp.calls(o2) = 0);
  update public.notification_settings set order_emails_enabled = true where id;

  -- 5. Customers cannot see or touch order emails
  perform pg_temp.act(c1);
  perform pg_temp.ok('customer cannot read order emails', (select count(*) = 0 from public.admin_order_emails));
  begin perform public.admin_order_email_log(10);
    perform pg_temp.ok('customer cannot read the email log', false);
  exception when others then perform pg_temp.ok('customer cannot read the email log', true, sqlerrm); end;
  begin perform public.admin_retry_order_email(o, true);
    perform pg_temp.ok('customer cannot resend emails', false);
  exception when others then perform pg_temp.ok('customer cannot resend emails', true, sqlerrm); end;
  begin perform public.request_order_email(o);
    perform pg_temp.ok('customer cannot call the email request helper', false);
  exception when others then perform pg_temp.ok('customer cannot call the email request helper', true, sqlerrm); end;
  begin perform public.claim_order_email(o);
    perform pg_temp.ok('customer cannot claim emails', false);
  exception when others then perform pg_temp.ok('customer cannot claim emails', true, sqlerrm); end;
  perform pg_temp.act(null);

  -- 6. Card notifications: milestone card (order delivered) and gift
  perform pg_temp.act(a1);
  update public.orders set status = 'delivered' where id = o;
  perform pg_temp.act(null);
  select id into card from public.discount_cards where user_id = c1 and source = 'milestone' limit 1;
  perform pg_temp.ok('milestone card creates a notification', (select count(*) = 1 from public.notifications where user_id = c1 and kind = 'card_issued' and card_id = card
    and title = 'You earned a discount card' and body like 'Card BLD-%10% off%' and link = '/discount-cards?card=' || card and read_at is null),
    (select body from public.notifications where card_id = card));
  perform pg_temp.act(a1);
  perform public.admin_gift_cards(c1, 2, 'Thank you');
  perform pg_temp.act(null);
  perform pg_temp.ok('each gifted card creates a notification', (select count(*) = 2 from public.notifications where user_id = c1 and kind = 'card_gifted' and title = 'You received a gift card'));
  -- Same card event again (e.g. a re-run) must not duplicate the notification
  insert into public.card_events (card_id, user_id, event, note) values (card, c1, 'issued', 'repeat') returning id into ev;
  perform pg_temp.ok('no duplicate notification for the same card', (select count(*) = 1 from public.notifications where card_id = card));
  -- Other card events do not notify
  perform pg_temp.act(a1);
  perform public.admin_revoke_card(card, 'test');
  perform pg_temp.act(null);
  perform pg_temp.ok('revoking a card does not notify', (select count(*) = 3 from public.notifications where user_id = c1));

  -- 7. Customer-specific visibility and read/unread
  perform pg_temp.act(c1);
  perform pg_temp.ok('customer sees own notifications (3 unread)', (select count(*) = 3 and count(*) filter (where read_at is null) = 3 from public.notifications));
  select id into nid from public.notifications where card_id = card;
  perform pg_temp.act(c2);
  perform pg_temp.ok('other customer sees none of them', (select count(*) = 0 from public.notifications));
  n := public.mark_notifications_read(array[nid]);
  perform pg_temp.ok('other customer cannot mark them read', n = 0);
  begin update public.notifications set read_at = now() where id = nid;
  exception when others then null; end;
  perform pg_temp.act(null);
  perform pg_temp.ok('other customer direct update has no effect', (select read_at is null from public.notifications where id = nid));
  perform pg_temp.act(c1);
  begin update public.notifications set title = 'hacked' where id = nid;
    perform pg_temp.ok('customer cannot edit notifications', false);
  exception when others then perform pg_temp.ok('customer cannot edit notifications', true, sqlerrm); end;
  begin insert into public.notifications (user_id, kind, title, body, dedupe_key) values (c2, 'card_gifted', 'Fake', 'Fake', 'fake');
    perform pg_temp.ok('customer cannot create notifications', false);
  exception when others then perform pg_temp.ok('customer cannot create notifications', true, sqlerrm); end;
  begin delete from public.notifications where id = nid;
    perform pg_temp.ok('customer cannot delete notifications', false);
  exception when others then perform pg_temp.ok('customer cannot delete notifications', true, sqlerrm); end;
  n := public.mark_notifications_read(array[nid]);
  perform pg_temp.ok('mark one as read', n = 1 and (select count(*) = 2 from public.notifications where read_at is null));
  n := public.mark_notifications_read(array[nid]);
  perform pg_temp.ok('marking again changes nothing', n = 0);
  n := public.mark_notifications_read();
  perform pg_temp.ok('mark all as read', n = 2 and (select count(*) = 0 from public.notifications where read_at is null));
  perform pg_temp.act(null);

  -- 8. Admin activity view
  perform pg_temp.act(a1);
  perform pg_temp.ok('admin card activity shows events and read status',
    (select count(*) >= 4 from public.admin_card_activity(100) a where a.user_id = c1)
    and (select bool_and(a.read_at is not null) from public.admin_card_activity(100) a where a.user_id = c1 and a.event in ('issued', 'gifted') and a.note is distinct from 'repeat'));
  perform pg_temp.act(c1);
  begin perform public.admin_card_activity(10);
    perform pg_temp.ok('customer cannot read card activity', false);
  exception when others then perform pg_temp.ok('customer cannot read card activity', true, sqlerrm); end;

  -- 9. Visitors
  perform pg_temp.anon();
  begin perform count(*) from public.notifications;
    perform pg_temp.ok('visitors cannot read notifications', false);
  exception when others then perform pg_temp.ok('visitors cannot read notifications', true, sqlerrm); end;
  begin perform count(*) from public.notification_settings;
    perform pg_temp.ok('visitors cannot read notification settings', false);
  exception when others then perform pg_temp.ok('visitors cannot read notification settings', true, sqlerrm); end;
  begin perform public.mark_notifications_read();
    perform pg_temp.ok('visitors cannot mark notifications', false);
  exception when others then perform pg_temp.ok('visitors cannot mark notifications', true, sqlerrm); end;
  perform pg_temp.act(null);

  -- 10. Live updates switched on for the bell
  perform pg_temp.ok('realtime enabled for notifications', exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'));
end $$;

-- Report and roll everything back.
do $$
begin
  raise exception E'NOTIFICATIONS TEST (rolled back, nothing saved): % of % passed\n%',
    (select count(*) filter (where ok) from t), (select count(*) from t),
    (select string_agg(case when ok then 'PASS ' else 'FAIL ' end || step || coalesce('  [' || left(detail, 160) || ']', ''), E'\n' order by n) from t);
end $$;
