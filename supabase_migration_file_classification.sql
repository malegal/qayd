-- توسيع تصنيف office_files إلى ملفات إجرائية وخدمية.
-- القضايا القضائية تبقى في جدول cases لأنها وحدها تملك جلسات محكمة.

alter table if exists public.office_files drop constraint if exists office_files_code_format;
alter table if exists public.office_files drop constraint if exists office_files_type_check;
alter table if exists public.office_files drop constraint if exists office_files_type_code_check;

alter table if exists public.office_files add constraint office_files_code_format check (
  file_code ~ '^(RE|CT|CO|PI|DR|DC|GR|PR|AD)-[0-9]{2}-(?:[0-9]{4}|[0-9]{6})-[A-Z0-9]{6}$'
);

alter table if exists public.office_files add constraint office_files_type_check check (
  file_type in (
    'prosecution_investigation', 'detention_renewal', 'dispute_committee',
    'grievance', 'legal_procedure', 'real_estate', 'contract_writing',
    'company_formation', 'administrative'
  )
);

alter table if exists public.office_files add constraint office_files_type_code_check check (
  (file_type = 'prosecution_investigation' and file_code like 'PI-%') or
  (file_type = 'detention_renewal' and file_code like 'DR-%') or
  (file_type = 'dispute_committee' and file_code like 'DC-%') or
  (file_type = 'grievance' and file_code like 'GR-%') or
  (file_type = 'legal_procedure' and file_code like 'PR-%') or
  (file_type = 'real_estate' and file_code like 'RE-%') or
  (file_type = 'contract_writing' and file_code like 'CT-%') or
  (file_type = 'company_formation' and file_code like 'CO-%') or
  (file_type = 'administrative' and file_code like 'AD-%')
);
