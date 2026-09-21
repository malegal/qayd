-- Qayd owner approvals and sync conflicts v1
-- لا يغير هذا الترحيل بيانات المكتب ولا يحذف سجلات قائمة.

create table if not exists public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  office_id text not null references public.offices(office_id) on delete cascade,
  operation_id uuid,
  entity_type text not null,
  entity_id text not null,
  local_payload jsonb not null default '{}'::jsonb,
  remote_payload jsonb not null default '{}'::jsonb,
  base_updated_at timestamptz,
  status text not null default 'pending' check (status in ('pending','resolved_local','resolved_remote','dismissed')),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create index if not exists sync_conflicts_office_status_idx on public.sync_conflicts(office_id, status, created_at desc);
create index if not exists sync_conflicts_entity_idx on public.sync_conflicts(office_id, entity_type, entity_id, created_at desc);
create index if not exists sync_conflicts_resolved_by_idx on public.sync_conflicts(resolved_by);
create unique index if not exists sync_conflicts_operation_id_uq on public.sync_conflicts(operation_id) where operation_id is not null;

alter table public.sync_conflicts enable row level security;
create policy sync_conflicts_member_select on public.sync_conflicts for select to authenticated using (public.is_office_member(office_id));
create policy sync_conflicts_member_insert on public.sync_conflicts for insert to authenticated with check (public.is_office_member(office_id));
create policy sync_conflicts_manager_update on public.sync_conflicts for update to authenticated using (public.has_office_role(office_id, array['manager']::text[])) with check (public.has_office_role(office_id, array['manager']::text[]));

comment on table public.sync_conflicts is 'تعارضات المزامنة التي تحتاج قرار مالك المكتب قبل اختيار النسخة المحلية أو البعيدة.';
comment on column public.approval_requests.payload is 'البيانات المقترحة من الهاتف ولا تطبق تلقائيا قبل مراجعة المالك.';
