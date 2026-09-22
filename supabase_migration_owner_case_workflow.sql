-- Qayd owner workflow v1
-- يضيف الحقول المطلوبة دون حذف الحقول القديمة أو نقل البيانات القديمة.

alter table public.cases add column if not exists category text;
alter table public.cases add column if not exists city text;
alter table public.cases add column if not exists proceeding_type text not null default 'first_instance';
alter table public.cases add column if not exists importance text not null default 'normal';
alter table public.cases add column if not exists alert_notes text;
alter table public.cases add column if not exists next_followup_at timestamptz;

alter table public.proceedings add column if not exists city text;
alter table public.proceedings add column if not exists next_session_date timestamptz;
alter table public.proceedings add column if not exists required_action text;
alter table public.proceedings add column if not exists notes text;

alter table public.sessions add column if not exists court_name text;
alter table public.sessions add column if not exists circuit text;
alter table public.sessions add column if not exists city text;
alter table public.sessions add column if not exists required_action text;
alter table public.sessions add column if not exists responsible_user_id uuid references auth.users(id);
alter table public.sessions add column if not exists responsible_name text;
alter table public.sessions add column if not exists followup_date date;
alter table public.sessions add column if not exists notes text;

alter table public.office_files add column if not exists authority_file_number text;
alter table public.office_files add column if not exists authority_file_year text;
alter table public.office_files add column if not exists authority_name text;

create table if not exists public.case_parties (
  id text primary key,
  office_id text not null references public.offices(office_id) on delete cascade,
  case_id text references public.cases(id) on delete cascade,
  legal_file_id text references public.legal_files(id) on delete cascade,
  party_type text not null check (party_type in ('client','opponent')),
  name text not null,
  role text,
  phone text,
  national_id text,
  email text,
  address text,
  power_of_attorney_number text,
  power_of_attorney_year text,
  notary_office text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (case_id is not null or legal_file_id is not null)
);
create index if not exists case_parties_case_idx on public.case_parties(office_id, case_id, party_type);
create index if not exists case_parties_legal_file_idx on public.case_parties(office_id, legal_file_id, party_type);
create index if not exists case_parties_search_idx on public.case_parties(office_id, name, phone);

create table if not exists public.session_change_log (
  id uuid primary key default gen_random_uuid(),
  office_id text not null references public.offices(office_id) on delete cascade,
  session_id text not null references public.sessions(id) on delete cascade,
  action text not null,
  old_data jsonb not null default '{}'::jsonb,
  new_data jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  reason text,
  changed_at timestamptz not null default now()
);
create index if not exists session_change_log_session_idx on public.session_change_log(office_id, session_id, changed_at desc);

alter table public.case_parties enable row level security;
alter table public.session_change_log enable row level security;
drop policy if exists case_parties_member_select on public.case_parties;
drop policy if exists case_parties_member_insert on public.case_parties;
drop policy if exists case_parties_manager_update on public.case_parties;
drop policy if exists session_change_log_member_select on public.session_change_log;
drop policy if exists session_change_log_member_insert on public.session_change_log;
create policy case_parties_member_select on public.case_parties for select to authenticated using (public.is_office_member(office_id));
create policy case_parties_member_insert on public.case_parties for insert to authenticated with check (public.is_office_member(office_id));
create policy case_parties_manager_update on public.case_parties for update to authenticated using (public.has_office_role(office_id, array['manager']::text[])) with check (public.has_office_role(office_id, array['manager']::text[]));
create policy session_change_log_member_select on public.session_change_log for select to authenticated using (public.is_office_member(office_id));
create policy session_change_log_member_insert on public.session_change_log for insert to authenticated with check (public.is_office_member(office_id));

comment on table public.case_parties is 'العملاء والخصوم المتعددون لكل قضية أو ملف قانوني، بما في ذلك بيانات التوكيل ومكتب التوثيق.';
comment on table public.session_change_log is 'سجل غير قابل للحذف من الواجهة لتغييرات الجلسات.';
