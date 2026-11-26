-- Up to 4 different fruit pictures per product for the homepage slider. Additive only.
alter table public.products add column if not exists hero_fruits text[] not null default '{}';
update public.products set hero_fruits = array[hero_fruit_url]
where hero_fruit_url is not null and hero_fruit_url <> '' and cardinality(hero_fruits) = 0;
