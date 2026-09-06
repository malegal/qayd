-- إنشاء بنية الملفات المهنية مع إبقاء جدول cases ومسار القضايا القضائية دون تغيير.

create table if not exists public.office_files (
  id text primary key,
  office_id text not null references public.offices(office_id) on update cascade on delete restrict,
  file_code text not null unique,
  file_type text not null,
  title text not null,
  client_name text not null,
  client_phone text not null,
  status text not null default 'مفتوح',
  description text,
  metadata jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint office_files_code_not_blank check (btrim(file_code) <> ''),
  constraint office_files_code_format check (file_code ~ '^(RE|CT|CO|PI|DR|AD)-[0-9]{2}-(?:[0-9]{4}|[0-9]{6})-[A-Z0-9]{6}$'),
  constraint office_files_type_check check (file_type in ('real_estate', 'contract_writing', 'company_formation', 'prosecution_investigation', 'detention_renewal', 'administrative')),
  constraint office_files_type_code_check check (
    (file_type = 'real_estate' and file_code like 'RE-%') or
    (file_type = 'contract_writing' and file_code like 'CT-%') or
    (file_type = 'company_formation' and file_code like 'CO-%') or
    (file_type = 'prosecution_investigation' and file_code like 'PI-%') or
    (file_type = 'detention_renewal' and file_code like 'DR-%') or
    (file_type = 'administrative' and file_code like 'AD-%')
  )
);

-- تحديث قيود الأنواع والأكواد عند تشغيل هذه الترحيلة على قاعدة موجودة.
alter table if exists public.office_files drop constraint if exists office_files_code_format;
alter table if exists public.office_files drop constraint if exists office_files_type_check;
alter table if exists public.office_files drop constraint if exists office_files_type_code_check;
alter table if exists public.office_files add constraint office_files_code_format check (file_code ~ '^(RE|CT|CO|PI|DR|AD)-[0-9]{2}-(?:[0-9]{4}|[0-9]{6})-[A-Z0-9]{6}$');
alter table if exists public.office_files add constraint office_files_type_check check (file_type in ('real_estate', 'contract_writing', 'company_formation', 'prosecution_investigation', 'detention_renewal', 'administrative'));
alter table if exists public.office_files add constraint office_files_type_code_check check (
  (file_type = 'real_estate' and file_code like 'RE-%') or
  (file_type = 'contract_writing' and file_code like 'CT-%') or
  (file_type = 'company_formation' and file_code like 'CO-%') or
  (file_type = 'prosecution_investigation' and file_code like 'PI-%') or
  (file_type = 'detention_renewal' and file_code like 'DR-%') or
  (file_type = 'administrative' and file_code like 'AD-%')
);

create table if not exists public.file_events (
  id text primary key,
  office_id text not null references public.offices(office_id) on update cascade on delete restrict,
  file_id text not null references public.office_files(id) on update cascade on delete cascade,
  event_date text not null,
  event_type text not null default 'update',
  status text not null default 'مفتوح',
  title text not null,
  details text,
  client_visible boolean not null default true,
  created_at timestamptz not null default now(),
  constraint file_events_type_check check (event_type in ('created', 'update', 'document_required', 'document_received', 'submitted', 'completed', 'note'))
);

create index if not exists office_files_phone_code_idx on public.office_files (client_phone, file_code);
create index if not exists office_files_office_type_idx on public.office_files (office_id, file_type, archived);
create index if not exists file_events_file_date_idx on public.file_events (file_id, event_date desc, created_at desc);

alter table public.office_files enable row level security;
alter table public.file_events enable row level security;

-- لا نفتح قراءة مباشرة للعميل؛ القراءة العامة تتم فقط من خلال RPC المقيد بالهاتف والكود.
revoke all on table public.office_files from anon, authenticated;
revoke all on table public.file_events from anon, authenticated;

drop function if exists public.get_portal_file_data(text, text);

create or replace function public.get_portal_file_data(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_code text := upper(btrim(coalesce(p_code, '')));
  case_row jsonb;
  professional_row jsonb;
  event_rows jsonb;
  session_rows jsonb;
begin
  if normalized_phone = '' or normalized_code = '' then
    return null;
  end if;

  select to_jsonb(c)
    into case_row
    from public.cases c
   where upper(c.case_code) = normalized_code
     and regexp_replace(coalesce(c.client_phone, ''), '[^0-9]', '', 'g') = normalized_phone
   limit 1;

  if case_row is not null then
    select coalesce(jsonb_agg(to_jsonb(s) order by s.session_date desc, s.created_at desc), '[]'::jsonb)
      into session_rows
      from public.sessions s
     where s.case_id = case_row->>'id';

    return jsonb_build_object(
      'file_type', 'judicial',
      'file', case_row,
      'events', session_rows
    );
  end if;

  select to_jsonb(f)
    into professional_row
    from public.office_files f
   where upper(f.file_code) = normalized_code
     and regexp_replace(coalesce(f.client_phone, ''), '[^0-9]', '', 'g') = normalized_phone
     and f.archived = false
   limit 1;

  if professional_row is null then
    return null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.event_date desc, e.created_at desc), '[]'::jsonb)
    into event_rows
    from public.file_events e
   where e.file_id = professional_row->>'id'
     and e.client_visible = true;

  return jsonb_build_object(
    'file_type', professional_row->>'file_type',
    'file', professional_row,
    'events', event_rows
  );
end;
$$;

grant execute on function public.get_portal_file_data(text, text) to anon, authenticated;

comment on table public.office_files is 'ملفات الخدمات المهنية غير القضائية التي يديرها qayd ويستعلم عنها العميل بالكود والهاتف.';
comment on table public.file_events is 'مراحل وتحديثات الملفات المهنية القابلة للعرض للعميل.';
comment on function public.get_portal_file_data(text, text) is 'استعلام موحد آمن يعيد قضية قضائية أو ملف خدمة مهنية عند تطابق الهاتف والكود.';
