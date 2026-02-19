-- sales_inventory_data (supports LSTM + analytics)
-- Paste into Supabase SQL Editor and run.

create extension if not exists "pgcrypto";

create table if not exists public.sales_inventory_data (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  month_start date not null,
  branch text not null default 'unknown',
  units_sold integer not null default 0,
  revenue numeric not null default 0,
  beginning_stock integer not null default 0,
  ending_stock integer not null default 0,
  source_order_count integer not null default 0,
  source_reservation_count integer not null default 0,
  source_user_items_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, month_start, branch)
);

create index if not exists sales_inventory_data_month_idx on public.sales_inventory_data(month_start desc);
create index if not exists sales_inventory_data_product_idx on public.sales_inventory_data(product_id);

-- keep updated_at current
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_sales_inventory_data_updated_at on public.sales_inventory_data;
create trigger set_sales_inventory_data_updated_at
before update on public.sales_inventory_data
for each row execute function public.set_updated_at();

-- Optional migration from old table name if it exists
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'sales_inventory_9months'
  ) then
    insert into public.sales_inventory_data (
      product_id,
      month_start,
      branch,
      units_sold,
      revenue,
      beginning_stock,
      ending_stock,
      source_order_count,
      source_reservation_count,
      source_user_items_count,
      created_at,
      updated_at
    )
    select
      s.product_id,
      s.month_start,
      s.branch,
      s.units_sold,
      s.revenue,
      coalesce((s.units_sold + coalesce(p.inventory, 0) - coalesce(p.reserved_stock, 0))::int, 0) as beginning_stock,
      coalesce((coalesce(p.inventory, 0) - coalesce(p.reserved_stock, 0))::int, 0) as ending_stock,
      0,
      0,
      0,
      s.created_at,
      s.updated_at
    from public.sales_inventory_9months s
    left join public.products p on p.id = s.product_id
    on conflict (product_id, month_start, branch) do update
    set
      units_sold = excluded.units_sold,
      revenue = excluded.revenue,
      beginning_stock = excluded.beginning_stock,
      ending_stock = excluded.ending_stock,
      updated_at = now();
  end if;
end $$;
