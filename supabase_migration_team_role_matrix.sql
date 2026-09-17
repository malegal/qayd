-- Unified internal-office role matrix for desktop and mobile.
-- manager = owner, lawyer = lawyer, staff = secretary, accountant = accountant.
-- This migration is intentionally committed for the normal Supabase deployment path;
-- it is not applied automatically from the client.

create or replace function public.can_office_role(p_office_id text, p_roles text[])
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.office_members m
    where m.office_id = p_office_id
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

revoke execute on function public.can_office_role(text, text[]) from public;
grant execute on function public.can_office_role(text, text[]) to authenticated;

-- Every office member may read operational records. Financial amount tables are
-- restricted separately below. All UPDATE/DELETE paths are owner-only.

alter table if exists public.cases enable row level security;
alter table if exists public.sessions enable row level security;
alter table if exists public.tasks enable row level security;
alter table if exists public.events enable row level security;
alter table if exists public.office_files enable row level security;
alter table if exists public.fees enable row level security;
alter table if exists public.payments enable row level security;
alter table if exists public.financial_transactions enable row level security;

-- Remove the previously permissive policies shipped by the earlier role migration.
drop policy if exists sessions_select_member on public.sessions;
drop policy if exists sessions_insert_member on public.sessions;
drop policy if exists sessions_update_member on public.sessions;
drop policy if exists fees_select_internal on public.fees;
drop policy if exists fees_insert_internal on public.fees;
drop policy if exists fees_update_internal on public.fees;
drop policy if exists payments_select_internal on public.payments;
drop policy if exists payments_insert_internal on public.payments;
drop policy if exists payments_update_internal on public.payments;
drop policy if exists financial_transactions_select_internal on public.financial_transactions;
drop policy if exists financial_transactions_insert_internal on public.financial_transactions;
drop policy if exists financial_transactions_update_internal on public.financial_transactions;
drop policy if exists financial_transactions_delete_manager on public.financial_transactions;
drop policy if exists financial_transactions_select_member on public.financial_transactions;
drop policy if exists financial_transactions_insert_member on public.financial_transactions;
drop policy if exists financial_transactions_update_member on public.financial_transactions;

-- Owner is the only role allowed to modify or delete existing records.
create policy cases_owner_update on public.cases for update to authenticated
  using (public.can_office_role(office_id, array['manager']))
  with check (public.can_office_role(office_id, array['manager']));
create policy cases_owner_delete on public.cases for delete to authenticated
  using (public.can_office_role(office_id, array['manager']));

create policy sessions_select_member on public.sessions for select to authenticated
  using (public.is_office_member(office_id));
create policy sessions_insert_operational on public.sessions for insert to authenticated
  with check (public.can_office_role(office_id, array['manager','lawyer','staff']));
create policy sessions_owner_update on public.sessions for update to authenticated
  using (public.can_office_role(office_id, array['manager']))
  with check (public.can_office_role(office_id, array['manager']));
create policy sessions_owner_delete on public.sessions for delete to authenticated
  using (public.can_office_role(office_id, array['manager']));

create policy tasks_member_select on public.tasks for select to authenticated
  using (public.is_office_member(office_id));
create policy tasks_operational_insert on public.tasks for insert to authenticated
  with check (public.can_office_role(office_id, array['manager','lawyer','staff']));
create policy tasks_owner_update on public.tasks for update to authenticated
  using (public.can_office_role(office_id, array['manager']))
  with check (public.can_office_role(office_id, array['manager']));
create policy tasks_owner_delete on public.tasks for delete to authenticated
  using (public.can_office_role(office_id, array['manager']));

create policy office_files_member_select on public.office_files for select to authenticated
  using (public.is_office_member(office_id));
create policy office_files_member_insert on public.office_files for insert to authenticated
  with check (public.can_office_role(office_id, array['manager','lawyer','staff','accountant']));
create policy office_files_owner_update on public.office_files for update to authenticated
  using (public.can_office_role(office_id, array['manager']))
  with check (public.can_office_role(office_id, array['manager']));
create policy office_files_owner_delete on public.office_files for delete to authenticated
  using (public.can_office_role(office_id, array['manager']));

