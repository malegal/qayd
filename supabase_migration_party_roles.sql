-- حفظ صفة العميل والخصم لعرض بيانات الأطراف بشكل كامل.
ALTER TABLE IF EXISTS public.cases ADD COLUMN IF NOT EXISTS opponent_role text;
ALTER TABLE IF EXISTS public.office_files ADD COLUMN IF NOT EXISTS client_role text;
ALTER TABLE IF EXISTS public.office_files ADD COLUMN IF NOT EXISTS opponent_role text;
