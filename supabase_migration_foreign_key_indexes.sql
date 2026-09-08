-- Covering indexes for foreign keys flagged by Supabase performance advisor.
-- Applied to project qayd: 20260908161620_add_foreign_key_covering_indexes
CREATE INDEX IF NOT EXISTS idx_file_events_office_id
    ON public.file_events (office_id);

CREATE INDEX IF NOT EXISTS idx_payments_case_id
    ON public.payments (case_id);
