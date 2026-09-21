-- Qayd legal-file model v1
-- مكتب جاد الرب: ملف قانوني رئيسي، مراحل قضائية، خدمات غير قضائية، وطلبات اعتماد الهاتف.
-- لا يحذف هذا الترحيل أي جدول أو عمود قائم.

create table if not exists public.legal_files (
  id text primary key,
  office_id text not null references public.offices(office_id) on delete cascade,
  file_code text not null unique,
  file_type text not null check (file_type in ('judicial','real_estate','corporate','power_of_attorney','contract','legal_consultation','government_service','enforcement','other')),
  title text not null,
  status text not null default 'open' check (status in ('open','on_hold','completed','archived')),
  client_name text not null,
  client_phone text,
  client_email text,
  client_national_id text,
  client_address text,
  description text,
  responsible_user_id uuid references auth.users(id),
  opened_at date not null default current_date,
  closed_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proceedings (
  id text primary key,
  legal_file_id text not null references public.legal_files(id) on delete cascade,
  office_id text not null references public.offices(office_id) on delete cascade,
  proceeding_type text not null check (proceeding_type in ('first_instance','appeal','cassation','retrial','opposition','enforcement','execution_objection','other')),
  parent_proceeding_id text references public.proceedings(id) on delete set null,
  appeal_of_proceeding_id text references public.proceedings(id) on delete set null,
  court_name text,
  circuit text,
  case_number text,
  case_year text,
  client_position text,
  opponent_name text,
  opponent_position text,
  status text not null default 'open' check (status in ('open','adjourned','judgment_pending','judgment_issued','closed','archived')),
  registration_date date,
  judgment_date date,
  judgment_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cases add column if not exists legal_file_id text references public.legal_files(id) on delete set null;
alter table public.cases add column if not exists proceeding_id text references public.proceedings(id) on delete set null;
alter table public.cases add column if not exists root_case_id text references public.cases(id) on delete set null;
alter table public.cases add column if not exists parent_case_id text references public.cases(id) on delete set null;
alter table public.cases add column if not exists appeal_of_case_id text references public.cases(id) on delete set null;
alter table public.cases add column if not exists proceeding_type text not null default 'first_instance' check (proceeding_type in ('first_instance','appeal','cassation','retrial','opposition','enforcement','execution_objection','other'));

alter table public.sessions add column if not exists proceeding_id text references public.proceedings(id) on delete set null;
alter table public.sessions add column if not exists legal_file_id text references public.legal_files(id) on delete set null;
alter table public.tasks add column if not exists legal_file_id text references public.legal_files(id) on delete set null;
alter table public.tasks add column if not exists proceeding_id text references public.proceedings(id) on delete set null;
alter table public.notes add column if not exists legal_file_id text references public.legal_files(id) on delete set null;
alter table public.notes add column if not exists proceeding_id text references public.proceedings(id) on delete set null;

create table if not exists public.service_actions (
  id text primary key,
  legal_file_id text not null references public.legal_files(id) on delete cascade,
  office_id text not null references public.offices(office_id) on delete cascade,
  action_type text not null,
  authority text,
  application_number text,
  submitted_at date,
  next_followup_at date,
  status text not null default 'new' check (status in ('new','documents_required','submitted','under_review','completed','cancelled')),
  result text,
  notes text,
  responsible_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  office_id text not null references public.offices(office_id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  entity_type text not null check (entity_type in ('legal_file','case','proceeding','session','task','note','fee','payment','expense','service_action')),
  entity_id text not null,
  action text not null check (action in ('create','update','delete','reschedule','archive')),
  payload jsonb not null default '{}'::jsonb,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists legal_files_office_status_idx on public.legal_files(office_id, status, updated_at desc);
create index if not exists proceedings_file_idx on public.proceedings(legal_file_id, created_at);
create index if not exists proceedings_office_status_idx on public.proceedings(office_id, status, updated_at desc);
create index if not exists service_actions_followup_idx on public.service_actions(office_id, next_followup_at, status);
create index if not exists approval_requests_office_status_idx on public.approval_requests(office_id, status, created_at desc);
create index if not exists cases_root_case_idx on public.cases(root_case_id);
create index if not exists cases_proceeding_idx on public.cases(proceeding_id);

alter table public.legal_files enable row level security;
alter table public.proceedings enable row level security;
alter table public.service_actions enable row level security;
alter table public.approval_requests enable row level security;

create policy legal_files_member_select on public.legal_files for select to authenticated using (public.is_office_member(office_id));
create policy legal_files_member_insert on public.legal_files for insert to authenticated with check (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[]));
create policy legal_files_manager_update on public.legal_files for update to authenticated using (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[])) with check (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[]));
create policy legal_files_manager_delete on public.legal_files for delete to authenticated using (public.has_office_role(office_id, array['manager']::text[]));

create policy proceedings_member_select on public.proceedings for select to authenticated using (public.is_office_member(office_id));
create policy proceedings_member_insert on public.proceedings for insert to authenticated with check (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[]));
create policy proceedings_member_update on public.proceedings for update to authenticated using (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[])) with check (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[]));
create policy proceedings_manager_delete on public.proceedings for delete to authenticated using (public.has_office_role(office_id, array['manager']::text[]));

