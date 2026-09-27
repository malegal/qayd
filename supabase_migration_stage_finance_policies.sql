-- إصلاح وصول مزامنة مالية المراحل.
-- يُنفّذ بأمان حتى إذا كانت الجداول والسياسات موجودة مسبقًا.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stage_fees' AND policyname = 'stage_fees_member_select') THEN
    CREATE POLICY stage_fees_member_select ON public.stage_fees
      FOR SELECT TO authenticated
      USING (public.is_office_member(office_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stage_fees' AND policyname = 'stage_fees_accounting_write') THEN
    CREATE POLICY stage_fees_accounting_write ON public.stage_fees
      FOR ALL TO authenticated
      USING (public.has_office_role(office_id, ARRAY['manager','accountant','lawyer']::text[]))
      WITH CHECK (public.has_office_role(office_id, ARRAY['manager','accountant','lawyer']::text[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stage_payments' AND policyname = 'stage_payments_member_select') THEN
    CREATE POLICY stage_payments_member_select ON public.stage_payments
      FOR SELECT TO authenticated
      USING (public.is_office_member(office_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stage_payments' AND policyname = 'stage_payments_accounting_write') THEN
    CREATE POLICY stage_payments_accounting_write ON public.stage_payments
      FOR ALL TO authenticated
      USING (public.has_office_role(office_id, ARRAY['manager','accountant','lawyer']::text[]))
      WITH CHECK (public.has_office_role(office_id, ARRAY['manager','accountant','lawyer']::text[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stage_expenses' AND policyname = 'stage_expenses_member_select') THEN
    CREATE POLICY stage_expenses_member_select ON public.stage_expenses
      FOR SELECT TO authenticated
      USING (public.is_office_member(office_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stage_expenses' AND policyname = 'stage_expenses_accounting_write') THEN
    CREATE POLICY stage_expenses_accounting_write ON public.stage_expenses
      FOR ALL TO authenticated
      USING (public.has_office_role(office_id, ARRAY['manager','accountant','lawyer']::text[]))
      WITH CHECK (public.has_office_role(office_id, ARRAY['manager','accountant','lawyer']::text[]));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_fees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_expenses TO authenticated;
