-- Apply the team role matrix to the existing qayd schema.
-- manager = owner, lawyer = lawyer, staff = secretary, accountant = accountant.

-- Remove permissive policies that allowed non-owners to update records.
drop policy if exists cases_owner_update on public.cases;
drop policy if exists cases_owner_delete on public.cases;
drop policy if exists cases_member_insert on public.cases;
create policy cases_member_insert on public.cases for insert to authenticated
  with check (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[]));
create policy cases_owner_update on public.cases for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy cases_owner_delete on public.cases for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

drop policy if exists sessions_insert_member on public.sessions;
drop policy if exists sessions_update_member on public.sessions;
drop policy if exists sessions_owner_update on public.sessions;
drop policy if exists sessions_owner_delete on public.sessions;
create policy sessions_insert_operational on public.sessions for insert to authenticated
  with check (public.has_office_role(office_id, array['manager','lawyer','staff']::text[]));
create policy sessions_owner_update on public.sessions for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy sessions_owner_delete on public.sessions for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

drop policy if exists tasks_insert_member on public.tasks;
drop policy if exists tasks_update_member on public.tasks;
drop policy if exists tasks_owner_update on public.tasks;
drop policy if exists tasks_owner_delete on public.tasks;
create policy tasks_insert_operational on public.tasks for insert to authenticated
  with check (public.has_office_role(office_id, array['manager','lawyer','staff']::text[]));
create policy tasks_owner_update on public.tasks for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy tasks_owner_delete on public.tasks for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

drop policy if exists office_files_insert_member on public.office_files;
drop policy if exists office_files_owner_update on public.office_files;
drop policy if exists office_files_owner_delete on public.office_files;
create policy office_files_insert_member on public.office_files for insert to authenticated
  with check (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[]));
create policy office_files_owner_update on public.office_files for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy office_files_owner_delete on public.office_files for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

drop policy if exists file_events_insert_member on public.file_events;
drop policy if exists file_events_operational_insert on public.file_events;
drop policy if exists file_events_owner_update on public.file_events;
drop policy if exists file_events_owner_delete on public.file_events;
create policy file_events_operational_insert on public.file_events for insert to authenticated
  with check (public.has_office_role(office_id, array['manager','lawyer','staff']::text[]));
create policy file_events_owner_update on public.file_events for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy file_events_owner_delete on public.file_events for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

