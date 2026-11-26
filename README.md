# Blendy — Real fruit smoothies

React (Vite) version of the Blendy smoothie slider hero, with a Supabase backend and Vercel hosting.

## Features
**Store** (`/`): the original full-screen flavour slider is the homepage, unchanged apart from a Shop link. SHOP NOW opens the flavour on screen.
- `/shop` products from Supabase with categories, search, sort and an in-stock filter
- `/product/:slug` details, stock, quantity, add to cart
- `/cart` guest carts are kept in the browser and moved into the account at login
- `/checkout` delivery details, cash on delivery; `/order/:id` confirmation and status
- `/account` order history and profile; `/login`, `/register`, `/forgot-password`, `/reset-password`
- `/about`, `/contact` (messages go to the admin inbox)

**Admin** (`/admin`, separate bundle): dashboard (sales, orders, customers, products, low stock), orders and status updates, products (create, edit, delete, image upload), categories, inventory, customers and roles, contact messages, website settings.

## Backend (Supabase)
- `supabase/migrations/001_blendy_shop.sql`: products, carts, orders.
- `supabase/migrations/002_ecommerce.sql`: profiles with a `customer`/`admin` role, categories, product catalogue fields and stock, shipping details on orders, store settings, contact messages, the `product-images` storage bucket, admin dashboard functions.
- Row level security on every table. Admin rights come from `profiles.role` and are checked in the database (`is_admin()`), never in the browser. `place_order()` prices the cart from the database, checks and reduces stock; cancelling an order puts the stock back.
- `supabase/tests/002_security_test.sql`: runs a customer, an anonymous visitor and an admin through the rules with throwaway users, then removes them.

### Make someone an admin
They sign up on the site first, then run this in the Supabase SQL editor:
```sql
update public.profiles set role = 'admin' where email = 'owner@example.com';
```
After that, admins can promote others from Admin > Customers.

## Environment variables
Copy `.env.example` to `.env.local` for local work, and set the same two in Vercel:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable (anon) key |

Never put the secret / service-role key in this app.

## Run locally
```bash
npm install
npm run dev
```

## Deploy
Vercel detects Vite automatically: build command `npm run build`, output `dist`.
After the first deploy, set Supabase > Authentication > URL Configuration > Site URL to the live URL.
