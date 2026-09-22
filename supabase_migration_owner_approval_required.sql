-- Qayd: owner approval required for every mobile write
-- لا يحذف بيانات. يقفل الإدخال المباشر لأعضاء الفريق ويضيف طلبات الاعتماد المالية.

alter table public.approval_requests
  add column if not exists base_updated_at timestamptz;

-- توسعة أنواع طلبات الاعتماد لتشمل دفتر الحركة المالية الموحد.
drop constraint if exists approval_requests_entity_type_check on public.approval_requests;
alter table public.approval_requests
  add constraint approval_requests_entity_type_check check (entity_type in ('legal_file','case','proceeding','session','task','note','fee','payment','expense','financial_transaction','service_action'));

-- العضو يستطيع إنشاء طلباً فقط، ولا يستطيع إدخال الكيان التشغيلي مباشرة.
-- المالك فقط يستطيع اعتماد/إدخال/تعديل السجلات الرئيسية.
drop policy if exists cases_member_insert on public.cases;
drop policy if exists sessions_insert_operational on public.sessions;
drop policy if exists tasks_operational_insert on public.tasks;
drop policy if exists office_files_member_insert on public.office_files;
drop policy if exists file_events_operational_insert on public.file_events;
drop policy if exists fees_member_insert on public.fees;
drop policy if exists payments_accounting_insert on public.payments;
drop policy if exists financial_add_operational on public.financial_transactions;
drop policy if exists legal_files_member_insert on public.legal_files;
drop policy if exists proceedings_member_insert on public.proceedings;
drop policy if exists proceedings_member_update on public.proceedings;
drop policy if exists service_actions_member_insert on public.service_actions;
drop policy if exists service_actions_member_update on public.service_actions;
drop policy if exists case_parties_member_insert on public.case_parties;
drop policy if exists session_change_log_member_insert on public.session_change_log;
drop policy if exists tasks_insert_operational on public.tasks;
drop policy if exists financial_transactions_expense_insert on public.financial_transactions;
drop policy if exists cases_owner_insert on public.cases;
drop policy if exists expenses_insert_member on public.expenses;
drop policy if exists expenses_insert_team on public.expenses;
drop policy if exists fees_owner_insert on public.fees;
drop policy if exists office_files_owner_insert on public.office_files;
drop policy if exists payments_owner_insert on public.payments;

create policy cases_manager_insert on public.cases for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy sessions_manager_insert on public.sessions for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy tasks_manager_insert on public.tasks for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy office_files_manager_insert on public.office_files for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy file_events_manager_insert on public.file_events for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy fees_manager_insert on public.fees for insert to authenticated
  with check (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager']::text[])));
create policy payments_manager_insert on public.payments for insert to authenticated
  with check (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager']::text[])));
create policy financial_manager_insert on public.financial_transactions for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy expenses_manager_insert on public.expenses for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy legal_files_manager_insert on public.legal_files for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy proceedings_manager_insert on public.proceedings for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy service_actions_manager_insert on public.service_actions for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy case_parties_manager_insert on public.case_parties for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy session_change_log_manager_insert on public.session_change_log for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));

comment on table public.approval_requests is 'كل إضافة أو تعديل من تطبيق الهاتف، بما فيها الأتعاب والمصروفات والنفقات والمتحصلات، تنتظر اعتماد مالك المكتب.';
comment on column public.approval_requests.base_updated_at is 'نسخة updated_at التي رآها الهاتف؛ تستخدم لاكتشاف التعارض قبل اعتماد المالك.';

-- حتى لو حاول إصدار قديم من الهاتف استدعاء RPC القديمة، لا يسمح الخادم بالكتابة إلا للمالك.
alter function public.apply_mobile_operation(uuid,text,text,text,text,jsonb,timestamptz) rename to apply_mobile_operation_legacy;
create or replace function public.apply_mobile_operation(p_operation_id uuid, p_office_id text, p_entity_type text, p_entity_id text, p_operation text, p_payload jsonb, p_base_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_office_role(p_office_id, array['manager']::text[]) then
    raise exception 'mobile writes require owner approval';
  end if;
  return public.apply_mobile_operation_legacy(p_operation_id, p_office_id, p_entity_type, p_entity_id, p_operation, p_payload, p_base_updated_at);
end;
$$;
revoke execute on function public.apply_mobile_operation(uuid,text,text,text,text,jsonb,timestamptz) from public, anon;
grant execute on function public.apply_mobile_operation(uuid,text,text,text,text,jsonb,timestamptz) to authenticated;
revoke execute on function public.apply_mobile_operation_legacy(uuid,text,text,text,text,jsonb,timestamptz) from public, anon, authenticated;
