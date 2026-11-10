-- Phase 8 fixup: builder-webhook creates a `leads` row when a Connect
-- quote lands for an unknown customer. That insert sets source='builder'
-- but lead_source is a Postgres enum that didn't have that value.

do $$
begin
  alter type lead_source add value if not exists 'builder';
exception when duplicate_object then null;
end $$;
