-- Admin image editor. Additive only.
-- scene: the product's homepage slide as edited in the admin (background + bottle and fruit
-- layers with positions, sizes, rotation and edit settings). Originals stay in Storage.
-- bg_image_url: optional background picture behind the product on shop cards and the slide.
alter table public.products add column if not exists scene jsonb;
alter table public.products add column if not exists bg_image_url text;
