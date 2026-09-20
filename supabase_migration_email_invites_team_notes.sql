-- Email-link invitations, internal team notes, and owner/team RLS model.
-- Project: qayd (single-office deployment)
-- This migration intentionally does not delete any office member.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Email-link invitations
-- -----------------------------------------------------------------------------
alter table public.office_invites
  add column if not exists invited_display_name text,
  add column if not exists token_hash text,
  add column if not exists accepted_by uuid references auth.users(id),
  add column if not exists accepted_at timestamptz;

create unique index if not exists office_invites_token_hash_uidx
  on public.office_invites(token_hash)
  where token_hash is not null;

create index if not exists office_invites_pending_contact_idx
  on public.office_invites(lower(invited_contact), expires_at)
  where used_at is null and revoked_at is null;

create or replace function public.create_email_invite(
  p_office_id text,
  p_contact text,
  p_role text,
  p_display_name text default null,
  p_expires_hours integer default 168
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash text := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_invite public.office_invites;
begin
  if auth.uid() is null or not public.has_office_role(p_office_id, array['manager']::text[]) then
    raise exception 'owner only';
  end if;
  if lower(trim(coalesce(p_contact, ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'a valid email is required';
  end if;
  if p_role not in ('lawyer', 'staff', 'accountant') then
    raise exception 'invalid team role';
  end if;
  if p_expires_hours < 1 or p_expires_hours > 720 then
    raise exception 'invalid expiry';
  end if;

  insert into public.office_invites
    (office_id, invited_contact, role, code_hash, token_hash, invited_display_name,
     expires_at, created_by)
  values
    (p_office_id, lower(trim(p_contact)), p_role, v_hash, v_hash,
     nullif(btrim(p_display_name), ''), now() + make_interval(hours => p_expires_hours), auth.uid())
  returning * into v_invite;

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'token', v_token,
    'role', v_invite.role,
    'email', v_invite.invited_contact,
    'display_name', v_invite.invited_display_name,
    'expires_at', v_invite.expires_at
  );
end;
$$;

create or replace function public.accept_email_invite(
  p_token text,
  p_display_name text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_invite public.office_invites;
  v_name text;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if length(coalesce(p_token, '')) < 32 then raise exception 'invalid invitation'; end if;

  select * into v_invite
  from public.office_invites
  where token_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex')
    and used_at is null
    and revoked_at is null
    and expires_at > now()
    and lower(invited_contact) = v_email
  for update;

  if not found then raise exception 'invitation is invalid, expired, revoked, or email does not match'; end if;
  v_name := coalesce(nullif(btrim(p_display_name), ''), v_invite.invited_display_name, v_email);

  insert into public.office_members (office_id, user_id, role, display_name)
  values (v_invite.office_id, v_user_id, v_invite.role, v_name)
  on conflict (office_id, user_id) do update
    set role = excluded.role, display_name = excluded.display_name;

  update public.office_invites
     set used_at = now(), accepted_at = now(), accepted_by = v_user_id
   where id = v_invite.id;

  return v_invite.office_id;
end;
$$;

revoke execute on function public.create_email_invite(text,text,text,text,integer) from public, anon;
revoke execute on function public.accept_email_invite(text,text) from public, anon;
grant execute on function public.create_email_invite(text,text,text,text,integer) to authenticated;
grant execute on function public.accept_email_invite(text,text) to authenticated;

-- Owner can inspect/revoke pending invitations; members cannot read invitation tokens.
drop policy if exists office_invites_manager_read on public.office_invites;
drop policy if exists office_invites_manager_update on public.office_invites;
create policy office_invites_manager_read on public.office_invites
  for select to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));
create policy office_invites_manager_update on public.office_invites
  for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));

-- -----------------------------------------------------------------------------
-- 2. Internal team notes
-- -----------------------------------------------------------------------------
alter table public.notes
  add column if not exists case_id text references public.cases(id) on delete cascade,
  add column if not exists office_file_id text references public.office_files(id) on delete cascade,
  add column if not exists author_user_id uuid references auth.users(id),
  add column if not exists created_at timestamptz default now();

-- The old one-note-per-office unique constraint is incompatible with team notes.
alter table public.notes drop constraint if exists notes_office_id_key;
alter table public.notes drop constraint if exists notes_office_id_unique;
create index if not exists notes_office_created_idx on public.notes(office_id, created_at desc);
create index if not exists notes_case_created_idx on public.notes(case_id, created_at desc);

update public.notes
   set author_user_id = coalesce(author_user_id, (select user_id from public.office_members where office_id = notes.office_id and role = 'manager' limit 1)),
       created_at = coalesce(created_at, updated_at, now())
 where author_user_id is null or created_at is null;

