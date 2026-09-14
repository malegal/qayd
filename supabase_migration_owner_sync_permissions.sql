-- Keep the existing desktop fields and UI unchanged while securing shared sync.
revoke execute on function public.sync_office_file(jsonb) from anon;
revoke execute on function public.sync_file_event(jsonb) from anon;
revoke execute on function public.get_office_files_for_sync(text) from anon;
revoke execute on function public.get_file_events_for_sync(text) from anon;
grant execute on function public.sync_office_file(jsonb) to authenticated;
grant execute on function public.sync_file_event(jsonb) to authenticated;
grant execute on function public.get_office_files_for_sync(text) to authenticated;
grant execute on function public.get_file_events_for_sync(text) to authenticated;

-- The deployed functions additionally verify auth.uid() membership in the requested office.
-- See the applied migration unify_owner_sync_permissions in Supabase project qayd.

-- Financial transactions are never available to anonymous callers.
drop policy if exists financial_transactions_insert_member on public.financial_transactions;
drop policy if exists financial_transactions_select_member on public.financial_transactions;
drop policy if exists financial_transactions_update_member on public.financial_transactions;
drop policy if exists financial_transactions_delete_manager on public.financial_transactions;
create policy financial_transactions_select_member on public.financial_transactions for select to authenticated using (public.is_office_member(office_id));
create policy financial_transactions_insert_member on public.financial_transactions for insert to authenticated with check (public.is_office_member(office_id));
create policy financial_transactions_update_member on public.financial_transactions for update to authenticated using (public.is_office_member(office_id)) with check (public.is_office_member(office_id));
create policy financial_transactions_delete_manager on public.financial_transactions for delete to authenticated using (public.has_office_role(office_id, array['manager','lawyer']));
