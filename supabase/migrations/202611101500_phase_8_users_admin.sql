-- Phase 8 polish: user admin.
--   • profiles.active so admins can deactivate without deleting.
--   • staff_profiles view exposes email so UI dropdowns can fall back
--     from full_name → email (never "—").
--   • seed existing operator's full_name.

alter table profiles
  add column if not exists active boolean not null default true;

-- Expose email via a view; PostgREST cannot read auth.users directly.
create or replace view staff_profiles as
select p.id,
       p.user_id,
       p.full_name,
       p.role,
       p.active,
       p.created_at,
       p.updated_at,
       u.email
  from profiles p
  left join auth.users u on u.id = p.user_id;

grant select on staff_profiles to authenticated;

-- Set my full_name — requested by operator.
update profiles p
   set full_name = 'Elliot Humble', updated_at = now()
  from auth.users u
 where u.id = p.user_id
   and lower(u.email) = 'elliot.humble@gmail.com'
   and (p.full_name is null or p.full_name = '');
