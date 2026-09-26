-- مراحل التقاضي مجلدات وسجلات داخل القضية الرئيسية، ولكل مرحلة حساب مالي مستقل.
alter table public.sessions add column if not exists stage_id text;
create table if not exists public.case_stages (
  id text primary key,
  case_id text not null references public.cases(id) on delete cascade,
  office_id text not null references public.offices(office_id) on delete cascade,
  legacy_case_id text,
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
alter table public.case_stages add column if not exists legacy_case_id text;
create unique index if not exists case_stages_legacy_case_uidx on public.case_stages(legacy_case_id) where legacy_case_id is not null;
create index if not exists case_stages_case_created_idx on public.case_stages(case_id, created_at);

create table if not exists public.stage_fees (
  stage_id text primary key references public.case_stages(id) on delete cascade,
  case_id text not null references public.cases(id) on delete cascade,
  office_id text not null references public.offices(office_id) on delete cascade,
  total numeric not null default 0,
  paid numeric not null default 0,
  remaining numeric not null default 0,
  notes text,
  updated_at timestamptz not null default now()
);
create table if not exists public.stage_payments (
  id uuid primary key,
  stage_id text not null references public.case_stages(id) on delete cascade,
  case_id text not null references public.cases(id) on delete cascade,
  office_id text not null references public.offices(office_id) on delete cascade,
  amount numeric not null,
  date date not null,
  note text,
  created_at timestamptz not null default now()
);
create table if not exists public.stage_expenses (
  id uuid primary key,
  stage_id text not null references public.case_stages(id) on delete cascade,
  case_id text not null references public.cases(id) on delete cascade,
  office_id text not null references public.offices(office_id) on delete cascade,
  amount numeric not null,
  expense_date date not null,
  category text,
  created_at timestamptz not null default now()
);
create index if not exists stage_payments_stage_idx on public.stage_payments(stage_id, date);
create index if not exists stage_expenses_stage_idx on public.stage_expenses(stage_id, expense_date);

alter table public.case_stages enable row level security;
alter table public.stage_fees enable row level security;
alter table public.stage_payments enable row level security;
alter table public.stage_expenses enable row level security;
