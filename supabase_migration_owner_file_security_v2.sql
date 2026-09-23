-- Qayd owner file security and unified workflow v2
-- ينفذ إصلاحات أمنية وبنية الملف الرئيسي دون حذف cases أو البيانات القائمة.

-- 1) حالات الملف الرئيسي: قيم ثابتة بالإنجليزية، والعرض العربي في الواجهة.
alter table public.legal_files drop constraint if exists legal_files_status_check;
alter table public.legal_files add constraint legal_files_status_check
  check (status in ('new','submitting','in_progress','needs_action','on_hold','completed','archived'));
alter table public.legal_files alter column status set default 'new';

-- 2) إجراءات الخدمات كخطوات مرتبة قابلة للمتابعة.
alter table public.service_actions add column if not exists sequence_order integer not null default 1;
alter table public.service_actions add column if not exists step_status text not null default 'pending';
alter table public.service_actions add column if not exists step_title text;
alter table public.service_actions add column if not exists blocked_reason text;
alter table public.service_actions add column if not exists completed_at timestamptz;
alter table public.service_actions add column if not exists completed_by uuid references auth.users(id);
alter table public.service_actions drop constraint if exists service_actions_step_status_check;
alter table public.service_actions add constraint service_actions_step_status_check
  check (step_status in ('pending','in_progress','done','blocked'));
create index if not exists service_actions_file_sequence_idx
  on public.service_actions(legal_file_id, sequence_order);

-- 3) فصل حالة الجلسة عن حالة المرحلة/الملف مع إبقاء case_status للتوافق القديم.
alter table public.sessions add column if not exists session_status text not null default 'new';
alter table public.sessions drop constraint if exists sessions_session_status_check;
alter table public.sessions add constraint sessions_session_status_check
  check (session_status in ('new','adjourned','judged','struck','needs_document','needs_publication','needs_fee_payment','closed'));
create index if not exists sessions_office_status_date_idx
  on public.sessions(office_id, session_status, session_date);

-- 4) إصلاح ثغرة legal_files: الفريق ينشئ ملفاً أولياً فقط، والتعديلات الحساسة للمالك.
drop policy if exists legal_files_manager_update on public.legal_files;
drop policy if exists legal_files_member_update on public.legal_files;
drop policy if exists legal_files_manager_insert on public.legal_files;
drop policy if exists legal_files_member_insert on public.legal_files;
create policy legal_files_initial_insert on public.legal_files for insert to authenticated
  with check (
    public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[])
    and status in ('new','submitting')
  );
create policy legal_files_owner_insert on public.legal_files for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy legal_files_manager_update on public.legal_files for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));

-- 5) دوال SECURITY DEFINER: تثبيت search_path وإغلاق الاستدعاء العام.
alter function public.get_case_data(text,text) set search_path = public, pg_temp;
alter function public.generate_case_code() set search_path = public, pg_temp;
revoke execute on function public.get_case_data(text,text) from public, anon;
grant execute on function public.get_case_data(text,text) to authenticated;
revoke execute on function public.generate_case_code() from public, anon;
grant execute on function public.generate_case_code() to authenticated;

-- 6) لوحة إجراءات موحدة آمنة؛ security_invoker يطبق RLS للمستخدم المستعلم.
create or replace view public.urgent_items
with (security_invoker = true) as
select
  'session'::text as kind,
  s.id::text as entity_id,
  s.office_id,
  case when s.session_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
       then s.session_date::date::timestamptz else null end as due_at,
  case when s.session_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' and s.session_date::date < current_date then 'overdue'
       when s.session_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' and s.session_date::date <= current_date + 3 then 'high'
       else 'normal' end as severity,
  coalesce(c.client_name, lf.client_name, 'جلسة') as title,
  coalesce(s.session_status, s.case_status, 'new') as status_label
from public.sessions s
left join public.cases c on c.id = s.case_id
left join public.legal_files lf on lf.id = s.legal_file_id
where coalesce(s.session_status, 'new') <> 'closed'

union all

select
  'approval_request'::text,
  ar.id::text,
  ar.office_id,
  ar.created_at,
  'high'::text,
  ar.entity_type || ' — ' || ar.action,
  ar.status
from public.approval_requests ar
where ar.status = 'pending'

union all

select
  'sync_conflict'::text,
  sc.id::text,
  sc.office_id,
  sc.created_at,
  'high'::text,
  'تعارض مزامنة'::text,
  sc.status
from public.sync_conflicts sc
where sc.resolved_at is null

union all

select
  'service_followup'::text,
  sa.id::text,
  sa.office_id,
  sa.next_followup_at::timestamptz,
  case when sa.next_followup_at < current_date then 'overdue' else 'normal' end,
  lf.client_name,
  coalesce(sa.step_status, sa.status)
from public.service_actions sa
join public.legal_files lf on lf.id = sa.legal_file_id
where sa.next_followup_at is not null
  and coalesce(sa.step_status, 'pending') not in ('done')
  and sa.status not in ('completed','cancelled');

grant select on public.urgent_items to authenticated;

-- 7) خط زمني موحد، مع ربط سجل الجلسة بالملف الرئيسي عبر sessions.
create or replace view public.legal_file_timeline
with (security_invoker = true) as
select
  'session_change'::text as event_type,
  s.legal_file_id,
  scl.office_id,
  scl.session_id::text as entity_id,
  scl.changed_at as occurred_at,
  scl.changed_by as actor_id,
  scl.old_data as old_value,
  scl.new_data as new_value,
  true as approved
from public.session_change_log scl
join public.sessions s on s.id = scl.session_id
where s.legal_file_id is not null

union all

select
  'activity'::text,
  n.entity_id,
  n.office_id,
  n.entity_id,
  n.created_at,
  n.actor_user_id,
  null::jsonb,
  n.details,
  true
from public.office_notifications n
where n.entity_id is not null

union all

select
  'approval'::text,
  ar.entity_id,
  ar.office_id,
  ar.id::text,
  coalesce(ar.reviewed_at, ar.created_at),
  coalesce(ar.reviewed_by, ar.requested_by),
  jsonb_build_object('reason', ar.reason),
  jsonb_build_object('review_note', ar.review_note, 'status', ar.status),
  ar.status = 'approved'
from public.approval_requests ar;

grant select on public.legal_file_timeline to authenticated;

-- 8) فهارس الملف الرئيسي.
create index if not exists legal_files_office_status_updated_idx on public.legal_files(office_id, status, updated_at desc);
create index if not exists service_actions_followup_status_idx on public.service_actions(office_id, next_followup_at, step_status);
create index if not exists cases_legal_file_idx on public.cases(legal_file_id);
create index if not exists sessions_legal_file_idx on public.sessions(legal_file_id);

comment on view public.urgent_items is 'لوحة إجراءات موحدة للمالك مع security_invoker وتصفية RLS حسب المكتب.';
comment on view public.legal_file_timeline is 'خط زمني موحد للملف الرئيسي مع security_invoker.';
comment on column public.legal_files.status is 'new/submitting/in_progress/needs_action/on_hold/completed/archived';