create policy service_actions_member_select on public.service_actions for select to authenticated using (public.is_office_member(office_id));
create policy service_actions_member_insert on public.service_actions for insert to authenticated with check (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[]));
create policy service_actions_member_update on public.service_actions for update to authenticated using (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[])) with check (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[]));
create policy service_actions_manager_delete on public.service_actions for delete to authenticated using (public.has_office_role(office_id, array['manager']::text[]));

create policy approval_requests_member_select on public.approval_requests for select to authenticated using (public.is_office_member(office_id));
create policy approval_requests_member_insert on public.approval_requests for insert to authenticated with check (public.is_office_member(office_id) and requested_by = (select auth.uid()));
create policy approval_requests_manager_update on public.approval_requests for update to authenticated using (public.has_office_role(office_id, array['manager']::text[])) with check (public.has_office_role(office_id, array['manager']::text[]));

comment on table public.legal_files is 'الملف القانوني الرئيسي، ويشمل الملفات القضائية والخدمات القانونية غير القضائية.';
comment on table public.proceedings is 'مرحلة قضائية داخل الملف القانوني؛ كل درجة تقاضٍ لها سجل مستقل مرتبط بالملف الرئيسي.';
comment on table public.service_actions is 'إجراءات الخدمات غير القضائية مثل الشهر العقاري وتأسيس الشركات.';
comment on table public.approval_requests is 'طلبات تعديل أو ترحيل يرسلها تطبيق الهاتف لاعتماد مالك المكتب.';

-- التحقق من أن نموذج المكتب ثابت كما اتفقنا.
update public.offices set office_name = 'مكتب جاد الرب للمحاماة والاستشارات القانونية', email = 'mahmoud.abdelhamyd@gmail.com' where office_id = '0c62b461-fe1f-49e3-98bf-1bb080bed80b';


-- فهارس مفاتيح الربط: تمنع تدهور الأداء عند زيادة الملفات والمراحل.
create index if not exists legal_files_responsible_user_idx on public.legal_files(responsible_user_id);
create index if not exists proceedings_parent_idx on public.proceedings(parent_proceeding_id);
create index if not exists proceedings_appeal_of_idx on public.proceedings(appeal_of_proceeding_id);
create index if not exists service_actions_file_idx on public.service_actions(legal_file_id);
create index if not exists service_actions_responsible_idx on public.service_actions(responsible_user_id);
create index if not exists approval_requests_requested_by_idx on public.approval_requests(requested_by);
create index if not exists approval_requests_reviewed_by_idx on public.approval_requests(reviewed_by);
create index if not exists cases_legal_file_idx on public.cases(legal_file_id);
create index if not exists cases_parent_case_idx on public.cases(parent_case_id);
create index if not exists cases_appeal_of_idx on public.cases(appeal_of_case_id);
create index if not exists sessions_legal_file_idx on public.sessions(legal_file_id);
create index if not exists sessions_proceeding_idx on public.sessions(proceeding_id);
create index if not exists tasks_legal_file_idx on public.tasks(legal_file_id);
create index if not exists tasks_proceeding_idx on public.tasks(proceeding_id);
create index if not exists notes_legal_file_idx on public.notes(legal_file_id);
create index if not exists notes_proceeding_idx on public.notes(proceeding_id);
