-- Qayd case status v1
-- يضيف حالة تشغيلية للقضية لتتطابق مع لوحة المالك ونماذج الإنشاء والتعديل.
-- لا يحذف بيانات ولا يغيّر القضايا الموجودة إلا بإسناد الحالة الافتراضية «جديدة».

alter table public.cases
  add column if not exists status text not null default 'جديدة';

comment on column public.cases.status is 'الحالة التشغيلية للقضية: جديدة، قيد الرفع، قيد النظر، مؤجلة، للحكم، تم الحكم، منتهية، مؤرشفة';

create index if not exists cases_office_status_idx on public.cases (office_id, status);

select count(*) as cases_with_status from public.cases limit 1;
