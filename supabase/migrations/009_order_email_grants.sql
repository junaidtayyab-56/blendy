-- 009: let the order-email Edge Function (server role) read what an order email needs.
-- This project does not grant table access to service_role automatically, so without
-- this the function could not read the admin address or the order. Read-only, additive.
grant usage on schema public to service_role;
grant select on public.notification_settings, public.orders, public.order_items,
                public.store_settings, public.profiles to service_role;
