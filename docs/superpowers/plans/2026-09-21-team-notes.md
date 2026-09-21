# Team Notes Implementation Plan

> **For agentic workers:** تنفيذ الخطة خطوة بخطوة مع اختبار كل جزء قبل الالتزام.

**Goal:** إضافة ملاحظات فريق حقيقية قابلة للعرض والإنشاء والتعديل والحذف من الهاتف وسطح المكتب، مع صلاحيات RLS واضحة.

**Architecture:** جدول `team_notes` في `public` مرتبط بالمكتب وبالقضية اختيارياً، ويحمل `author_id` ووقت الإنشاء والتعديل. القراءة لكل عضو نشط في المكتب؛ التعديل والحذف للمالك على كل ملاحظات المكتب وللكاتب على ملاحظاته فقط؛ الإنشاء لكل عضو نشط. الواجهتان تستخدمان Supabase مباشرة ولا تمرران أي حقول مالية.

**Tech Stack:** Supabase PostgreSQL/RLS، Supabase JS، Electron renderer، Expo React Native، TypeScript/Vitest.

**Spec:** صلاحيات ملاحظات الفريق المطلوبة في طلب المستخدم بتاريخ 2026-09-21.

## Global Constraints

- لا يتم كشف الأتعاب أو الدخل أو المصروفات من شاشة الملاحظات.
- لا يعتمد التفويض على `user_metadata`.
- كل استعلام قراءة يحدد المكتب الحالي ولا يقرأ بيانات مكتب آخر.
- القضايا اختيارية في الملاحظة؛ الملاحظة العامة تكون على مستوى المكتب.
- لا يتم تعديل ملفات Migration السابقة؛ يضاف Migration جديد قابل للمراجعة.

## Review Focus

- عضو غير نشط أو من مكتب آخر لا يرى الملاحظة ولا ينشئها.
- الكاتب يعدل ويحذف ملاحظته فقط؛ العضو الآخر لا يعدلها.
- المالك يعدل ويحذف أي ملاحظة في مكتبه.
- الملاحظة المرتبطة بقضية لا تمنح وصولاً إلى بيانات القضية أو المالية.
- النص الفارغ أو الطويل يرفضه التحقق في الواجهة وقاعدة البيانات.

---

### Task 1: Database schema and RLS

**Files:** Create a new SQL migration beside existing migrations; add a mobile/desktop data contract only if needed.

- [ ] Create `team_notes` with UUID id, office_id, optional case_id, author_id, body, created_at, updated_at, archived_at.
- [ ] Enable RLS and add authenticated policies using active office membership and owner/member role checks.
- [ ] Add indexes on `(office_id, created_at desc)` and `(case_id, created_at desc)`.
- [ ] Grant Data API access only to authenticated and verify the table is exposed.
- [ ] Apply and verify with limited SQL queries and security checks.

### Task 2: Desktop notes workspace

**Files:** `index.html`, `renderer.js`.

- [ ] Add an owner/team notes entry point to the existing office navigation.
- [ ] Render office notes and optional case labels with author and timestamps.
- [ ] Add create, edit, delete actions according to the role rules.
- [ ] Add loading, empty, validation, and error states without exposing finance fields.
- [ ] Verify owner-only controls and stale-session behavior.

### Task 3: Mobile notes workspace

**Files:** `app/(tabs)/...`, `lib/...` according to existing navigation/data patterns.

- [ ] Add a Notes tab or accessible team-notes screen.
- [ ] Render office/case filters, author, timestamp, and body.
- [ ] Add create/edit/delete actions with the same server-enforced role rules.
- [ ] Ensure the screen contains no fees, income, or expense totals.

### Task 4: Tests, builds, and commits

- [ ] Add/extend permission tests for reader, author, and owner behavior.
- [ ] Run TypeScript checks and Vitest in the mobile repository; run JavaScript syntax and diff checks in desktop.
- [ ] Build desktop and mobile artifacts where credentials permit.
- [ ] Commit and push database/desktop/mobile changes as reviewable commits.
