-- مراحل تاريخية داخل نفس القضية: لا تنشئ قضية أو كوداً أو مجلداً جديداً.
alter table public.sessions add column if not exists stage_id text;
create table if not exists public.case_stages (
  id text primary key,
  case_id text not null references public.cases(id) on delete cascade,
  office_id text not null references public.offices(office_id) on delete cascade,
  stage_type text not null,
  case_number text not null,
  case_year text not null,
  court_name text not null,
  circuit text not null,
  client_role text not null,
  opponent_role text not null,
  judgment_date date,
  judgment_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists case_stages_case_created_idx on public.case_stages(case_id, created_at);
create index if not exists sessions_case_stage_idx on public.sessions(case_id, stage_id, session_date);
alter table public.case_stages enable row level security;
drop policy if exists case_stages_member_select on public.case_stages;
drop policy if exists case_stages_manager_write on public.case_stages;
create policy case_stages_member_select on public.case_stages for select to authenticated using (public.is_office_member(office_id));
create policy case_stages_manager_write on public.case_stages for all to authenticated using (public.has_office_role(office_id, array['manager']::text[])) with check (public.has_office_role(office_id, array['manager']::text[]));
