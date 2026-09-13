-- دفتر مالي موحد: نطاق كل عملية هو المكتب أو القضية أو الملف.
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), office_id text NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('income','expense')),
  transaction_scope text NOT NULL CHECK (transaction_scope IN ('office','case','file')),
  case_id text NULL, office_file_id text NULL, amount numeric(12,2) NOT NULL CHECK (amount > 0),
  transaction_date date NOT NULL DEFAULT current_date, category text NOT NULL, description text NULL,
  payment_method text NULL, paid_from text NULL, receipt_path text NULL, created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_scope_relation_check CHECK ((transaction_scope='office' AND case_id IS NULL AND office_file_id IS NULL) OR (transaction_scope='case' AND case_id IS NOT NULL AND office_file_id IS NULL) OR (transaction_scope='file' AND office_file_id IS NOT NULL AND case_id IS NULL))
);
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_transactions_select_member ON public.financial_transactions;
CREATE POLICY financial_transactions_select_member ON public.financial_transactions FOR SELECT USING (public.is_office_member(office_id));
DROP POLICY IF EXISTS financial_transactions_insert_member ON public.financial_transactions;
CREATE POLICY financial_transactions_insert_member ON public.financial_transactions FOR INSERT WITH CHECK (public.is_office_member(office_id));
DROP POLICY IF EXISTS financial_transactions_update_member ON public.financial_transactions;
CREATE POLICY financial_transactions_update_member ON public.financial_transactions FOR UPDATE USING (public.is_office_member(office_id)) WITH CHECK (public.is_office_member(office_id));
DROP POLICY IF EXISTS financial_transactions_delete_manager ON public.financial_transactions;
CREATE POLICY financial_transactions_delete_manager ON public.financial_transactions FOR DELETE USING (public.has_office_role(office_id, ARRAY['manager','lawyer']::text[]));
CREATE INDEX IF NOT EXISTS financial_transactions_office_date_idx ON public.financial_transactions (office_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS financial_transactions_scope_idx ON public.financial_transactions (office_id, transaction_scope);
CREATE INDEX IF NOT EXISTS financial_transactions_type_idx ON public.financial_transactions (office_id, transaction_type);
CREATE INDEX IF NOT EXISTS financial_transactions_case_idx ON public.financial_transactions (case_id) WHERE case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_transactions_file_idx ON public.financial_transactions (office_file_id) WHERE office_file_id IS NOT NULL;
-- ترحيل آمن للبيانات القديمة دون حذف الجداول القديمة.
INSERT INTO public.financial_transactions (office_id, transaction_type, transaction_scope, case_id, office_file_id, amount, transaction_date, category, description, created_at, updated_at)
SELECT e.office_id, 'expense', CASE WHEN e.case_id IS NOT NULL THEN 'case' WHEN e.office_file_id IS NOT NULL THEN 'file' ELSE 'office' END, e.case_id, e.office_file_id, e.amount, e.expense_date, e.category, e.description, e.created_at, e.updated_at FROM public.expenses e
WHERE NOT EXISTS (SELECT 1 FROM public.financial_transactions f WHERE f.office_id=e.office_id AND f.transaction_type='expense' AND f.amount=e.amount AND f.transaction_date=e.expense_date AND COALESCE(f.description,'')=COALESCE(e.description,''));
INSERT INTO public.financial_transactions (office_id, transaction_type, transaction_scope, case_id, amount, transaction_date, category, description)
SELECT c.office_id, 'income', 'case', p.case_id, p.amount, COALESCE(NULLIF(p.date,'')::date,current_date), 'دفعة أتعاب', p.note FROM public.payments p JOIN public.cases c ON c.id=p.case_id
WHERE NOT EXISTS (SELECT 1 FROM public.financial_transactions f WHERE f.case_id=p.case_id AND f.transaction_type='income' AND f.amount=p.amount AND f.description=COALESCE(p.note,''));

-- عرض إجمالي موحد للتقارير ولوحات المتابعة.
CREATE OR REPLACE VIEW public.office_financial_summary AS
SELECT office_id,
  COALESCE(SUM(amount) FILTER (WHERE transaction_type='income'),0) AS total_income,
  COALESCE(SUM(amount) FILTER (WHERE transaction_type='expense'),0) AS total_expense,
  COALESCE(SUM(amount) FILTER (WHERE transaction_type='income'),0)-COALESCE(SUM(amount) FILTER (WHERE transaction_type='expense'),0) AS net_total,
  COALESCE(SUM(amount) FILTER (WHERE transaction_scope='office' AND transaction_type='income'),0) AS office_income,
  COALESCE(SUM(amount) FILTER (WHERE transaction_scope='office' AND transaction_type='expense'),0) AS office_expense,
  COALESCE(SUM(amount) FILTER (WHERE transaction_scope='case' AND transaction_type='income'),0) AS case_income,
  COALESCE(SUM(amount) FILTER (WHERE transaction_scope='case' AND transaction_type='expense'),0) AS case_expense,
  COALESCE(SUM(amount) FILTER (WHERE transaction_scope='file' AND transaction_type='income'),0) AS file_income,
  COALESCE(SUM(amount) FILTER (WHERE transaction_scope='file' AND transaction_type='expense'),0) AS file_expense
FROM public.financial_transactions GROUP BY office_id;
