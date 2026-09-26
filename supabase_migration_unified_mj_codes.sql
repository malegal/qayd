-- توحيد أكواد مكتب جاد الرب: MJ-YY-NNNN-RANDOM
-- لا يغيّر الأكواد القديمة؛ يسمح بقراءتها ومزامنتها حتى لا تتعطل المجلدات القائمة.

alter table if exists public.office_files drop constraint if exists office_files_code_format;
alter table if exists public.office_files drop constraint if exists office_files_type_code_check;
alter table if exists public.office_files add constraint office_files_code_format check (
  file_code ~ '^(?:(?:MJ|J|M)-[0-9]{2}-[0-9]{4}-[A-Z0-9]{6}|(?:RE|CT|CO|PI|DR|DC|GR|PR|AD)-[0-9]{2}-(?:[0-9]{4}|[0-9]{6})-[A-Z0-9]{6})$'
);
-- لم يعد نوع الملف يغيّر البادئة؛ النوع محفوظ في file_type فقط.
alter table if exists public.office_files drop constraint if exists office_files_type_check;
alter table if exists public.office_files add constraint office_files_type_check check (
  file_type in ('prosecution_investigation','detention_renewal','dispute_committee','grievance','legal_procedure','real_estate','contract_writing','company_formation','administrative')
);

-- legal_files هو السجل الموحد للملفات القانونية، ولذلك يقبل الصيغة نفسها.
alter table if exists public.legal_files drop constraint if exists legal_files_code_format;
alter table if exists public.legal_files add constraint legal_files_code_format check (
  file_code ~ '^(?:(?:MJ|J|M)-[0-9]{2}-[0-9]{4}-[A-Z0-9]{6}|JELR-[0-9]{2}-[0-9]{4}-[A-Z0-9]{6})$'
);

create index if not exists office_files_office_code_idx on public.office_files(office_id, file_code);
create index if not exists legal_files_office_code_idx on public.legal_files(office_id, file_code);

comment on column public.office_files.file_code is 'كود يولده تطبيق قيد محلياً؛ MJ موحد لكل أنواع الملفات، مع إبقاء الأكواد القديمة قابلة للقراءة.';
comment on column public.legal_files.file_code is 'كود يولده تطبيق قيد محلياً؛ لا تنشئ قاعدة البيانات أرقام الملفات.';
