-- Quotations table (Admin Sales Management)
-- Paste into Supabase SQL Editor and run.

create extension if not exists "pgcrypto";

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,
  client_name text not null,
  client_email text,
  client_phone text,
  status text not null default 'draft' check (status in ('draft','sent','approved','rejected','expired')),
  currency text not null default 'PHP',
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  discount_value numeric not null default 0,
  total_amount numeric not null default 0,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotations_created_at_idx on public.quotations(created_at desc);

-- Optional trigger to keep updated_at current
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_quotations_updated_at on public.quotations;
create trigger set_quotations_updated_at
before update on public.quotations
for each row execute function public.set_updated_at();
