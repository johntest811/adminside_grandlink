-- Fix for: Error: new row for relation "admins" violates check constraint "admins_position_check"
--
-- This error is raised by a PostgreSQL CHECK constraint on `public.admins.position`.
-- If you are using dynamic employee positions (e.g. Lead Welder, Helper Welder, etc.)
-- or RBAC-driven positions, that constraint will block inserts/updates.
--
-- Run this in Supabase SQL Editor (or via migration) on the same project.

begin;

-- Option A (recommended for flexibility): drop the constraint so `position` can be any text.
alter table public.admins
  drop constraint if exists admins_position_check;

-- If you prefer a stricter rule, replace Option A with a new constraint that matches
-- your real allowed positions, e.g.:
-- alter table public.admins
--   add constraint admins_position_check check (
--     position is null or position in (
--       'Sales Manager','Site Manager','Media Handler','Supervisor','Manager','Admin','Superadmin',
--       'Lead Welder','Helper Welder','Sealant Applicator','Repair Staff'
--     )
--   );

commit;
