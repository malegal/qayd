-- Qayd security hardening v3
-- يعالج نتائج Security Advisors دون تعطيل دعوات الانضمام أو بوابة العميل المقصودة.

drop policy if exists legal_files_initial_insert on public.legal_files;
drop policy if exists legal_files_owner_insert on public.legal_files;
create policy legal_files_initial_insert on public.legal_files for insert to authenticated
  with check (
    public.has_office_role(office_id, array['manager']::text[])
    or (public.has_office_role(office_id, array['lawyer','staff','accountant']::text[]) and status in ('new','submitting'))
  );

create or replace view public.office_financial_summary
with (security_invoker = true) as
select office_id,
  coalesce(sum(amount) filter (where transaction_type = 'income'),0) as total_income,
  coalesce(sum(amount) filter (where transaction_type = 'expense'),0) as total_expense,
  coalesce(sum(amount) filter (where transaction_type = 'income'),0) - coalesce(sum(amount) filter (where transaction_type = 'expense'),0) as net_total,
  coalesce(sum(amount) filter (where transaction_scope = 'office' and transaction_type = 'income'),0) as office_income,
  coalesce(sum(amount) filter (where transaction_scope = 'office' and transaction_type = 'expense'),0) as office_expense,
  coalesce(sum(amount) filter (where transaction_scope = 'case' and transaction_type = 'income'),0) as case_income,
  coalesce(sum(amount) filter (where transaction_scope = 'case' and transaction_type = 'expense'),0) as case_expense,
  coalesce(sum(amount) filter (where transaction_scope = 'file' and transaction_type = 'income'),0) as file_income,
  coalesce(sum(amount) filter (where transaction_scope = 'file' and transaction_type = 'expense'),0) as file_expense
from public.financial_transactions
group by office_id;
grant select on public.office_financial_summary to authenticated;

create policy owner_recovery_codes_owner_select on public.owner_recovery_codes for select to authenticated using (public.has_office_role(office_id, array['manager']::text[]));
create policy owner_recovery_codes_owner_insert on public.owner_recovery_codes for insert to authenticated with check (public.has_office_role(office_id, array['manager']::text[]));
create policy sync_operations_member_select on public.sync_operations for select to authenticated using (public.is_office_member(office_id));
create policy sync_operations_member_insert on public.sync_operations for insert to authenticated with check (public.is_office_member(office_id) and user_id = (select auth.uid()));
create policy sync_operations_manager_update on public.sync_operations for update to authenticated using (public.has_office_role(office_id, array['manager']::text[])) with check (public.has_office_role(office_id, array['manager']::text[]));

revoke execute on function public.create_office_for_current_user(text,text,text) from anon;
revoke execute on function public.claim_existing_office_as_owner(text) from anon;
revoke execute on function public.create_owner_recovery_codes(text,integer) from anon;
revoke execute on function public.redeem_owner_recovery_code(text,text) from anon;
revoke execute on function public.get_file_events_for_sync(text) from anon;
revoke execute on function public.get_office_files_for_sync(text) from anon;
revoke execute on function public.has_office_role(text,text[]) from anon;
revoke execute on function public.is_office_member(text) from anon;
revoke execute on function public.set_office_member_role(text,uuid,text) from anon;
revoke execute on function public.revoke_office_member(text,uuid) from anon;
revoke execute on function public.rename_office_member(text,uuid,text) from anon;
revoke execute on function public.register_office_member_device(text,text,text,text,text) from anon;
revoke execute on function public.create_office_invite(text,text,text,integer) from anon;
revoke execute on function public.create_email_invite(text,text,text,text,integer) from anon;
revoke execute on function public.sync_file_document(jsonb) from anon;
revoke execute on function public.sync_file_event(jsonb) from anon;
revoke execute on function public.sync_office_file(jsonb) from anon;
revoke execute on function public.touch_updated_at() from anon;
