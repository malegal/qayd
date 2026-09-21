-- خطر: هذا الملف يحذف بيانات المكتب التشغيلية من Supabase ولا يحذف المخطط.
-- لا تُشغّله من التطبيق. طبّقه فقط بعد نسخة احتياطية وموافقة مالك البيانات.
-- يحتفظ بالمكتب والمالك والترخيص، ويمسح السجلات التشغيلية والطوابير والإشعارات.

begin;

-- الجداول التابعة أولاً لتجنب كسر المفاتيح الأجنبية.
delete from public.file_documents;
delete from public.file_events;
delete from public.notes;
delete from public.payments;
delete from public.fees;
delete from public.expenses;
delete from public.financial_transactions;
delete from public.sessions;
delete from public.tasks;
delete from public.events;
delete from public.office_files;
delete from public.cases;
delete from public.sync_operations;
delete from public.audit_logs;
delete from public.office_notifications;
delete from public.office_member_devices;

-- الدعوات القديمة ورموز الاسترداد لا تمثل بيانات قضايا، لكنها يجب ألا تبقى صالحة بعد التهيئة.
delete from public.office_invites;
delete from public.owner_recovery_codes;

-- تحقق قبل commit ثم نفّذ commit يدوياً بعد مراجعة النتائج.
select office_id, office_name, email from public.offices limit 10;
select count(*) as remaining_cases from public.cases limit 1;
select count(*) as remaining_sessions from public.sessions limit 1;

-- rollback;
-- commit;
