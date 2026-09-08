-- دعم سجل الإجراءات والمواعيد للملفات الإجرائية والخدمية.
ALTER TABLE IF EXISTS public.file_events
  DROP CONSTRAINT IF EXISTS file_events_type_check;

ALTER TABLE IF EXISTS public.file_events
  ADD CONSTRAINT file_events_type_check CHECK (
    event_type IN ('created', 'update', 'document_required', 'document_received',
                   'submitted', 'completed', 'note', 'procedure')
  );

ALTER TABLE IF EXISTS public.file_events
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