drop policy if exists fees_insert_internal on public.fees;
drop policy if exists fees_update_internal on public.fees;
drop policy if exists fees_member_insert on public.fees;
drop policy if exists fees_owner_update on public.fees;
drop policy if exists fees_owner_delete on public.fees;
create policy fees_member_insert on public.fees for insert to authenticated
  with check (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager','lawyer','staff','accountant']::text[])));
create policy fees_owner_update on public.fees for update to authenticated
  using (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager']::text[])))
  with check (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager']::text[])));
create policy fees_owner_delete on public.fees for delete to authenticated
  using (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager']::text[])));

drop policy if exists payments_insert_internal on public.payments;
drop policy if exists payments_update_internal on public.payments;
drop policy if exists payments_accounting_insert on public.payments;
drop policy if exists payments_owner_update on public.payments;
drop policy if exists payments_owner_delete on public.payments;
create policy payments_accounting_insert on public.payments for insert to authenticated
  with check (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager','accountant']::text[])));
create policy payments_owner_update on public.payments for update to authenticated
  using (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager']::text[])))
  with check (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager']::text[])));
create policy payments_owner_delete on public.payments for delete to authenticated
  using (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager']::text[])));

drop policy if exists financial_transactions_delete_internal on public.financial_transactions;
drop policy if exists financial_transactions_update_internal on public.financial_transactions;
drop policy if exists financial_owner_update on public.financial_transactions;
drop policy if exists financial_owner_delete on public.financial_transactions;
create policy financial_owner_update on public.financial_transactions for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy financial_owner_delete on public.financial_transactions for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

-- Replace the sync RPC so role checks happen before every write. This is the
-- server-side enforcement used by both desktop and mobile clients.
create or replace function public.apply_mobile_operation(p_operation_id uuid, p_office_id text, p_entity_type text, p_entity_id text, p_operation text, p_payload jsonb, p_base_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare existing_status text; result_status text := 'applied'; payment_amount real;
begin
  if auth.uid() is null or not public.is_office_member(p_office_id) then raise exception 'not authorized'; end if;
  select status into existing_status from public.sync_operations where operation_id = p_operation_id;
  if existing_status is not null then return jsonb_build_object('status', existing_status, 'operation_id', p_operation_id, 'entity_id', p_entity_id); end if;

  if p_operation in ('update','delete') and not public.has_office_role(p_office_id, array['manager']::text[]) then
    raise exception 'only owner can update or delete records';
  end if;
  if p_entity_type = 'payments' and not public.has_office_role(p_office_id, array['manager','accountant']::text[]) then
    raise exception 'not authorized for payments';
  end if;
  if p_entity_type = 'fees' and not public.has_office_role(p_office_id, array['manager','lawyer','staff','accountant']::text[]) then
    raise exception 'not authorized for fees';
  end if;
  if p_entity_type in ('sessions','tasks') and p_operation = 'insert' and not public.has_office_role(p_office_id, array['manager','lawyer','staff']::text[]) then
    raise exception 'not authorized for operational record';
  end if;
  if p_entity_type = 'cases' and p_operation = 'insert' and not public.has_office_role(p_office_id, array['manager','lawyer','staff','accountant']::text[]) then
    raise exception 'not authorized for cases';
  end if;
  if p_entity_type = 'expenses' and p_operation = 'insert' and not public.has_office_role(p_office_id, array['manager','lawyer','staff','accountant']::text[]) then
    raise exception 'not authorized for expenses';
  end if;

  if p_entity_type = 'cases' then
    if p_operation = 'delete' then delete from public.cases where id=p_entity_id and office_id=p_office_id;
    else insert into public.cases (id,office_id,client_name,client_phone,client_email,client_role,opponent_name,case_number,case_year,court_name,circuit,case_type,case_subject,case_code,archived,created_at,client_address,opponent_phone,opponent_address,client_national_id,opponent_national_id,opponent_email,opponent_role)
      values (p_entity_id,p_office_id,coalesce(p_payload->>'client_name',''),coalesce(p_payload->>'client_phone',''),p_payload->>'client_email',p_payload->>'client_role',p_payload->>'opponent_name',coalesce(p_payload->>'case_number',''),coalesce(p_payload->>'case_year',''),p_payload->>'court_name',p_payload->>'circuit',p_payload->>'case_type',p_payload->>'case_subject',coalesce(p_payload->>'case_code',''),coalesce((p_payload->>'archived')::integer,0),coalesce((p_payload->>'created_at')::timestamptz,now()),p_payload->>'client_address',p_payload->>'opponent_phone',p_payload->>'opponent_address',p_payload->>'client_national_id',p_payload->>'opponent_national_id',p_payload->>'opponent_email',p_payload->>'opponent_role')
      on conflict (id) do update set client_name=excluded.client_name,client_phone=excluded.client_phone,client_email=excluded.client_email,client_role=excluded.client_role,opponent_name=excluded.opponent_name,case_number=excluded.case_number,case_year=excluded.case_year,court_name=excluded.court_name,circuit=excluded.circuit,case_type=excluded.case_type,case_subject=excluded.case_subject,case_code=excluded.case_code,archived=excluded.archived,client_address=excluded.client_address,opponent_phone=excluded.opponent_phone,opponent_address=excluded.opponent_address,client_national_id=excluded.client_national_id,opponent_national_id=excluded.opponent_national_id,opponent_email=excluded.opponent_email,opponent_role=excluded.opponent_role;
    end if;
  elsif p_entity_type = 'sessions' then
    if p_operation='insert' then insert into public.sessions(id,office_id,case_id,session_date,case_status,decision) values(p_entity_id,p_office_id,p_payload->>'case_id',p_payload->>'session_date',p_payload->>'case_status',p_payload->>'decision') on conflict(id) do nothing;
    else update public.sessions set case_id=p_payload->>'case_id',session_date=p_payload->>'session_date',case_status=p_payload->>'case_status',decision=p_payload->>'decision' where id=p_entity_id and office_id=p_office_id; end if;
  elsif p_entity_type = 'tasks' then
    if p_operation='insert' then insert into public.tasks(id,office_id,description,date,completed) values(p_entity_id,p_office_id,p_payload->>'description',p_payload->>'date',coalesce((p_payload->>'completed')::boolean,false)) on conflict(id) do nothing;
    else update public.tasks set description=p_payload->>'description',date=p_payload->>'date',completed=coalesce((p_payload->>'completed')::boolean,false) where id=p_entity_id and office_id=p_office_id; end if;
  elsif p_entity_type = 'expenses' then
    if p_operation='insert' then insert into public.expenses(id,office_id,case_id,office_file_id,amount,expense_date,category,description,receipt_path,created_by) values(p_entity_id,p_office_id,nullif(p_payload->>'case_id',''),nullif(p_payload->>'office_file_id',''),(p_payload->>'amount')::numeric,coalesce((p_payload->>'expense_date')::date,current_date),p_payload->>'category',p_payload->>'description',p_payload->>'receipt_path',auth.uid()) on conflict(id) do nothing;
    else update public.expenses set amount=(p_payload->>'amount')::numeric,category=p_payload->>'category',description=p_payload->>'description',expense_date=(p_payload->>'expense_date')::date where id=p_entity_id and office_id=p_office_id; end if;
  elsif p_entity_type = 'fees' then
    insert into public.fees(case_id,total,paid,remaining,notes) values(p_entity_id,(p_payload->>'total')::real,coalesce((p_payload->>'paid')::real,0),(p_payload->>'total')::real-coalesce((p_payload->>'paid')::real,0),p_payload->>'notes') on conflict(case_id) do update set total=excluded.total,paid=excluded.paid,remaining=excluded.remaining,notes=excluded.notes;
  elsif p_entity_type = 'payments' then
    payment_amount := (p_payload->>'amount')::real;
    insert into public.payments(case_id,amount,date,note) values(p_entity_id,payment_amount,p_payload->>'date',p_payload->>'note');
    update public.fees set paid=coalesce(paid,0)+payment_amount,remaining=total-(coalesce(paid,0)+payment_amount) where case_id=p_entity_id;
  else raise exception 'unsupported entity type'; end if;

  insert into public.sync_operations(operation_id,office_id,user_id,entity_type,entity_id,operation,payload,base_updated_at,status)
  values(p_operation_id,p_office_id,auth.uid(),p_entity_type,p_entity_id,p_operation,p_payload,p_base_updated_at,result_status);
  return jsonb_build_object('status',result_status,'operation_id',p_operation_id,'entity_id',p_entity_id);
end; $$;
revoke execute on function public.apply_mobile_operation(uuid,text,text,text,text,jsonb,timestamptz) from anon;
grant execute on function public.apply_mobile_operation(uuid,text,text,text,text,jsonb,timestamptz) to authenticated;

-- Preserve the existing activity history and enrich new records with the member name.
create or replace function public.record_office_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_new jsonb:=to_jsonb(new); v_old jsonb:=to_jsonb(old); v_office_id text; v_id text; v_name text; v_actor uuid:=auth.uid(); v_role text; v_actor_name text;
begin
  v_office_id:=coalesce(v_new->>'office_id',v_old->>'office_id');
  if v_office_id is null and tg_table_name in ('fees','payments') then select c.office_id into v_office_id from public.cases c where c.id=coalesce(v_new->>'case_id',v_old->>'case_id'); end if;
  if v_office_id is null then return coalesce(new,old); end if;
  v_id:=coalesce(v_new->>'id',v_old->>'id',v_new->>'case_id',v_old->>'case_id');
  v_name:=coalesce(v_new->>'client_name',v_old->>'client_name',v_new->>'title',v_old->>'title',v_new->>'description',v_old->>'description',v_new->>'category',v_old->>'category','');
  select role,display_name into v_role,v_actor_name from public.office_members where office_id=v_office_id and user_id=v_actor limit 1;
  if v_role is null then v_role:='desktop'; end if;
  insert into public.office_notifications(office_id,actor_user_id,actor_role,entity_type,entity_id,action,title,details)
  values(v_office_id,v_actor,v_role,tg_table_name,v_id,lower(tg_op),'تغيير جديد في '||tg_table_name,jsonb_build_object('name',v_name,'actor_role',v_role,'actor_name',coalesce(v_actor_name,'غير معروف'),'actor_user_id',v_actor));
  return coalesce(new,old);
end; $$;
revoke execute on function public.record_office_activity() from public;
