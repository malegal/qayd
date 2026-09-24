-- ============================================================================
-- migration: owner RLS allowlist  (إصلاح خطأ المزامنة: insert_case row-level security)
-- ----------------------------------------------------------------------------
-- السبب: سياسات RLS على جدول cases (والجداول التابعة) تعتمد على has_office_role /
-- can_office_role، وهذه تعتمد بدورها على وجود صف في office_members يحمل دور manager.
-- على جهاز المالك قد لا يوجد هذا الصف (أو يُرفض إدراجه بسبب RLS على office_members)،
-- فتفشل المزامنة برسالة: insert_case: new row violates row-level security policy.
--
-- الحل: نجعل مالك المكتب (المطابق لبريد المالك في جدول offices) يُعرَف دائماً كـ manager
-- دون الاعتماد على office_members، مع توفير دالة self-provisioning لتثبيت العضوية.
--
-- ملاحظة: هذا الملف يُطبَّق يدوياً في محرر SQL بمشروع Supabase.
-- لا نحذف أي شيء — نضيف/نستبدل الدوال والسياسات فقط.
-- ============================================================================

-- 1) بريد مالك المكتب من جدول offices -----------------------------------------
create or replace function public.owner_email_for_office(p_office_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(o.email) from public.offices o where o.office_id = p_office_id limit 1;
$$;
revoke execute on function public.owner_email_for_office(text) from public, anon;
grant execute on function public.owner_email_for_office(text) to authenticated;

-- 2) هل المستخدم الحالي هو مالك المكتب؟ ---------------------------------------
create or replace function public.is_office_owner(p_office_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(coalesce(auth.jwt() ->> 'email', '')) = public.owner_email_for_office(p_office_id),
    false
  );
$$;
revoke execute on function public.is_office_owner(text) from public, anon;
grant execute on function public.is_office_owner(text) to authenticated;

-- 3) has_office_role: يعترف بالمالك دائماً كـ manager --------------------------
create or replace function public.has_office_role(p_office_id text, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.office_members m
    where m.office_id = p_office_id
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  )
  or ('manager' = any(p_roles) and public.is_office_owner(p_office_id));
$$;
revoke execute on function public.has_office_role(text, text[]) from public, anon;
grant execute on function public.has_office_role(text, text[]) to authenticated;

-- 4) can_office_role: مرادف موحّد يستخدم نفس المنطق ----------------------------
create or replace function public.can_office_role(p_office_id text, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_office_role(p_office_id, p_roles);
$$;
revoke execute on function public.can_office_role(text, text[]) from public, anon;
grant execute on function public.can_office_role(text, text[]) to authenticated;

-- 5) is_office_member: المالك يُعدّ عضواً دائماً --------------------------------
-- (نُعيد تعريفها فقط إن كانت موجودة أصلاً؛ الشرط IF EXISTS يحمي من الخطأ)
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_office_member'
      and pg_get_function_identity_arguments(p.oid) = 'text'
  ) then
    execute $fn$
      create or replace function public.is_office_member(p_office_id text)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select exists (
          select 1 from public.office_members m
          where m.office_id = p_office_id and m.user_id = auth.uid()
        )
        or public.is_office_owner(p_office_id);
      $body$;
    $fn$;
    execute 'revoke execute on function public.is_office_member(text) from public, anon';
    execute 'grant execute on function public.is_office_member(text) to authenticated';
  end if;
end $$;

-- 6) تثبيت عضوية المالك (self-provisioning) -----------------------------------
-- يستدعيها تطبيق سطح المكتب بعد تسجيل الدخول لضمان وجود صف office_members بدور manager.
create or replace function public.ensure_owner_membership(p_office_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_owner_email text := public.owner_email_for_office(p_office_id);
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_owner_email is null or v_email <> v_owner_email then
    raise exception 'only the office owner may self-provision membership';
  end if;

  insert into public.office_members (user_id, office_id, role, display_name)
  values (v_uid, p_office_id, 'manager', 'مالك المكتب')
  on conflict (user_id, office_id) do update set role = 'manager';

  return 'manager';
end;
$$;
revoke execute on function public.ensure_owner_membership(text) from public, anon;
grant execute on function public.ensure_owner_membership(text) to authenticated;

-- 7) سياسة تسمح للمالك بإدارة عضويته في office_members (إن كان الجدول محمياً) ---
-- نضيف السياسات فقط إن كان الجدول موجوداً.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'office_members'
  ) then
    execute 'alter table public.office_members enable row level security';
    execute 'drop policy if exists office_members_owner_insert on public.office_members';
    execute 'create policy office_members_owner_insert on public.office_members for insert to authenticated with check (public.is_office_owner(office_id))';
    execute 'drop policy if exists office_members_owner_update on public.office_members';
    execute 'create policy office_members_owner_update on public.office_members for update to authenticated using (public.is_office_owner(office_id)) with check (public.is_office_owner(office_id))';
    execute 'drop policy if exists office_members_self_select on public.office_members';
    execute 'create policy office_members_self_select on public.office_members for select to authenticated using (user_id = auth.uid() or public.is_office_owner(office_id))';
  end if;
end $$;

-- 8) إعادة تأكيد سياسات الكتابة للمالك على الجداول الأساسية (manager) -----------
-- cases
drop policy if exists cases_member_insert on public.cases;
create policy cases_member_insert on public.cases for insert to authenticated
  with check (public.has_office_role(office_id, array['manager','lawyer','staff','accountant']::text[]));
drop policy if exists cases_owner_update on public.cases;
create policy cases_owner_update on public.cases for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
drop policy if exists cases_owner_delete on public.cases;
create policy cases_owner_delete on public.cases for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

-- 9) تحديث apply_mobile_operation ليستخدم is_office_owner أيضاً -----------------
-- (لا نُعيد كتابة الدالة بالكامل؛ نكتفي بأن has_office_role صارت تعترف بالمالك،
--  وكل الفحوص داخلها تمر عبر has_office_role / can_office_role.)

-- نهاية الملف.
