-- Optional RBAC helper: add Sales pages so authorized admins can access them.
-- Run in Supabase SQL editor if you use the rbac/pages + allowed-pages tables.
-- Safe to re-run (uses ON CONFLICT).

-- Pages table name varies by project; in this repo the API routes are under /api/rbac/pages.
-- If your table name/columns differ, adjust accordingly.

insert into public.pages (name, path)
values
  ('Sales', '/dashboard/sales'),
  ('Invoices', '/dashboard/sales/invoices'),
  ('Quotations', '/dashboard/sales/quotations'),
  ('Sales Forecasting', '/dashboard/sales-forecasting')
on conflict (path) do update set name = excluded.name;
