# توحيد الملفات الرئيسية MJ وترحيل البيانات Implementation Plan

> **For agentic workers:** تنفيذ الخطة داخل فرع العمل الحالي وباختبارات قابلة لإعادة التشغيل.

**Goal:** اعتماد الملف الرئيسي MJ كواجهة موحدة، وربط القضايا القديمة كمراحل فرعية دون حذف أو استبدال البيانات الأصلية.

**Architecture:** إضافة وحدة ترحيل نقية تخطط للربط ثم تنفذ عمليات `put/update` محلية بمعرفات حتمية وآمنة لإعادة التشغيل. تبقى سجلات `cases` و`officeFiles` موجودة للتوافق، لكن تُربط بملفات `legalFiles` عبر `legal_file_id` وتظهر واجهة MJ كالمسار الأساسي.

**Tech Stack:** Electron، IndexedDB عبر Dexie، JavaScript، Supabase sync queue، Node assert tests.

**Spec:** `docs/legal-file-model.md`.

## Global Constraints

- لا حذف للسجلات القديمة أثناء الترحيل.
- لا تغيير في Supabase أو migration خارجي في هذه المرحلة؛ الترحيل المحلي يضيف عمليات مزامنة قابلة لإعادة المحاولة.
- إعادة تشغيل الترحيل لا تنشئ ملفات أو مراحل مكررة.
- الملف الرئيسي يحمل كود MJ، والمرحلة القديمة تحتفظ بـ `case_code` وبياناتها الأصلية.
- كل تغيير محلي يُسجل في `pendingOperations` بعد الكتابة الناجحة.

## Review Focus

- قضية قديمة لها مراحل مرتبطة: تجمع في ملف رئيسي واحد.
- قضية قديمة بلا `root_case_id`: تُنشئ ملفًا رئيسيًا مستقلًا.
- ملف خدمة قديم: يُنقل إلى `legalFiles` مع إجراء خدمة، دون تحويله إلى مرحلة قضائية.
- تشغيل الترحيل مرتين: لا ازدواجية.
- فشل جزئي: لا حذف، وتبقى العمليات قابلة للاستئناف.

## Tasks

### Task 1: Migration planning API

**Files:** Create `qayd-migration.js`; Test `test/mj-migration.test.js`; Modify `package.json`.

- [ ] اكتب اختبارات فاشلة لـ `buildPlan` حول التجميع، الحفاظ على المعرفات، وعدم التكرار.
- [ ] شغّل الاختبارات وتأكد من فشلها بسبب غياب الوحدة.
- [ ] نفذ `buildPlan(input)` كدالة نقية تعيد `legalFiles`, `caseUpdates`, `proceedings`, `serviceFiles`.
- [ ] شغّل الاختبارات وتأكد من نجاحها.

### Task 2: Local migration executor

**Files:** Modify `qayd-migration.js`, `renderer.js`.

- [ ] أضف `migrateLegacyData({db, officeId, now})` بمعاملة منطقية: يخطط، يكتب `legalFiles`، يربط `cases`، ينشئ `proceedings`، ثم يضيف طابور المزامنة.
- [ ] استخدم metadata marker `legacy_migration_v1` ومعرفات حتمية لمنع التكرار.
- [ ] شغّل الترحيل بعد التحقق من المكتب وقبل تحميل القوائم.
- [ ] عند الخطأ، سجّل الخطأ دون حذف أي سجل.

### Task 3: MJ-first interface

**Files:** Modify `index.html`, `renderer.js`, `qayd-main-file.js`.

- [ ] اجعل زر الملفات الرئيسية MJ هو المدخل الأساسي في قسم القضايا.
- [ ] أضف حالة واضحة للبيانات المرحّلة ووسم «مرحلة قديمة مرتبطة» عند الحاجة.
- [ ] اجعل عرض المراحل يقرأ `cases` المرتبطة، مع fallback إلى `proceedings`.
- [ ] لا تحذف المسارات القديمة حتى يتم التحقق من الترحيل.

### Task 4: Verification

- [ ] شغّل اختبارات Node.
- [ ] شغّل `node --check` لكل ملفات JavaScript.
- [ ] شغّل Electron smoke test.
- [ ] تحقق من عدم تكرار MJ عند إعادة الترحيل.
- [ ] راجع `git diff --check` وملفات الترحيل قبل إعلان النتيجة.