-- Fees are visible/addable to the operational team; payments and financial
-- amounts are visible/addable only to owner and accountant.
create policy fees_member_select on public.fees for select to authenticated
  using (exists (select 1 from public.cases c where c.id = fees.case_id and public.is_office_member(c.office_id)));
create policy fees_member_insert on public.fees for insert to authenticated
  with check (exists (select 1 from public.cases c where c.id = fees.case_id and public.can_office_role(c.office_id, array['manager','lawyer','staff','accountant'])));
create policy fees_owner_update on public.fees for update to authenticated
  using (exists (select 1 from public.cases c where c.id = fees.case_id and public.can_office_role(c.office_id, array['manager'])))
  with check (exists (select 1 from public.cases c where c.id = fees.case_id and public.can_office_role(c.office_id, array['manager'])));
create policy fees_owner_delete on public.fees for delete to authenticated
  using (exists (select 1 from public.cases c where c.id = fees.case_id and public.can_office_role(c.office_id, array['manager'])));

create policy payments_accounting_select on public.payments for select to authenticated
  using (exists (select 1 from public.cases c where c.id = payments.case_id and public.can_office_role(c.office_id, array['manager','accountant'])));
create policy payments_accounting_insert on public.payments for insert to authenticated
  with check (exists (select 1 from public.cases c where c.id = payments.case_id and public.can_office_role(c.office_id, array['manager','accountant'])));
create policy payments_owner_update on public.payments for update to authenticated
  using (exists (select 1 from public.cases c where c.id = payments.case_id and public.can_office_role(c.office_id, array['manager'])))
  with check (exists (select 1 from public.cases c where c.id = payments.case_id and public.can_office_role(c.office_id, array['manager'])));
create policy payments_owner_delete on public.payments for delete to authenticated
  using (exists (select 1 from public.cases c where c.id = payments.case_id and public.can_office_role(c.office_id, array['manager'])));

create policy financial_accounting_select on public.financial_transactions for select to authenticated
  using (public.can_office_role(office_id, array['manager','accountant']));
create policy financial_add_operational on public.financial_transactions for insert to authenticated
  with check (
    public.can_office_role(office_id, array['manager','accountant'])
    or (transaction_type = 'expense' and public.can_office_role(office_id, array['lawyer','staff']))
  );
create policy financial_owner_update on public.financial_transactions for update to authenticated
  using (public.can_office_role(office_id, array['manager']))
  with check (public.can_office_role(office_id, array['manager']));
create policy financial_owner_delete on public.financial_transactions for delete to authenticated
  using (public.can_office_role(office_id, array['manager']));

-- Security-definer sync RPCs must never accept a caller outside the office.
create or replace function public.sync_office_file(p_file jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result_row public.office_files;
begin
  if p_file->>'id' is null or p_file->>'office_id' is null or not public.is_office_member(p_file->>'office_id') then
    raise exception 'غير مصرح أو بيانات الملف غير مكتملة';
  end if;
  insert into public.office_files (id, office_id, file_code, file_type, title, client_name, client_phone, status, description, metadata, archived, created_at, updated_at)
  values (p_file->>'id', p_file->>'office_id', upper(p_file->>'file_code'), p_file->>'file_type', p_file->>'title', p_file->>'client_name', p_file->>'client_phone', coalesce(p_file->>'status','مفتوح'), p_file->>'description', coalesce(p_file->'metadata','{}'::jsonb), coalesce((p_file->>'archived')::boolean,false), coalesce((p_file->>'created_at')::timestamptz,now()), now())
  on conflict (id) do update set file_code=excluded.file_code, file_type=excluded.file_type, title=excluded.title, client_name=excluded.client_name, client_phone=excluded.client_phone, status=excluded.status, description=excluded.description, metadata=excluded.metadata, archived=excluded.archived, updated_at=now()
  returning * into result_row;
  return to_jsonb(result_row);
end; $$;
revoke execute on function public.sync_office_file(jsonb) from anon, public;
grant execute on function public.sync_office_file(jsonb) to authenticated;

-- Never leave the old anonymous sync grants in place.
revoke execute on function public.sync_file_event(jsonb) from anon;
revoke execute on function public.get_office_files_for_sync(text) from anon;
revoke execute on function public.get_file_events_for_sync(text) from anon;
