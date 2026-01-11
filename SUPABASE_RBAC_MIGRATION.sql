-- RBAC schema for GrandLink Admin Panel (Supabase/Postgres)
-- Apply in Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / drops only specific constraints when needed).

-- 1) Ensure admins.role supports all roles used by the app
-- NOTE: Your exported schema had role in ('superadmin','admin','manager')
-- but the UI also uses 'employee' in some places.
ALTER TABLE IF EXISTS public.admins
  DROP CONSTRAINT IF EXISTS admins_role_check;

ALTER TABLE IF EXISTS public.admins
  ADD CONSTRAINT admins_role_check
  CHECK (role = ANY (ARRAY['superadmin'::text, 'admin'::text, 'manager'::text, 'employee'::text]));

-- 2) RBAC tables: pages, positions, and assignments
CREATE TABLE IF NOT EXISTS public.rbac_pages (
  key text PRIMARY KEY,
  name text NOT NULL,
  path text NOT NULL UNIQUE,
  group_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rbac_positions (
  name text PRIMARY KEY,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rbac_position_pages (
  position_name text NOT NULL REFERENCES public.rbac_positions(name) ON DELETE CASCADE,
  page_key text NOT NULL REFERENCES public.rbac_pages(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (position_name, page_key)
);

-- 3) Seed pages (matches current sidebar routes)
INSERT INTO public.rbac_pages (key, name, path, group_name)
VALUES
  ('dashboard', 'Dashboard', '/dashboard', 'General'),
  ('announcement', 'Announcement', '/dashboard/announcement', 'General'),

  ('user_accounts', 'User Accounts', '/dashboard/user-accounts', 'Accounts'),
  ('employee_accounts', 'Employee Accounts', '/dashboard/admins', 'Accounts'),
  -- Capability-style permissions for /dashboard/admins actions (kept as unique paths)
  ('employee_accounts_edit', 'Employee Accounts - Edit', '/dashboard/admins#edit', 'Accounts'),
  ('employee_accounts_password', 'Employee Accounts - Change Password', '/dashboard/admins#password', 'Accounts'),

  ('reports', 'Reports', '/dashboard/reports', 'Reports'),

  ('update_products', 'Update Products', '/dashboard/UpdateProducts', 'Inventory'),
  ('add_products', 'Add Products', '/dashboard/products', 'Inventory'),
  ('inventory', 'Inventory', '/dashboard/inventory', 'Inventory'),
  ('discounts', 'Discounts', '/dashboard/discounts', 'Inventory'),

  ('assigned_task', 'Assigned Task', '/dashboard/task/assigntask', 'Task'),
  ('employee_task', 'Employee Task', '/dashboard/task/employeetask', 'Task'),
  ('admin_task', 'Admin Task', '/dashboard/task/admintask', 'Task'),

  ('order_management', 'Order Management', '/dashboard/order_management', 'Orders'),
  ('calendar', 'Calendar', '/dashboard/calendar', 'General'),
  ('inquiries', 'User Inquiries', '/dashboard/inquiries', 'General'),
  ('inquiries_editor', 'Inquire Page Editor', '/dashboard/inquiries/editor', 'Content'),

  ('home_page', 'Home', '/dashboard/pages/home', 'Content'),
  ('about_page', 'About Us', '/dashboard/pages/about', 'Content'),
  ('showroom_page', 'Showrooms', '/dashboard/pages/showroom', 'Content'),
  ('services_page', 'Services We Offer', '/dashboard/pages/Service', 'Content'),
  ('featured_page', 'Featured Projects', '/dashboard/pages/Featured', 'Content'),
  ('delivery_process_page', 'Delivery & Ordering Process', '/dashboard/pages/DeliveryProcess', 'Content'),
  ('faqs_page', 'FAQs', '/dashboard/pages/FAQs', 'Content'),

  ('settings', 'Settings', '/dashboard/settings', 'Settings'),
  ('audit', 'Audit', '/dashboard/settings/audit', 'Settings'),
  ('roles', 'Roles & Permissions', '/dashboard/settings/roles', 'Settings')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  path = EXCLUDED.path,
  group_name = EXCLUDED.group_name;

-- 4) Seed default positions (matching existing admin.position constraint)
INSERT INTO public.rbac_positions (name)
VALUES
  ('Sales Manager'),
  ('Site Manager'),
  ('Media Handler'),
  ('Supervisor'),
  ('Employee'),
  ('Manager'),
  ('Admin'),
  ('Superadmin')
ON CONFLICT (name) DO NOTHING;

-- 5) Default access: give Superadmin position access to everything
INSERT INTO public.rbac_position_pages (position_name, page_key)
SELECT 'Superadmin', p.key
FROM public.rbac_pages p
ON CONFLICT (position_name, page_key) DO NOTHING;

-- Optional: you can create more defaults like Admin/Manager here if you want.
-- Example (uncomment to give Admin broad access):
-- INSERT INTO public.rbac_position_pages (position_name, page_key)
-- SELECT 'Admin', p.key FROM public.rbac_pages p
-- WHERE p.key IN ('dashboard','announcement','user_accounts','employee_accounts','reports','update_products','add_products','inventory','discounts','assigned_task','employee_task','admin_task','order_management','calendar','inquiries','inquiries_editor','home_page','about_page','showroom_page','services_page','featured_page','delivery_process_page','faqs_page','settings','audit','roles')
-- ON CONFLICT (position_name, page_key) DO NOTHING;
