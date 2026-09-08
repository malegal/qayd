# تقرير مراجعة مستودع qayd

## نطاق المراجعة

تمت مراجعة مستودع `malegal/qayd` على GitHub، ومخطط مشروع Supabase `qayd` ذي المعرّف `mgvyieyismzzvdejsvcv`. شملت المراجعة واجهة إدارة المكتب، مسار فتح تفاصيل القضية، بنية الجداول، وتنبيهات Supabase الأمنية والأدائية.

## التعديل المنفذ

أُعيد تنظيم صفحة إدارة المكتب بحيث لا تتكرر إجراءات إنشاء القضية والملفات المهنية بين رأس الصفحة وشريط الاختصارات. أصبحت التسميات مختصرة مثل **قضية +** و**ملف مهني +** و**تحقيق +**، بينما تقتصر الاختصارات على الإجراءات غير المكررة مثل المستند والجلسة والبحث والمزامنة.

تم توسيع لوحة تفاصيل القضية الجانبية وجعلها المصدر الوحيد للتفاصيل، مع أزرار واضحة أسفل النتيجة لعرض **البيانات** أو **الجلسات** أو فتح **الأتعاب** أو **المستندات**، إضافة إلى التعديل والأرشفة. أزيل مودال تفاصيل القضية القديم الذي كان يكرر نفس المعرّفات ويؤدي إلى عرض التفاصيل في عنصر مختلف عن العنصر الظاهر للمستخدم.

تم كذلك إصلاح استدعاء `selectCase()` غير المعرفة في بطاقات القضايا؛ أصبحت البطاقات تستدعي `openCaseDetails()` مباشرة. كما تم ضبط عرض الملفات المهنية داخل اللوحة الجانبية دون إظهارها كجلسات قضائية.

## المشكلات التقنية المكتشفة

| المجال | الملاحظة | الحالة |
|---|---|---|
| واجهة المستخدم | تكرار أزرار إنشاء القضية والملف المهني في رأس الصفحة وشريط الاختصارات | تم الإصلاح |
| واجهة المستخدم | تكرار المعرّفات `caseDetailContent` و`caseDetailSessions` بين اللوحة والمودال، ما كان يجعل `getElementById` يحدّث العنصر الأول فقط | تم الإصلاح |
| JavaScript | بطاقات القضايا كانت تستدعي `selectCase()` رغم عدم وجود تعريف لها | تم الإصلاح |
| Supabase/RLS | جدولَا `office_files` و`file_events` مفعّل عليهما RLS دون سياسات | يحتاج قرارًا وتصحيحًا على مستوى الصلاحيات |
| Supabase/functions | دوال `SECURITY DEFINER` متاحة للتنفيذ من أدوار `anon` و`authenticated`، ومنها دوال عرض ومزامنة الملفات | يحتاج مراجعة صلاحيات؛ لم أغيّرها تلقائيًا لتجنب كسر بوابة العميل أو المزامنة |
| Supabase/functions | `generate_case_code` و`get_case_data` يستخدمان `search_path` قابلًا للتغيير | يحتاج تثبيت `search_path` صراحةً |
| Supabase/performance | مفاتيح أجنبية بلا فهارس تغطية في `file_events.office_id` و`payments.case_id` | تحسين موصى به |
| Dependencies | `npm audit --omit=dev --audit-level=high` لم يجد ثغرات عالية الخطورة في الاعتماديات الإنتاجية | ناجح |

## التحقق

نجحت الفحوص التالية:

- `node --check renderer.js`
- `node --check main.js`
- `node --check preload.js`
- `npm audit --omit=dev --audit-level=high`
- `git diff --check`
- التحقق من عدم تكرار معرّفات لوحة القضية
- التحقق من دفع التعديل إلى الفرع `main`

تم دفع التعديل إلى GitHub في الالتزام:

`2105707 fix: simplify office management case panel`

## ملاحظة حول قاعدة البيانات

لم تُطبّق تغييرات DDL أو سياسات RLS تلقائيًا، لأن ضبط سياسات الجداول والدوال يتطلب تحديد نموذج الصلاحيات المقصود بدقة: هل الوصول محصور بمكتب مسجل، أم توجد بوابة عميل عامة تعتمد على الهاتف والكود؟ تطبيق سياسة عامة غير دقيقة قد يمنع المزامنة أو يكشف بيانات مكتب لآخر. يوصى بتنفيذ migration منفصل بعد اعتماد نموذج الصلاحيات.

روابط التنبيهات المرجعية: [RLS enabled no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)، [mutable search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)، [security definer executable](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)، و[unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
