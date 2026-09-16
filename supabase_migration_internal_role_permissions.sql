-- Private internal-office role permissions.
-- manager = owner, lawyer = lawyer, staff = secretary, accountant = accounting.
-- This migration intentionally does not replace apply_mobile_operation so existing
-- case/session/task synchronization remains unchanged.

-- Sessions remain visible and writable to all office members.
drop policy if exists sessions_select_member on public.sessions;
create policy sessions_select_member on public.sessions for select to authenticated using (public.is_office_member(office_id));
drop policy if exists sessions_insert_member on public.sessions;
create policy sessions_insert_member on public.sessions for insert to authenticated with check (public.is_office_member(office_id));
drop policy if exists sessions_update_member on public.sessions;
create policy sessions_update_member on public.sessions for update to authenticated using (public.is_office_member(office_id)) with check (public.is_office_member(office_id));

-- Fees: owner, accountant, and secretary may view/add/update fee records.
drop policy if exists fees_select_member on public.fees;
create policy fees_select_internal on public.fees for select to authenticated using (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager','accountant','staff']::text[])));
drop policy if exists fees_insert_member on public.fees;
create policy fees_insert_internal on public.fees for insert to authenticated with check (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager','accountant','staff']::text[])));
drop policy if exists fees_update_member on public.fees;
create policy fees_update_internal on public.fees for update to authenticated using (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager','accountant','staff']::text[]))) with check (exists (select 1 from public.cases c where c.id = fees.case_id and public.has_office_role(c.office_id, array['manager','accountant','staff']::text[])));

-- Payments are accounting-only; lawyers and secretaries cannot see payment amounts.
drop policy if exists payments_select_member on public.payments;
create policy payments_select_internal on public.payments for select to authenticated using (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager','accountant']::text[])));
drop policy if exists payments_insert_member on public.payments;
create policy payments_insert_internal on public.payments for insert to authenticated with check (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager','accountant']::text[])));
drop policy if exists payments_update_member on public.payments;
create policy payments_update_internal on public.payments for update to authenticated using (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager','accountant']::text[]))) with check (exists (select 1 from public.cases c where c.id = payments.case_id and public.has_office_role(c.office_id, array['manager','accountant']::text[])));

-- Financial amounts: only owner/accountant can read or edit. All office members may insert expenses; income is accounting-only.
drop policy if exists financial_transactions_select_member on public.financial_transactions;
create policy financial_transactions_select_internal on public.financial_transactions for select to authenticated using (public.has_office_role(office_id, array['manager','accountant']::text[]));
drop policy if exists financial_transactions_insert_member on public.financial_transactions;
create policy financial_transactions_insert_internal on public.financial_transactions for insert to authenticated with check (public.is_office_member(office_id) and (transaction_type = 'expense' or public.has_office_role(office_id, array['manager','accountant']::text[])));
drop policy if exists financial_transactions_update_member on public.financial_transactions;
create policy financial_transactions_update_internal on public.financial_transactions for update to authenticated using (public.has_office_role(office_id, array['manager','accountant']::text[])) with check (public.has_office_role(office_id, array['manager','accountant']::text[]));

-- The current apply_mobile_operation already restricts fees to manager/lawyer/accountant.
-- Staff fee entry is implemented in the mobile client using the fees table RLS policy above.
