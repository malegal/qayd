-- REVIEW ONLY: do not apply until approved.
-- Adds owner-visible member labels/device metadata and revocation cleanup.

create table if not exists public.office_member_devices (
  office_id text not null references public.offices(office_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_name text,
  platform text not null,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (office_id, user_id, device_id)
);

alter table public.office_member_devices enable row level security;

drop policy if exists office_member_devices_owner_read on public.office_member_devices;
create policy office_member_devices_owner_read on public.office_member_devices
  for select to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

drop policy if exists office_member_devices_own_write on public.office_member_devices;
create policy office_member_devices_own_write on public.office_member_devices
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_office_member(office_id));

create or replace function public.register_office_member_device(
  p_office_id text, p_device_id text, p_device_name text, p_platform text, p_app_version text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_office_member(p_office_id) then raise exception 'not authorized'; end if;
  insert into public.office_member_devices(office_id, user_id, device_id, device_name, platform, app_version, last_seen_at)
  values (p_office_id, auth.uid(), p_device_id, p_device_name, p_platform, p_app_version, now())
  on conflict (office_id, user_id, device_id) do update set
    device_name = excluded.device_name, platform = excluded.platform,
    app_version = excluded.app_version, last_seen_at = now();
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.register_office_member_device(text,text,text,text,text) from public;
grant execute on function public.register_office_member_device(text,text,text,text,text) to authenticated;

create or replace function public.rename_office_member(p_office_id text, p_user_id uuid, p_display_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_office_role(p_office_id, array['manager']::text[]) then raise exception 'owner only'; end if;
  update public.office_members set display_name = nullif(btrim(p_display_name), '')
    where office_id = p_office_id and user_id = p_user_id and role <> 'manager';
  if not found then raise exception 'member not found'; end if;
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.rename_office_member(text,uuid,text) from public;
grant execute on function public.rename_office_member(text,uuid,text) to authenticated;

create or replace function public.revoke_office_member(p_office_id text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_office_role(p_office_id, array['manager']::text[]) then raise exception 'owner only'; end if;
  if p_user_id = auth.uid() then raise exception 'owner cannot revoke self'; end if;
  delete from public.office_member_devices where office_id = p_office_id and user_id = p_user_id;
  delete from public.office_members where office_id = p_office_id and user_id = p_user_id;
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.revoke_office_member(text,uuid) from public;
grant execute on function public.revoke_office_member(text,uuid) to authenticated;
