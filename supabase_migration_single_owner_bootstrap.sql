-- Single-office owner bootstrap for Qayd.
-- Does not delete or reset any business data.

begin;

create or replace function public.bootstrap_owner_membership(p_office_id text)
returns public.office_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_email text;
  v_member public.office_members;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select lower(trim(o.email)) into v_owner_email
  from public.offices o
  where o.office_id = p_office_id
  limit 1;

  if v_owner_email is null then
    raise exception 'office owner email is not configured';
  end if;

  if lower(trim(coalesce((select u.email from auth.users u where u.id = auth.uid()), ''))) <> v_owner_email then
    raise exception 'owner identity does not match office email';
  end if;

  insert into public.office_members (user_id, office_id, role, display_name)
  values (auth.uid(), p_office_id, 'manager', 'مكتب جاد الرب للمحاماة والاستشارات القانونية')
  on conflict (user_id, office_id) do update
    set role = 'manager',
        display_name = coalesce(nullif(public.office_members.display_name, ''), excluded.display_name)
  returning * into v_member;

  return v_member;
end;
$$;

revoke all on function public.bootstrap_owner_membership(text) from public, anon;
grant execute on function public.bootstrap_owner_membership(text) to authenticated;

commit;
