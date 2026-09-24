-- Qayd: دعم مزامنة أحداث الأجندة (events) بين سطح المكتب والهاتف.
-- مبدأ التعديل: إضافة فقط — لا نحذف بيانات ولا نغيّر بنية الجداول القائمة إلا بإضافة أعمدة.
-- يُطبّق هذا الملف يدويًا في محرّر SQL بمشروع Supabase (لا يُطبّق تلقائيًا من العميل).
--
-- المشكلة التي يحلّها:
--   جدول public.events كان عليه RLS مفعّل بدون أي سياسة، لذلك فشل أي إدراج/تحديث من العميل
--   (رمز 42501: new row violates row-level security policy). كما أن دالة المزامنة
--   apply_mobile_operation لم تكن تدعم النوع 'events'. نتيجةً لذلك لم تكن أحداث الأجندة
--   تُزامَن مع Supabase إطلاقًا. هذا الملف يضيف الدعم المفقود دون المساس بأي شيء قائم.

-- 1) عمود updated_at إضافي لجدول الأحداث (إضافة فقط، متوافق مع الخزين المحلي).
alter table if exists public.events
  add column if not exists updated_at timestamptz not null default now();

comment on column public.events.updated_at is 'آخر تحديث للحدث؛ يُستخدم لفرز وتتبّع المزامنة.';

-- 2) سياسات RLS لجدول events (كان مفعّلًا بدون سياسات).
alter table if exists public.events enable row level security;

drop policy if exists events_member_select on public.events;
drop policy if exists events_manager_insert on public.events;
drop policy if exists events_manager_update on public.events;
drop policy if exists events_manager_delete on public.events;

-- كل أعضاء المكتب يقرؤون أحداث المكتب (للمزامنة).
create policy events_member_select on public.events for select to authenticated
  using (public.is_office_member(office_id));

-- المالك فقط (manager) يضيف/يعدّل/يحذف الأحداث، تماشيًا مع باقي الجداول التشغيلية.
create policy events_manager_insert on public.events for insert to authenticated
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy events_manager_update on public.events for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
create policy events_manager_delete on public.events for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

-- 3) توسيع دالة المزامنة apply_mobile_operation لتدعم 'events'.
--    نُبقي كل الأنواع السابقة كما هي عبر التفويض إلى apply_mobile_operation_legacy،
--    ونضيف فرعًا جديدًا فقط للنوع 'events'. لا تغيير في سلوك الأنواع الأخرى.
create or replace function public.apply_mobile_operation(
  p_operation_id uuid,
  p_office_id text,
  p_entity_type text,
  p_entity_id text,
  p_operation text,
  p_payload jsonb,
  p_base_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare existing_status text;
begin
  -- نفس شرط الحماية الحالي: الكتابة تتطلب مالك المكتب.
  if auth.uid() is null or not public.has_office_role(p_office_id, array['manager']::text[]) then
    raise exception 'mobile writes require owner approval';
  end if;

  if p_entity_type = 'events' then
    -- منع التكرار عند إعادة إرسال نفس العملية.
    select status into existing_status from public.sync_operations where operation_id = p_operation_id;
    if existing_status is not null then
      return jsonb_build_object('status', existing_status, 'operation_id', p_operation_id, 'entity_id', p_entity_id);
    end if;

    if p_operation = 'delete' then
      delete from public.events where id = p_entity_id and office_id = p_office_id;
    else
      insert into public.events (id, office_id, title, date, type, created_at, updated_at)
      values (
        p_entity_id,
        p_office_id,
        coalesce(p_payload->>'title', ''),
        p_payload->>'date',
        coalesce(p_payload->>'type', 'other'),
        coalesce((p_payload->>'created_at')::timestamptz, now()),
        now()
      )
      on conflict (id) do update
        set title = excluded.title,
            date = excluded.date,
            type = excluded.type,
            updated_at = now();
    end if;

    insert into public.sync_operations(operation_id, office_id, user_id, entity_type, entity_id, operation, payload, base_updated_at, status)
    values (p_operation_id, p_office_id, auth.uid(), 'events', p_entity_id, p_operation, p_payload, p_base_updated_at, 'applied');

    return jsonb_build_object('status', 'applied', 'operation_id', p_operation_id, 'entity_id', p_entity_id);
  end if;

  -- كل الأنواع الأخرى: التفويض إلى الدالة القديمة دون أي تغيير.
  return public.apply_mobile_operation_legacy(p_operation_id, p_office_id, p_entity_type, p_entity_id, p_operation, p_payload, p_base_updated_at);
end;
$$;

revoke execute on function public.apply_mobile_operation(uuid,text,text,text,text,jsonb,timestamptz) from public, anon;
grant execute on function public.apply_mobile_operation(uuid,text,text,text,text,jsonb,timestamptz) to authenticated;

-- 4) فهرس للبحث السريع حسب المكتب والتاريخ (إضافة فقط).
create index if not exists events_office_date_idx on public.events (office_id, date);

-- 5) التحقق.
select count(*) as events_rows from public.events limit 1;