-- Team members can add/read notes; only the owner can edit/delete them.
drop policy if exists notes_select_member on public.notes;
drop policy if exists notes_insert_member on public.notes;
drop policy if exists notes_update_member on public.notes;
drop policy if exists notes_delete_manager on public.notes;
create policy notes_select_member on public.notes
  for select to authenticated using (public.is_office_member(office_id));
create policy notes_insert_member on public.notes
  for insert to authenticated
  with check (public.is_office_member(office_id) and author_user_id = auth.uid());
create policy notes_update_manager on public.notes
  for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy notes_delete_manager on public.notes
  for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

-- -----------------------------------------------------------------------------
-- 3. Single-office owner/team permissions
-- -----------------------------------------------------------------------------
-- Cases/files remain readable by members; only manager mutates them.
drop policy if exists cases_member_insert on public.cases;
create policy cases_owner_insert on public.cases
  for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));

-- Team can add sessions/tasks, but cannot edit/delete historical records.
drop policy if exists sessions_insert_operational on public.sessions;
drop policy if exists tasks_insert_operational on public.tasks;
drop policy if exists sessions_owner_update on public.sessions;
drop policy if exists sessions_owner_delete on public.sessions;
drop policy if exists tasks_owner_update on public.tasks;
drop policy if exists tasks_owner_delete on public.tasks;
create policy sessions_insert_operational on public.sessions
  for insert to authenticated
  with check (public.has_office_role(office_id, array['manager','lawyer','staff']::text[]));
create policy sessions_owner_update on public.sessions
  for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy sessions_owner_delete on public.sessions
  for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));
create policy tasks_insert_operational on public.tasks
  for insert to authenticated
  with check (public.has_office_role(office_id, array['manager','lawyer','staff']::text[]));
create policy tasks_owner_update on public.tasks
  for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy tasks_owner_delete on public.tasks
  for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

-- Team may insert expenses only. Financial visibility remains owner-only.
drop policy if exists expenses_select_member on public.expenses;
drop policy if exists expenses_update_member on public.expenses;
drop policy if exists expenses_delete_manager on public.expenses;
create policy expenses_select_manager on public.expenses
  for select to authenticated using (public.has_office_role(office_id, array['manager']::text[]));
create policy expenses_insert_team on public.expenses
  for insert to authenticated
  with check (public.is_office_member(office_id));
create policy expenses_update_manager on public.expenses
  for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy expenses_delete_manager on public.expenses
  for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

-- Fees/payments are owner-only. Team must never receive these rows from the API.
drop policy if exists fees_member_insert on public.fees;
drop policy if exists fees_select_internal on public.fees;
create policy fees_owner_select on public.fees
  for select to authenticated using (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager']::text[])));
create policy fees_owner_insert on public.fees
  for insert to authenticated with check (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager']::text[])));

drop policy if exists payments_select_internal on public.payments;
drop policy if exists payments_accounting_insert on public.payments;
create policy payments_owner_select on public.payments
  for select to authenticated using (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager']::text[])));
create policy payments_owner_insert on public.payments
  for insert to authenticated with check (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager']::text[])));

-- Only manager can read or mutate the financial ledger; team can only create expenses.
drop policy if exists financial_transactions_select_internal on public.financial_transactions;
drop policy if exists financial_transactions_insert_internal on public.financial_transactions;
create policy financial_transactions_owner_select on public.financial_transactions
  for select to authenticated using (public.has_office_role(office_id, array['manager']::text[]));
create policy financial_transactions_expense_insert on public.financial_transactions
  for insert to authenticated
  with check (public.is_office_member(office_id) and transaction_type = 'expense');

-- Events and professional files are managed from the owner desktop; phone is read-only for them.
drop policy if exists events_insert_member on public.events;
drop policy if exists events_update_member on public.events;
create policy events_owner_insert on public.events
  for insert to authenticated with check (public.has_office_role(office_id, array['manager']::text[]));
create policy events_owner_update on public.events
  for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy events_owner_delete on public.events
  for delete to authenticated using (public.has_office_role(office_id, array['manager']::text[]));
drop policy if exists office_files_insert_member on public.office_files;
create policy office_files_owner_insert on public.office_files
  for insert to authenticated with check (public.has_office_role(office_id, array['manager']::text[]));

-- Activity is owner-only; notes and operational inserts are covered by existing triggers.
revoke all on function public.record_office_activity() from public, anon;

-- -----------------------------------------------------------------------------
-- 4. Revoke stale pending invitations without touching office_members.
-- -----------------------------------------------------------------------------
update public.office_invites
   set revoked_at = now()
 where used_at is null
   and revoked_at is null;

-- Cleanup verification query (run separately after applying):
-- select office_id, user_id, role, display_name from public.office_members order by created_at;
-- select count(*) as pending_invites from public.office_invites where used_at is null and revoked_at is null;
