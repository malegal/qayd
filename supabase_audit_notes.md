# Supabase audit notes

- Project: qayd, ref `mgvyieyismzzvdejsvcv`, active, PostgreSQL 17.6.
- Current office membership query returned exactly one member: role `manager`, display name محمود عبد الحميد. No lawyer/staff/accountant membership exists.
- Current office invites query returned six unused pending invitations; they are not memberships.
- Security advisors reported: RLS enabled with no policies on `office_invites`, `owner_recovery_codes`, `sync_operations`; `office_financial_summary` security-definer view; mutable search_path on `generate_case_code` and `get_case_data`; multiple public SECURITY DEFINER functions executable by anon/authenticated; leaked-password protection disabled.
- Current RLS allowed staff to select fees and allowed broad fee insertion; team expense update policies were broader than the requested model.
- Current tables include `notes`, `office_invites`, `office_members`, `office_member_devices`, and `office_notifications`.
