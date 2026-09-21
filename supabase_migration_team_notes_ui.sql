-- Team notes permissions and integrity for the existing public.notes table.
-- Safe to apply after supabase_migration_email_invites_team_notes.sql.

begin;

update public.notes
set content = btrim(content)
where content is not null and content <> btrim(content);

alter table public.notes
  alter column content set default '',
  alter column author_user_id set default auth.uid();

alter table public.notes
  drop constraint if exists notes_content_length_check;
alter table public.notes
  add constraint notes_content_length_check
  check (content is not null and char_length(btrim(content)) between 1 and 4000);

create index if not exists notes_office_created_at_idx
  on public.notes (office_id, created_at desc);
create index if not exists notes_case_created_at_idx
  on public.notes (case_id, created_at desc);
create index if not exists notes_author_created_at_idx
  on public.notes (author_user_id, created_at desc);

create or replace function public.validate_note_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.office_id is null or not public.is_office_member(new.office_id) then
    raise exception 'note_office_not_allowed';
  end if;
  if new.case_id is not null and not exists (
    select 1 from public.cases c
    where c.id = new.case_id and c.office_id = new.office_id
  ) then
    raise exception 'note_case_not_in_office';
  end if;
  if new.office_file_id is not null and not exists (
    select 1 from public.office_files f
    where f.id = new.office_file_id and f.office_id = new.office_id
  ) then
    raise exception 'note_file_not_in_office';
  end if;
  if tg_op = 'UPDATE' then
    if new.office_id <> old.office_id or new.author_user_id <> old.author_user_id then
      raise exception 'note_identity_immutable';
    end if;
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists notes_validate_scope on public.notes;
create trigger notes_validate_scope
before insert or update on public.notes
for each row execute function public.validate_note_scope();

drop policy if exists notes_select_member on public.notes;
drop policy if exists notes_insert_member on public.notes;
drop policy if exists notes_update_manager on public.notes;
drop policy if exists notes_delete_manager on public.notes;
drop policy if exists notes_update_author_or_manager on public.notes;
drop policy if exists notes_delete_author_or_manager on public.notes;

create policy notes_select_member
on public.notes for select
to authenticated
using (public.is_office_member(office_id));

create policy notes_insert_member
on public.notes for insert
to authenticated
with check (
  public.is_office_member(office_id)
  and author_user_id = (select auth.uid())
  and char_length(btrim(content)) between 1 and 4000
);

create policy notes_update_author_or_manager
on public.notes for update
to authenticated
using (
  public.is_office_member(office_id)
  and (author_user_id = (select auth.uid()) or public.has_office_role(office_id, array['manager']::text[]))
)
with check (
  public.is_office_member(office_id)
  and char_length(btrim(content)) between 1 and 4000
);

create policy notes_delete_author_or_manager
on public.notes for delete
to authenticated
using (
  public.is_office_member(office_id)
  and (author_user_id = (select auth.uid()) or public.has_office_role(office_id, array['manager']::text[]))
);

revoke all on public.notes from anon;
grant select, insert, update, delete on public.notes to authenticated;
revoke all on function public.validate_note_scope() from public, anon;
grant execute on function public.validate_note_scope() to authenticated;

commit;
