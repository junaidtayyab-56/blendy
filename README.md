# Blendy — Real fruit smoothies

React (Vite) version of the Blendy smoothie slider hero, with a Supabase backend and Vercel hosting.

## Features
- The original full-screen flavour slider: same layout, wipe transition, parallax, autoplay, swipe and keyboard controls.
- **Register / Log in** with Supabase Auth (email + password, email confirmation, password reset).
- **SHOP NOW** adds the flavour on screen to your cart (saved in Supabase, per user).
- **Cart** drawer: change quantities, remove items, place an order, and see past orders.

## Backend (Supabase)
Schema and security rules live in `supabase/migrations/001_blendy_shop.sql`:
- `products` (public read), `cart_items` (owner only), `orders` and `order_items` (owner read only).
- Row level security on every table; orders are created only by the `place_order()` function, which prices the cart from the database.
- Change prices in Supabase > Table Editor > products (`price_cents`, e.g. 499 = $4.99).

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
