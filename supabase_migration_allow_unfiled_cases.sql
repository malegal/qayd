-- السماح بفتح ملف قضائي قبل صدور رقم الدعوى أو المحكمة.
alter table public.cases alter column case_number drop not null;
alter table public.cases alter column case_year drop not null;
-- عند القيد يستكمل التطبيق case_number وcase_year وcourt_name وcircuit ويغير الحالة.
