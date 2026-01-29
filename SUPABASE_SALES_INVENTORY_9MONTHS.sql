-- sales_inventory_9months (supports LSTM + analytics)
-- Paste into Supabase SQL Editor and run.

create extension if not exists "pgcrypto";

create table if not exists public.sales_inventory_9months (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  month_start date not null,
  branch text not null default 'unknown',
  units_sold integer not null default 0,
  revenue numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, month_start, branch)
);

create index if not exists sales_inventory_9months_month_idx on public.sales_inventory_9months(month_start desc);
create index if not exists sales_inventory_9months_product_idx on public.sales_inventory_9months(product_id);

-- keep updated_at current
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_sales_inventory_9months_updated_at on public.sales_inventory_9months;
create trigger set_sales_inventory_9months_updated_at
before update on public.sales_inventory_9months
for each row execute function public.set_updated_at();
