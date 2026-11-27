-- Notifications: order emails for the admin, and a notification bell for customers.
-- Additive only: no existing table, column, row or function is dropped or changed.
--
-- How it fits the existing store:
--   * Orders are only ever created by place_order() and buy_now(). Instead of editing those,
--     an AFTER INSERT trigger on orders queues one admin email per order. The email is sent
--     by the Supabase Edge Function "order-email" (server side; the email key or password is a
--     Supabase secret and is never in the website or this file).
--   * Every card the store gives out already writes a card_events row ('issued' for
--     milestone cards, 'gifted' for admin gifts). An AFTER INSERT trigger there creates the
--     customer's notification.
--   * The admin notification email lives in its own admin-only table, because
--     store_settings can be read by every visitor.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.notification_settings (
  id boolean primary key default true check (id),
  admin_email text check (admin_email is null or (char_length(admin_email) <= 254 and admin_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  order_emails_enabled boolean not null default true,
  -- Where the database sends "please email this order". Not shown in the admin panel.
  function_url text not null default 'https://ynxcutvsqfziuceqlhog.supabase.co/functions/v1/order-email',
  updated_at timestamptz not null default now()
);
-- Start with the first admin's email; the admin can change it in Admin > Notifications.
insert into public.notification_settings (id, admin_email)
values (true, (select email from public.profiles where role = 'admin' and email is not null order by created_at limit 1))
on conflict (id) do nothing;

-- One row per order, ever (unique order_id): this is what prevents duplicate emails.
create table if not exists public.admin_order_emails (
  id bigint generated always as identity primary key,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  recipient text,
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_order_emails_created_idx on public.admin_order_emails(created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('card_issued', 'card_gifted')),
  title text not null,
  body text not null,
  link text,
  card_id uuid references public.discount_cards(id) on delete cascade,
  -- One notification per event, ever (e.g. 'card:<card id>').
  dedupe_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications(user_id) where read_at is null;

drop trigger if exists notification_settings_touch on public.notification_settings;
create trigger notification_settings_touch before update on public.notification_settings
  for each row execute function public.touch_updated_at();
drop trigger if exists admin_order_emails_touch on public.admin_order_emails;
create trigger admin_order_emails_touch before update on public.admin_order_emails
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.notification_settings enable row level security;
alter table public.admin_order_emails enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Notification settings: admin read" on public.notification_settings;
create policy "Notification settings: admin read" on public.notification_settings
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Notification settings: admin update" on public.notification_settings;
create policy "Notification settings: admin update" on public.notification_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Order emails: admin read" on public.admin_order_emails;
create policy "Order emails: admin read" on public.admin_order_emails
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Notifications: read own or admin" on public.notifications;
create policy "Notifications: read own or admin" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Customers and admins never write these tables directly; writes go through the
-- functions below (or the Edge Function's server key). Admins may edit two settings columns.
revoke all on public.notification_settings from anon, authenticated;
revoke all on public.admin_order_emails from anon, authenticated;
revoke all on public.notifications from anon, authenticated;
grant select on public.notification_settings to authenticated;
grant update (admin_email, order_emails_enabled) on public.notification_settings to authenticated;
grant select on public.admin_order_emails to authenticated;
grant select on public.notifications to authenticated;

-- Live updates for the bell. Realtime applies the same read policy, so a customer only
-- ever receives their own rows.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Order emails
-- ---------------------------------------------------------------------------
-- Ask the Edge Function to send the email for one order. pg_net only sends the request
-- after the transaction commits, so a failed checkout never emails. Never raises.
create or replace function public.request_order_email(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select function_url into v_url from public.notification_settings where id;
  if v_url is null then return; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('order_id', p_order),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'request_order_email(%) failed: %', p_order, sqlerrm;
end;
$$;

-- Queue the email when an order is saved. Never blocks or breaks the checkout.
create or replace function public.queue_order_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.notification_settings;
  v_status text := 'pending';
  v_error text;
begin
  begin
    select * into s from public.notification_settings where id;
    if s.id is null or not s.order_emails_enabled then
      v_status := 'skipped'; v_error := 'Order emails were turned off';
    elsif s.admin_email is null then
      v_status := 'skipped'; v_error := 'No admin email address was set';
    end if;

    insert into public.admin_order_emails (order_id, status, recipient, last_error)
    values (new.id, v_status, s.admin_email, v_error)
    on conflict (order_id) do nothing;

    if found and v_status = 'pending' then
      perform public.request_order_email(new.id);
    end if;
  exception when others then
    raise warning 'queue_order_email(%) failed: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists orders_queue_email on public.orders;
create trigger orders_queue_email after insert on public.orders
  for each row execute function public.queue_order_email();

-- Admin: send an order's email again (after a failure, or for an older order).
-- Sent emails are only re-sent when p_force is true, so a double click can't duplicate.
create or replace function public.admin_retry_order_email(p_order uuid, p_force boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_row public.admin_order_emails;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if not exists (select 1 from public.orders where id = p_order) then raise exception 'Order not found'; end if;
  select admin_email into v_email from public.notification_settings where id;
  if v_email is null then raise exception 'Set the admin notification email first'; end if;

  insert into public.admin_order_emails (order_id, status, recipient)
  values (p_order, 'pending', v_email)
  on conflict (order_id) do update
    set status = 'pending', recipient = excluded.recipient, last_error = null, claimed_at = null
    where public.admin_order_emails.status in ('failed', 'skipped')
       or (public.admin_order_emails.status = 'sending' and public.admin_order_emails.claimed_at < now() - interval '5 minutes')
       or (public.admin_order_emails.status = 'sent' and p_force)
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.admin_order_emails where order_id = p_order;
    return v_row.status;  -- already pending / sending / sent: nothing to do
  end if;
  perform public.request_order_email(p_order);
  return 'pending';
end;
$$;

-- Used only by the Edge Function (server key): take a pending email so that two
-- deliveries of the same request can never both send it.
create or replace function public.claim_order_email(p_order uuid)
returns public.admin_order_emails
language sql
security definer
set search_path = ''
as $$
  update public.admin_order_emails
     set status = 'sending', attempts = attempts + 1, claimed_at = now(), last_error = null
   where order_id = p_order and status = 'pending'
  returning *;
$$;

create or replace function public.finish_order_email(p_order uuid, p_ok boolean, p_recipient text, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.admin_order_emails
     set status = case when p_ok then 'sent' else 'failed' end,
         recipient = coalesce(p_recipient, recipient),
         sent_at = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(p_error, 1000) end
   where order_id = p_order and status = 'sending';
$$;

-- Admin: recent orders with their email status (older orders show status null).
create or replace function public.admin_order_email_log(p_limit integer default 100)
returns table (order_id uuid, order_number bigint, created_at timestamptz, customer text, email text,
               total_cents integer, currency text, order_status text,
               email_status text, recipient text, attempts integer, last_error text, sent_at timestamptz, queued_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select o.id, o.order_number, o.created_at, o.shipping_name, o.email, o.total_cents, o.currency, o.status,
         e.status, e.recipient, e.attempts, e.last_error, e.sent_at, e.created_at
  from public.orders o
  left join public.admin_order_emails e on e.order_id = o.id
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer notifications
-- ---------------------------------------------------------------------------
create or replace function public.notify_card_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.discount_cards;
  v_pct numeric;
  v_pct_text text;
  v_body text;
begin
  if new.event not in ('issued', 'gifted') then return null; end if;
  begin
    select * into c from public.discount_cards where id = new.card_id;
    select discount_percent into v_pct from public.reward_settings where id;
    v_pct_text := case when v_pct is null then '' else trim(trailing '.' from trim(trailing '0' from v_pct::text)) || '% off' end;
    v_body := 'Card ' || c.code || case when v_pct_text <> '' then ' gives you ' || v_pct_text || ' your next order' else ' is ready to use' end
              || case when c.expires_at is not null then '. Use it by ' || to_char(c.expires_at at time zone 'UTC', 'DD Mon YYYY') else '' end
              || '.';

    insert into public.notifications (user_id, kind, title, body, link, card_id, dedupe_key)
    values (new.user_id,
            case when new.event = 'gifted' then 'card_gifted' else 'card_issued' end,
            case when new.event = 'gifted' then 'You received a gift card'
                 else 'You earned a discount card' end,
            v_body,
            '/discount-cards?card=' || new.card_id,
            new.card_id,
            'card:' || new.card_id)
    on conflict (dedupe_key) do nothing;
  exception when others then
    raise warning 'notify_card_event(%) failed: %', new.card_id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists card_events_notify on public.card_events;
create trigger card_events_notify after insert on public.card_events
  for each row execute function public.notify_card_event();

-- Customer: mark some (p_ids) or all (null) of their own notifications as read.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Admin: recent card activity, with whether the customer has read the notification.
create or replace function public.admin_card_activity(p_limit integer default 100)
returns table (id bigint, created_at timestamptz, event text, card_id uuid, code text, user_id uuid, customer_email text,
               customer_name text, order_id uuid, note text, notified_at timestamptz, read_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select ev.id, ev.created_at, ev.event, ev.card_id, dc.code, ev.user_id, p.email, p.full_name,
         ev.order_id, ev.note, n.created_at, n.read_at
  from public.card_events ev
  join public.discount_cards dc on dc.id = ev.card_id
  left join public.profiles p on p.id = ev.user_id
  left join public.notifications n on n.dedupe_key = 'card:' || ev.card_id and ev.event in ('issued', 'gifted')
  order by ev.created_at desc, ev.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges (Supabase grants execute on new functions to anon and
-- authenticated by default, so internal helpers are revoked explicitly).
-- ---------------------------------------------------------------------------
revoke all on function public.request_order_email(uuid) from public, anon, authenticated;
revoke all on function public.queue_order_email() from public, anon, authenticated;
revoke all on function public.notify_card_event() from public, anon, authenticated;
revoke all on function public.claim_order_email(uuid) from public, anon, authenticated;
revoke all on function public.finish_order_email(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.claim_order_email(uuid) to service_role;
grant execute on function public.finish_order_email(uuid, boolean, text, text) to service_role;
revoke all on function public.admin_retry_order_email(uuid, boolean) from public, anon;
revoke all on function public.admin_order_email_log(integer) from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.admin_card_activity(integer) from public, anon;
grant execute on function public.admin_retry_order_email(uuid, boolean) to authenticated;
grant execute on function public.admin_order_email_log(integer) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.admin_card_activity(integer) to authenticated;
