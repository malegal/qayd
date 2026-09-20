-- Safe cleanup for the current single-office deployment.
-- Keeps every manager/owner membership and removes only non-manager memberships.
-- Current verification showed zero non-manager memberships, so this is expected to affect 0 rows.

begin;

delete from public.office_member_devices d
using public.office_members m
where m.office_id = d.office_id
  and m.user_id = d.user_id
  and m.role <> 'manager';

delete from public.office_members
where role <> 'manager';

commit;

-- Verify the result:
-- select office_id, user_id, role, display_name from public.office_members order by created_at;
