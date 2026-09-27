-- Qayd MJ finance v1: ربط الأتعاب والمدفوعات والمصروفات بالملف الرئيسي ومرحلة proceedings.
-- هذا الملف للمراجعة والتطبيق اليدوي فقط؛ لا يطبقه تطبيق سطح المكتب تلقائياً.
-- لا يحذف بيانات أو أعمدة قائمة، ويحافظ على مسار cases القديم.

-- 1) حقول الربط الاختيارية: تسمح للبيانات القديمة بالبقاء كما هي.
alter table if exists public.fees
  add column if not exists legal_file_id text,
  add column if not exists proceeding_id text,
  add column if not exists scope text not null default 'case';

alter table if exists public.payments
  add column if not exists office_id text,
  add column if not exists legal_file_id text,
  add column if not exists proceeding_id text,
  add column if not exists scope text not null default 'case';

alter table if exists public.expenses
  add column if not exists legal_file_id text,
  add column if not exists proceeding_id text,
  add column if not exists scope text not null default 'case';

alter table if exists public.financial_transactions
  add column if not exists legal_file_id text,
  add column if not exists proceeding_id text;

-- 2) العلاقات المرجعية. الحذف من الملف/المرحلة يحذف قيوده المالية التابعة.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fees_legal_file_id_fkey') then
    alter table public.fees add constraint fees_legal_file_id_fkey
      foreign key (legal_file_id) references public.legal_files(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fees_proceeding_id_fkey') then
    alter table public.fees add constraint fees_proceeding_id_fkey
      foreign key (proceeding_id) references public.proceedings(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_legal_file_id_fkey') then
    alter table public.payments add constraint payments_legal_file_id_fkey
      foreign key (legal_file_id) references public.legal_files(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_proceeding_id_fkey') then
    alter table public.payments add constraint payments_proceeding_id_fkey
      foreign key (proceeding_id) references public.proceedings(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_legal_file_id_fkey') then
    alter table public.expenses add constraint expenses_legal_file_id_fkey
      foreign key (legal_file_id) references public.legal_files(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_proceeding_id_fkey') then
    alter table public.expenses add constraint expenses_proceeding_id_fkey
      foreign key (proceeding_id) references public.proceedings(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'financial_transactions_legal_file_id_fkey') then
    alter table public.financial_transactions add constraint financial_transactions_legal_file_id_fkey
      foreign key (legal_file_id) references public.legal_files(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'financial_transactions_proceeding_id_fkey') then
    alter table public.financial_transactions add constraint financial_transactions_proceeding_id_fkey
      foreign key (proceeding_id) references public.proceedings(id) on delete cascade;
  end if;
end $$;

-- 3) نطاق السجل. القيم القديمة case/file تظل صالحة، وproceeding هو نطاق MJ الجديد.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fees_scope_check') then
    alter table public.fees add constraint fees_scope_check
      check (scope in ('case','file','proceeding'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_scope_check') then
    alter table public.payments add constraint payments_scope_check
      check (scope in ('case','file','proceeding'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_scope_check') then
    alter table public.expenses add constraint expenses_scope_check
      check (scope in ('case','file','proceeding'));
  end if;
end $$;

-- 4) تحديث قيد دفتر العمليات الموحد لقبول مرحلة proceedings.
alter table public.financial_transactions
  drop constraint if exists financial_scope_relation_check;

alter table public.financial_transactions
  add constraint financial_scope_relation_check check (
    (transaction_scope = 'office'
      and case_id is null and office_file_id is null
      and legal_file_id is null and proceeding_id is null)
    or
    (transaction_scope = 'case'
      and case_id is not null and office_file_id is null
      and legal_file_id is null and proceeding_id is null)
    or
    (transaction_scope = 'file'
      and case_id is null and proceeding_id is null
      and (office_file_id is not null or legal_file_id is not null))
    or
    (transaction_scope = 'proceeding'
      and proceeding_id is not null and legal_file_id is not null
      and case_id is null and office_file_id is null)
  );

-- 5) فهارس عمليات البحث والمزامنة.
create index if not exists fees_legal_file_idx
  on public.fees (legal_file_id) where legal_file_id is not null;
create index if not exists fees_proceeding_idx
  on public.fees (proceeding_id) where proceeding_id is not null;
create index if not exists payments_legal_file_idx
  on public.payments (legal_file_id) where legal_file_id is not null;
create index if not exists payments_proceeding_idx
  on public.payments (proceeding_id) where proceeding_id is not null;
create index if not exists expenses_legal_file_idx
  on public.expenses (legal_file_id) where legal_file_id is not null;
create index if not exists expenses_proceeding_idx
  on public.expenses (proceeding_id) where proceeding_id is not null;
create index if not exists financial_transactions_legal_file_idx
  on public.financial_transactions (legal_file_id) where legal_file_id is not null;
create index if not exists financial_transactions_proceeding_idx
  on public.financial_transactions (proceeding_id) where proceeding_id is not null;

-- 6) مفاتيح تعارض مناسبة للمزامنة الجديدة، مع إبقاء المفتاح القديم case_id.
create unique index if not exists fees_proceeding_unique_idx
  on public.fees (proceeding_id) where proceeding_id is not null;
create unique index if not exists fees_legal_file_unique_idx
  on public.fees (legal_file_id) where legal_file_id is not null and scope = 'file';

-- 7) سياسات MJ إضافية لا تلغي سياسات الإصدار القديم ولا تتجاوز اعتماد المالك.
-- القراءة تبقى وفق عضوية المكتب، أما الإدخال والتعديل والحذف المباشر فتظل للمالك.
drop policy if exists fees_mj_member_select on public.fees;
create policy fees_mj_member_select on public.fees for select to authenticated
  using (
    exists (select 1 from public.proceedings p where p.id = fees.proceeding_id and public.is_office_member(p.office_id))
    or exists (select 1 from public.legal_files f where f.id = fees.legal_file_id and public.is_office_member(f.office_id))
  );
drop policy if exists fees_mj_manager_insert on public.fees;
create policy fees_mj_manager_insert on public.fees for insert to authenticated
  with check (
    exists (select 1 from public.proceedings p where p.id = fees.proceeding_id and public.has_office_role(p.office_id, array['manager']::text[]))
    or exists (select 1 from public.legal_files f where f.id = fees.legal_file_id and public.has_office_role(f.office_id, array['manager']::text[]))
  );
drop policy if exists fees_mj_manager_update on public.fees;
create policy fees_mj_manager_update on public.fees for update to authenticated
  using (
    exists (select 1 from public.proceedings p where p.id = fees.proceeding_id and public.has_office_role(p.office_id, array['manager']::text[]))
    or exists (select 1 from public.legal_files f where f.id = fees.legal_file_id and public.has_office_role(f.office_id, array['manager']::text[]))
  ) with check (
    exists (select 1 from public.proceedings p where p.id = fees.proceeding_id and public.has_office_role(p.office_id, array['manager']::text[]))
    or exists (select 1 from public.legal_files f where f.id = fees.legal_file_id and public.has_office_role(f.office_id, array['manager']::text[]))
  );
drop policy if exists fees_mj_manager_delete on public.fees;
create policy fees_mj_manager_delete on public.fees for delete to authenticated
  using (
    exists (select 1 from public.proceedings p where p.id = fees.proceeding_id and public.has_office_role(p.office_id, array['manager']::text[]))
    or exists (select 1 from public.legal_files f where f.id = fees.legal_file_id and public.has_office_role(f.office_id, array['manager']::text[]))
  );

drop policy if exists payments_mj_accounting_select on public.payments;
create policy payments_mj_accounting_select on public.payments for select to authenticated
  using (
    exists (select 1 from public.proceedings p where p.id = payments.proceeding_id and public.has_office_role(p.office_id, array['manager','accountant']::text[]))
    or exists (select 1 from public.legal_files f where f.id = payments.legal_file_id and public.has_office_role(f.office_id, array['manager','accountant']::text[]))
  );
drop policy if exists payments_mj_manager_insert on public.payments;
create policy payments_mj_manager_insert on public.payments for insert to authenticated
  with check (
    exists (select 1 from public.proceedings p where p.id = payments.proceeding_id and public.has_office_role(p.office_id, array['manager']::text[]))
    or exists (select 1 from public.legal_files f where f.id = payments.legal_file_id and public.has_office_role(f.office_id, array['manager']::text[]))
  );
drop policy if exists payments_mj_manager_update on public.payments;
create policy payments_mj_manager_update on public.payments for update to authenticated
  using (
    exists (select 1 from public.proceedings p where p.id = payments.proceeding_id and public.has_office_role(p.office_id, array['manager']::text[]))
    or exists (select 1 from public.legal_files f where f.id = payments.legal_file_id and public.has_office_role(f.office_id, array['manager']::text[]))
  ) with check (
    exists (select 1 from public.proceedings p where p.id = payments.proceeding_id and public.has_office_role(p.office_id, array['manager']::text[]))
    or exists (select 1 from public.legal_files f where f.id = payments.legal_file_id and public.has_office_role(f.office_id, array['manager']::text[]))
  );
drop policy if exists payments_mj_manager_delete on public.payments;
create policy payments_mj_manager_delete on public.payments for delete to authenticated
  using (
    exists (select 1 from public.proceedings p where p.id = payments.proceeding_id and public.has_office_role(p.office_id, array['manager']::text[]))
    or exists (select 1 from public.legal_files f where f.id = payments.legal_file_id and public.has_office_role(f.office_id, array['manager']::text[]))
  );

drop policy if exists expenses_mj_member_select on public.expenses;
create policy expenses_mj_member_select on public.expenses for select to authenticated
  using (
    (proceeding_id is not null and public.is_office_member(office_id))
    or (legal_file_id is not null and public.is_office_member(office_id))
  );
drop policy if exists expenses_mj_manager_insert on public.expenses;
create policy expenses_mj_manager_insert on public.expenses for insert to authenticated
  with check (
    public.has_office_role(office_id, array['manager']::text[])
    and ((proceeding_id is not null and exists (select 1 from public.proceedings p where p.id = expenses.proceeding_id and p.office_id = expenses.office_id))
      or (legal_file_id is not null and exists (select 1 from public.legal_files f where f.id = expenses.legal_file_id and f.office_id = expenses.office_id)))
  );
drop policy if exists expenses_mj_manager_update on public.expenses;
create policy expenses_mj_manager_update on public.expenses for update to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]))
  with check (public.has_office_role(office_id, array['manager']::text[]));
drop policy if exists expenses_mj_manager_delete on public.expenses;
create policy expenses_mj_manager_delete on public.expenses for delete to authenticated
  using (public.has_office_role(office_id, array['manager']::text[]));

comment on column public.fees.proceeding_id is 'مرحلة proceedings التي تخصها الأتعاب؛ يظل null للسجلات القديمة.';
comment on column public.fees.legal_file_id is 'الملف الرئيسي MJ المرتبط بالأتعاب.';
comment on column public.payments.proceeding_id is 'مرحلة proceedings التي تخصها الدفعة.';
comment on column public.expenses.proceeding_id is 'مرحلة proceedings التي تخصها المصروفات.';
comment on column public.financial_transactions.proceeding_id is 'مرحلة proceedings في دفتر العمليات الموحد.';
