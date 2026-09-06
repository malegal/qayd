-- RPCs خاصة بمزامنة qayd؛ الوصول المباشر إلى الجداول يظل مغلقًا.
create or replace function public.sync_office_file(p_file jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result_row public.office_files;
begin
  if p_file->>'id' is null or p_file->>'office_id' is null or p_file->>'file_code' is null then
    raise exception 'بيانات الملف المهني غير مكتملة';
  end if;
  insert into public.office_files (id, office_id, file_code, file_type, title, client_name, client_phone, status, description, metadata, archived, created_at, updated_at)
  values (
    p_file->>'id', p_file->>'office_id', upper(p_file->>'file_code'), p_file->>'file_type', p_file->>'title', p_file->>'client_name', p_file->>'client_phone',
    coalesce(p_file->>'status', 'مفتوح'), p_file->>'description', coalesce(p_file->'metadata', '{}'::jsonb), coalesce((p_file->>'archived')::boolean, false),
    coalesce((p_file->>'created_at')::timestamptz, now()), now()
  )
  on conflict (id) do update set
    file_code = excluded.file_code, file_type = excluded.file_type, title = excluded.title, client_name = excluded.client_name,
    client_phone = excluded.client_phone, status = excluded.status, description = excluded.description, metadata = excluded.metadata,
    archived = excluded.archived, updated_at = now()
  returning * into result_row;
  return to_jsonb(result_row);
end;
$$;

grant execute on function public.sync_office_file(jsonb) to anon, authenticated;

create or replace function public.sync_file_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result_row public.file_events;
begin
  if p_event->>'id' is null or p_event->>'office_id' is null or p_event->>'file_id' is null then
    raise exception 'بيانات مرحلة الملف غير مكتملة';
  end if;
  insert into public.file_events (id, office_id, file_id, event_date, event_type, status, title, details, client_visible, created_at)
  values (
    p_event->>'id', p_event->>'office_id', p_event->>'file_id', p_event->>'event_date', coalesce(p_event->>'event_type', 'update'),
    coalesce(p_event->>'status', 'مفتوح'), p_event->>'title', p_event->>'details', coalesce((p_event->>'client_visible')::boolean, true),
    coalesce((p_event->>'created_at')::timestamptz, now())
  )
  on conflict (id) do update set
    event_date = excluded.event_date, event_type = excluded.event_type, status = excluded.status, title = excluded.title,
    details = excluded.details, client_visible = excluded.client_visible
  returning * into result_row;
  return to_jsonb(result_row);
end;
$$;

grant execute on function public.sync_file_event(jsonb) to anon, authenticated;

create or replace function public.get_office_files_for_sync(p_office_id text)
returns setof public.office_files
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select f.* from public.office_files f where f.office_id = p_office_id order by f.updated_at desc limit 500;
$$;

grant execute on function public.get_office_files_for_sync(text) to anon, authenticated;

create or replace function public.get_file_events_for_sync(p_office_id text)
returns setof public.file_events
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select e.* from public.file_events e where e.office_id = p_office_id order by e.event_date desc, e.created_at desc limit 1000;
$$;

grant execute on function public.get_file_events_for_sync(text) to anon, authenticated;
