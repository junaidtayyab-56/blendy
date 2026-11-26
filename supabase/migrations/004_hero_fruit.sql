-- Optional fruit picture that floats around a product's bottle in the homepage slider. Additive only.
alter table public.products add column if not exists hero_fruit_url text;
