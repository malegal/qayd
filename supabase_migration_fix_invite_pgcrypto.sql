-- Fix office invite generation on Supabase projects where pgcrypto is installed in extensions schema.
-- Also prevent unauthenticated callers from invoking an owner-only function.
create or replace function public.create_office_invite(
  p_office_id text,
  p_contact text,
  p_role text,
  p_expires_hours integer default 168
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_code text;
  v_hash text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_office_role(p_office_id, array['manager']::text[]) then
    raise exception 'owner only';
  end if;
  if p_role not in ('lawyer', 'staff', 'accountant') then
    raise exception 'invalid role';
  end if;
  if nullif(trim(p_contact), '') is null then
    raise exception 'contact is required';
  end if;

  v_code := 'QYD-' || upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 4))
    || '-' || upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 4));
  v_hash := encode(extensions.digest(v_code, 'sha256'), 'hex');

  insert into public.office_invites(
    office_id, invited_contact, role, code_hash, expires_at, created_by
  ) values (
    p_office_id, trim(p_contact), p_role, v_hash,
    now() + make_interval(hours => greatest(1, least(p_expires_hours, 720))),
    auth.uid()
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'code', v_code,
    'role', p_role,
    'expires_at', now() + make_interval(hours => greatest(1, least(p_expires_hours, 720)))
  );
end;
$function$;

revoke execute on function public.create_office_invite(text, text, text, integer) from anon;
grant execute on function public.create_office_invite(text, text, text, integer) to authenticated;
