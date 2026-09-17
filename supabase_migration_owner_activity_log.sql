-- Owner activity log: every new office record is visible to the owner with actor identity.
-- The trigger records inserts after RLS-authorized writes from desktop or mobile.

create table if not exists public.office_notifications (
  id uuid primary key default gen_random_uuid(),
  office_id text not null,
  actor_user_id uuid null,
  actor_role text null,
  title text not null,
  action text not null,
  entity_type text not null,
  entity_id text null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz null
);

create index if not exists office_notifications_office_created_idx
  on public.office_notifications (office_id, created_at desc);

alter table public.office_notifications enable row level security;
drop policy if exists office_notifications_owner_select on public.office_notifications;
create policy office_notifications_owner_select on public.office_notifications
  for select to authenticated
  using (public.can_office_role(office_id, array['manager']));
drop policy if exists office_notifications_owner_update on public.office_notifications;
create policy office_notifications_owner_update on public.office_notifications
  for update to authenticated
  using (public.can_office_role(office_id, array['manager']))
  with check (public.can_office_role(office_id, array['manager']));

create or replace function public.log_office_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  office text;
  actor_role text;
  display_name text;
  record_name text;
  kind text := tg_table_name;
begin
  office := coalesce(to_jsonb(new)->>'office_id', '');
  if office = '' and tg_table_name in ('fees', 'payments') then
    select c.office_id into office from public.cases c where c.id = (to_jsonb(new)->>'case_id');
  end if;
  if office = '' then
    return new;
  end if;
  select m.role, coalesce(m.display_name, '') into actor_role, display_name
    from public.office_members m
   where m.office_id = office and m.user_id = auth.uid()
   limit 1;
  if actor_role is null then
    return new;
  end if;
  record_name := coalesce(
    to_jsonb(new)->>'client_name',
    to_jsonb(new)->>'title',
    to_jsonb(new)->>'description',
    to_jsonb(new)->>'category',
    to_jsonb(new)->>'case_code',
    to_jsonb(new)->>'file_code',
    to_jsonb(new)->>'id',
    'سجل جديد'
  );
  insert into public.office_notifications
    (office_id, actor_user_id, actor_role, title, action, entity_type, entity_id, details)
  values
    (office, auth.uid(), actor_role,
     case kind
       when 'cases' then 'إضافة قضية'
       when 'sessions' then 'إضافة جلسة'
       when 'tasks' then 'إضافة مهمة'
       when 'office_files' then 'إضافة ملف مهني'
       when 'fees' then 'إضافة رسم أو أتعاب'
       when 'payments' then 'إضافة دفعة مقبوضة'
       when 'financial_transactions' then case when (to_jsonb(new)->>'transaction_type') = 'income' then 'إضافة متحصل' else 'إضافة مصروف' end
       else 'إضافة سجل'
     end,
     'insert', kind, coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'case_id'),
     jsonb_build_object('name', record_name, 'actor_name', display_name, 'actor_user_id', auth.uid(), 'amount', to_jsonb(new)->>'amount'));
  return new;
end;
$$;

revoke all on function public.log_office_insert() from public;

drop trigger if exists cases_owner_activity on public.cases;
create trigger cases_owner_activity after insert on public.cases for each row execute function public.log_office_insert();
drop trigger if exists sessions_owner_activity on public.sessions;
create trigger sessions_owner_activity after insert on public.sessions for each row execute function public.log_office_insert();
drop trigger if exists tasks_owner_activity on public.tasks;
create trigger tasks_owner_activity after insert on public.tasks for each row execute function public.log_office_insert();
drop trigger if exists office_files_owner_activity on public.office_files;
create trigger office_files_owner_activity after insert on public.office_files for each row execute function public.log_office_insert();
drop trigger if exists fees_owner_activity on public.fees;
create trigger fees_owner_activity after insert on public.fees for each row execute function public.log_office_insert();
drop trigger if exists payments_owner_activity on public.payments;
create trigger payments_owner_activity after insert on public.payments for each row execute function public.log_office_insert();
drop trigger if exists financial_transactions_owner_activity on public.financial_transactions;
create trigger financial_transactions_owner_activity after insert on public.financial_transactions for each row execute function public.log_office_insert();
